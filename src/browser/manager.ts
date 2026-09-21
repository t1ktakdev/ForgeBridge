import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Dialog,
  type Locator,
  type Page,
} from 'playwright';
import { ForgeBridgeError } from '../core/errors.js';
import type { PathGuard } from '../filesystem/path-guard.js';
import { BrowserOriginPolicy } from './origin-policy.js';

export type LocatorSpec =
  | { by: 'role'; role: string; name?: string; exact?: boolean }
  | { by: 'label'; value: string; exact?: boolean }
  | { by: 'text'; value: string; exact?: boolean }
  | { by: 'testId'; value: string }
  | { by: 'css'; value: string };

export type BrowserSessionState = {
  id: string;
  createdAt: string;
  headless: boolean;
  pages: { id: string; url: string; title: string }[];
  provenance: 'untrusted_web_content';
};

export type BrowserObservation = {
  sequence: number;
  timestamp: string;
  pageId: string;
  type: 'console' | 'request' | 'response' | 'request_failed';
  level?: string;
  method?: string;
  url?: string;
  status?: number;
  text?: string;
};

type Session = {
  id: string;
  createdAt: string;
  context: BrowserContext;
  pages: Map<string, Page>;
  dialogs: Map<string, Dialog>;
  blockedNavigations: Map<string, string>;
  observations: BrowserObservation[];
  nextObservationSequence: number;
  headless: boolean;
};

export class BrowserManager {
  readonly #headless: () => boolean;
  readonly #originPolicy: BrowserOriginPolicy;
  readonly #guard: PathGuard;
  readonly #artifactDirectory: string;
  readonly #executablePath?: string;
  readonly #maxObservationEntries: number;
  readonly #maxTransferBytes: number;
  readonly #maxInstances: () => number;
  readonly #sessions = new Map<string, Session>();
  #browser?: Browser;

  constructor(options: {
    headless: boolean | (() => boolean);
    allowedOrigins: readonly string[];
    pathGuard: PathGuard;
    artifactDirectory: string;
    maxTransferBytes?: number;
    maxObservationEntries?: number;
    maxInstances?: number | (() => number);
    executablePath?: string;
  }) {
    this.#headless =
      typeof options.headless === 'function' ? options.headless : () => options.headless as boolean;
    this.#originPolicy = new BrowserOriginPolicy(options.allowedOrigins);
    this.#guard = options.pathGuard;
    this.#artifactDirectory = options.artifactDirectory;
    this.#maxObservationEntries = Math.max(
      10,
      Math.min(options.maxObservationEntries ?? 500, 10_000),
    );
    this.#maxTransferBytes = Math.max(1, options.maxTransferBytes ?? 100 * 1024 * 1024);
    if (typeof options.maxInstances === 'function') this.#maxInstances = options.maxInstances;
    else {
      const maximumInstances = options.maxInstances ?? 2;
      this.#maxInstances = () => maximumInstances;
    }
    if (options.executablePath && !path.isAbsolute(options.executablePath)) {
      throw new ForgeBridgeError(
        'invalid_config',
        'browser.executablePath must be an absolute path',
      );
    }
    this.#executablePath = options.executablePath;
  }

  async launch(initialUrl = 'about:blank'): Promise<BrowserSessionState> {
    const limit = Math.max(1, Math.min(this.#maxInstances(), 16));
    if (this.#sessions.size >= limit) {
      throw new ForgeBridgeError(
        'resource_limit',
        `The execution profile allows at most ${limit} browser sessions`,
        { limit, active: this.#sessions.size },
        true,
      );
    }
    if (initialUrl !== 'about:blank') this.#originPolicy.assertAllowed(initialUrl);
    if (!this.#browser?.isConnected()) {
      this.#sessions.clear();
      this.#browser = await this.launchBrowser();
      const launched = this.#browser;
      launched.once('disconnected', () => {
        if (this.#browser !== launched) return;
        this.#sessions.clear();
        this.#browser = undefined;
      });
    }
    const context = await this.#browser.newContext({ acceptDownloads: true });
    const session: Session = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      context,
      pages: new Map(),
      dialogs: new Map(),
      blockedNavigations: new Map(),
      observations: [],
      nextObservationSequence: 1,
      headless: this.#headless(),
    };
    context.on('page', (page) => this.attachPage(session, page));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (this.#originPolicy.allows(url)) await route.continue();
      else await route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    this.#sessions.set(session.id, session);
    try {
      if (initialUrl !== 'about:blank') await this.navigate(session, page, initialUrl);
      return await this.state(session);
    } catch (error) {
      this.#sessions.delete(session.id);
      await context.close();
      throw error;
    }
  }

  async open(sessionId: string, url: string, newTab = false): Promise<Record<string, unknown>> {
    this.#originPolicy.assertAllowed(url);
    const session = this.requireSession(sessionId);
    const page = newTab ? await session.context.newPage() : this.firstPage(session);
    const response = await this.navigate(session, page, url);
    return {
      pageId: this.pageId(session, page),
      url: page.url(),
      title: (await page.title()).slice(0, 8192),
      status: response?.status() ?? null,
      provenance: 'untrusted_web_content',
    };
  }

  async snapshot(sessionId: string, pageId?: string): Promise<Record<string, unknown>> {
    const { page, id } = this.requirePage(sessionId, pageId);
    const snapshot = await page.locator('body').ariaSnapshot({ timeout: 10_000 });
    return {
      pageId: id,
      url: page.url(),
      title: (await page.title()).slice(0, 8192),
      accessibility: snapshot.slice(0, 200_000),
      truncated: snapshot.length > 200_000,
      provenance: 'untrusted_web_content',
    };
  }

  async tabs(sessionId: string): Promise<BrowserSessionState> {
    return this.state(this.requireSession(sessionId));
  }

  async click(sessionId: string, locator: LocatorSpec, pageId?: string): Promise<void> {
    const { page } = this.requirePage(sessionId, pageId);
    let sawDialog!: () => void;
    const dialogOpened = new Promise<'dialog'>((resolve) => {
      sawDialog = () => resolve('dialog');
    });
    page.once('dialog', sawDialog);
    const click = this.locator(page, locator).click();
    try {
      const outcome = await Promise.race([click.then(() => 'complete' as const), dialogOpened]);
      if (outcome === 'dialog') void click.catch(() => undefined);
    } finally {
      page.off('dialog', sawDialog);
    }
  }

  async type(
    sessionId: string,
    locator: LocatorSpec,
    text: string,
    options: { pageId?: string; clear?: boolean; delayMs?: number } = {},
  ): Promise<void> {
    const { page } = this.requirePage(sessionId, options.pageId);
    const target = this.locator(page, locator);
    if (options.clear ?? true) await target.fill(text);
    else await target.pressSequentially(text, { delay: options.delayMs ?? 0 });
  }

  async press(
    sessionId: string,
    key: string,
    pageId?: string,
    locator?: LocatorSpec,
  ): Promise<void> {
    const { page } = this.requirePage(sessionId, pageId);
    if (locator) await this.locator(page, locator).press(key);
    else await page.keyboard.press(key);
  }

  async select(
    sessionId: string,
    locator: LocatorSpec,
    values: string[],
    pageId?: string,
  ): Promise<{ values: string[]; provenance: 'untrusted_web_content' }> {
    const { page } = this.requirePage(sessionId, pageId);
    return {
      values: await this.locator(page, locator).selectOption(values),
      provenance: 'untrusted_web_content',
    };
  }

  async hover(sessionId: string, locator: LocatorSpec, pageId?: string): Promise<void> {
    const { page } = this.requirePage(sessionId, pageId);
    await this.locator(page, locator).hover();
  }

  async wait(
    sessionId: string,
    options: { pageId?: string; text?: string; url?: string; timeoutMs?: number },
  ): Promise<void> {
    const { page } = this.requirePage(sessionId, options.pageId);
    const timeout = Math.max(0, Math.min(options.timeoutMs ?? 10_000, 60_000));
    if (options.text) {
      await page.getByText(options.text).first().waitFor({ state: 'visible', timeout });
      return;
    }
    if (options.url) {
      await page.waitForURL(options.url, { timeout });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, timeout));
  }

  async upload(
    sessionId: string,
    locator: LocatorSpec,
    files: string[],
    pageId?: string,
  ): Promise<void> {
    const resolved = await Promise.all(files.map(async (file) => this.#guard.resolve(file)));
    if (resolved.some((file) => this.#guard.isSensitive(file))) {
      throw new ForgeBridgeError('sensitive_path', 'Sensitive files cannot be uploaded');
    }
    let totalBytes = 0;
    for (const file of resolved) {
      const information = await stat(file.canonical);
      if (!information.isFile()) {
        throw new ForgeBridgeError('not_a_file', 'Browser uploads require regular files', {
          path: file.canonical,
        });
      }
      totalBytes += information.size;
      if (totalBytes > this.#maxTransferBytes) {
        throw new ForgeBridgeError(
          'transfer_too_large',
          'Browser upload exceeds the configured limit',
          {
            limit: this.#maxTransferBytes,
          },
        );
      }
    }
    const { page } = this.requirePage(sessionId, pageId);
    await this.locator(page, locator).setInputFiles(resolved.map((file) => file.canonical));
  }

  async download(
    sessionId: string,
    locator: LocatorSpec,
    destinationDirectory: string,
    pageId?: string,
  ): Promise<Record<string, unknown>> {
    const directory = await this.#guard.resolve(destinationDirectory);
    if (this.#guard.isSensitive(directory)) {
      throw new ForgeBridgeError('sensitive_path', 'Downloads cannot use a sensitive directory');
    }
    if (!(await stat(directory.canonical)).isDirectory()) {
      throw new ForgeBridgeError('not_a_directory', 'Download destination must be a directory');
    }
    const { page } = this.requirePage(sessionId, pageId);
    const pending = page.waitForEvent('download');
    await this.locator(page, locator).click();
    const download = await pending;
    const safeName =
      path.basename(download.suggestedFilename()).replaceAll(/[^A-Za-z0-9._-]/gu, '_') ||
      `download-${randomUUID()}`;
    const destination = await this.#guard.resolve(
      path.join(directory.canonical, `${randomUUID()}-${safeName}`),
    );
    if (this.#guard.isSensitive(destination)) {
      await download.cancel();
      throw new ForgeBridgeError('sensitive_path', 'Downloads cannot replace sensitive files');
    }
    const stream = await download.createReadStream();
    let bytes = 0;
    const limiter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        bytes += chunk.length;
        callback(
          bytes > this.#maxTransferBytes
            ? new ForgeBridgeError(
                'transfer_too_large',
                'Browser download exceeds the configured limit',
                { limit: this.#maxTransferBytes },
              )
            : undefined,
          chunk,
        );
      },
    });
    try {
      await pipeline(
        stream,
        limiter,
        createWriteStream(destination.canonical, { flags: 'wx', mode: 0o600 }),
      );
    } catch (error) {
      await rm(destination.canonical, { force: true });
      throw error;
    }
    return {
      path: destination.canonical,
      suggestedFilename: download.suggestedFilename(),
      bytes,
      provenance: 'untrusted_web_content',
    };
  }

  async screenshot(
    sessionId: string,
    options: { pageId?: string; path?: string; fullPage?: boolean } = {},
  ): Promise<{ path: string }> {
    const { page } = this.requirePage(sessionId, options.pageId);
    const requested =
      options.path ?? path.join(this.#artifactDirectory, `screenshot-${randomUUID()}.png`);
    const destination = await this.#guard.resolve(requested);
    if (this.#guard.isSensitive(destination)) {
      throw new ForgeBridgeError('sensitive_path', 'Screenshots cannot replace sensitive files');
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(destination.canonical, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ForgeBridgeError('already_exists', 'Screenshot destination already exists', {
          path: destination.canonical,
        });
      }
      throw error;
    }
    try {
      const image = await page.screenshot({ fullPage: options.fullPage ?? true });
      if (image.byteLength > this.#maxTransferBytes) {
        throw new ForgeBridgeError(
          'transfer_too_large',
          'Browser screenshot exceeds the configured limit',
          { limit: this.#maxTransferBytes },
        );
      }
      await handle.writeFile(image);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(destination.canonical, { force: true });
      throw error;
    }
    await handle.close();
    return { path: destination.canonical };
  }

  async dialog(
    sessionId: string,
    action: 'status' | 'accept' | 'dismiss',
    options: { pageId?: string; promptText?: string } = {},
  ): Promise<Record<string, unknown>> {
    const session = this.requireSession(sessionId);
    const { id } = this.requirePage(sessionId, options.pageId);
    const dialog = session.dialogs.get(id);
    if (!dialog) return { present: false, provenance: 'untrusted_web_content' };
    const result = {
      present: true,
      type: dialog.type(),
      message: dialog.message().slice(0, 16_384),
      provenance: 'untrusted_web_content',
    };
    if (action === 'accept') {
      await dialog.accept(options.promptText);
      session.dialogs.delete(id);
    } else if (action === 'dismiss') {
      await dialog.dismiss();
      session.dialogs.delete(id);
    }
    return result;
  }

  observations(
    sessionId: string,
    options: {
      afterSequence?: number;
      limit?: number;
      pageId?: string;
      types?: BrowserObservation['type'][];
    } = {},
  ): {
    entries: BrowserObservation[];
    oldestSequence: number;
    nextSequence?: number;
    provenance: 'untrusted_web_content';
  } {
    const session = this.requireSession(sessionId);
    if (options.pageId && !session.pages.has(options.pageId)) {
      throw new ForgeBridgeError('unknown_page', 'Unknown browser page handle', {
        pageId: options.pageId,
      });
    }
    const oldestSequence = session.observations[0]?.sequence ?? session.nextObservationSequence;
    const afterSequence = options.afterSequence ?? oldestSequence - 1;
    if (afterSequence < oldestSequence - 1) {
      throw new ForgeBridgeError('offset_expired', 'Browser observation cursor has expired', {
        requested: afterSequence,
        oldest: oldestSequence,
      });
    }
    const typeFilter = options.types ? new Set(options.types) : undefined;
    const matching = session.observations.filter(
      (entry) =>
        entry.sequence > afterSequence &&
        (!options.pageId || entry.pageId === options.pageId) &&
        (!typeFilter || typeFilter.has(entry.type)),
    );
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const entries = matching.slice(0, limit);
    const last = entries.at(-1);
    return {
      entries,
      oldestSequence,
      provenance: 'untrusted_web_content',
      ...(matching.length > entries.length && last ? { nextSequence: last.sequence } : {}),
    };
  }

  list() {
    return [...this.#sessions.values()].map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      headless: session.headless,
      pages: [...session.pages.entries()].map(([id, page]) => ({ id, url: page.url() })),
    }));
  }

  async close(sessionId: string, pageId?: string): Promise<void> {
    const session = this.requireSession(sessionId);
    if (pageId) {
      const page = session.pages.get(pageId);
      if (!page) throw new ForgeBridgeError('unknown_page', 'Unknown browser page handle');
      await page.close();
      session.pages.delete(pageId);
      return;
    }
    await session.context.close();
    this.#sessions.delete(sessionId);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#sessions.values()].map(async (session) => session.context.close()));
    this.#sessions.clear();
    await this.#browser?.close();
    this.#browser = undefined;
  }

  private attachPage(session: Session, page: Page): void {
    const id = randomUUID();
    session.pages.set(id, page);
    page.on('dialog', (dialog) => session.dialogs.set(id, dialog));
    page.on('console', (message) =>
      this.recordObservation(session, {
        pageId: id,
        type: 'console',
        level: message.type(),
        text: message.text().slice(0, 16_384),
      }),
    );
    page.on('request', (request) => {
      const url = request.url();
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        !this.#originPolicy.allows(url)
      ) {
        session.blockedNavigations.set(id, url);
      }
      this.recordObservation(session, {
        pageId: id,
        type: 'request',
        method: request.method(),
        url: this.safeObservedUrl(url),
      });
    });
    page.on('response', (response) =>
      this.recordObservation(session, {
        pageId: id,
        type: 'response',
        status: response.status(),
        url: this.safeObservedUrl(response.url()),
      }),
    );
    page.on('requestfailed', (request) =>
      this.recordObservation(session, {
        pageId: id,
        type: 'request_failed',
        method: request.method(),
        url: this.safeObservedUrl(request.url()),
        text: request.failure()?.errorText.slice(0, 4096),
      }),
    );
    page.on('close', () => {
      session.pages.delete(id);
      session.dialogs.delete(id);
      session.blockedNavigations.delete(id);
    });
  }

  private async navigate(session: Session, page: Page, url: string) {
    const id = this.pageId(session, page);
    session.blockedNavigations.delete(id);
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const blockedUrl = session.blockedNavigations.get(id);
      if (blockedUrl) this.#originPolicy.assertAllowed(blockedUrl);
      return response;
    } catch (error) {
      const blockedUrl = session.blockedNavigations.get(id);
      if (blockedUrl) this.#originPolicy.assertAllowed(blockedUrl);
      throw error;
    } finally {
      session.blockedNavigations.delete(id);
    }
  }

  private safeObservedUrl(value: string): string {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return `${url.origin}${url.pathname}`.slice(0, 8192);
      }
      return `${url.protocol}[redacted]`;
    } catch {
      return '[invalid URL]';
    }
  }

  private recordObservation(
    session: Session,
    observation: Omit<BrowserObservation, 'sequence' | 'timestamp'>,
  ): void {
    session.observations.push({
      sequence: session.nextObservationSequence++,
      timestamp: new Date().toISOString(),
      ...observation,
    });
    if (session.observations.length > this.#maxObservationEntries) {
      session.observations.splice(0, session.observations.length - this.#maxObservationEntries);
    }
  }

  private async launchBrowser(): Promise<Browser> {
    const headless = this.#headless();
    if (this.#executablePath) {
      return chromium.launch({ headless, executablePath: this.#executablePath });
    }
    try {
      return await chromium.launch({ headless });
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      const candidates = [
        path.join(
          process.env['ProgramFiles'] ?? 'C:\\Program Files',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        ),
        path.join(
          process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe',
        ),
      ];
      const executablePath = candidates.find((candidate) => existsSync(candidate));
      if (!executablePath) throw error;
      return chromium.launch({ headless, executablePath });
    }
  }

  private locator(page: Page, specification: LocatorSpec): Locator {
    if (specification.by === 'role') {
      return page.getByRole(specification.role as never, {
        ...(specification.name ? { name: specification.name } : {}),
        exact: specification.exact ?? false,
      });
    }
    if (specification.by === 'label') {
      return page.getByLabel(specification.value, { exact: specification.exact ?? false });
    }
    if (specification.by === 'text') {
      return page.getByText(specification.value, { exact: specification.exact ?? false });
    }
    if (specification.by === 'testId') return page.getByTestId(specification.value);
    return page.locator(specification.value);
  }

  private requireSession(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session)
      throw new ForgeBridgeError('unknown_browser_session', 'Unknown browser session', { id });
    return session;
  }

  private requirePage(sessionId: string, pageId?: string): { id: string; page: Page } {
    const session = this.requireSession(sessionId);
    if (pageId) {
      const page = session.pages.get(pageId);
      if (!page)
        throw new ForgeBridgeError('unknown_page', 'Unknown browser page handle', { pageId });
      return { id: pageId, page };
    }
    const first = session.pages.entries().next();
    if (first.done) throw new ForgeBridgeError('unknown_page', 'Browser session has no open pages');
    return { id: first.value[0], page: first.value[1] };
  }

  private firstPage(session: Session): Page {
    const first = session.pages.values().next();
    if (first.done) throw new ForgeBridgeError('unknown_page', 'Browser session has no open pages');
    return first.value;
  }

  private pageId(session: Session, page: Page): string {
    for (const [id, candidate] of session.pages) if (candidate === page) return id;
    throw new ForgeBridgeError('unknown_page', 'Page was not registered');
  }

  private async state(session: Session): Promise<BrowserSessionState> {
    const pages = await Promise.all(
      [...session.pages.entries()].map(async ([id, page]) => ({
        id,
        url: page.url(),
        title: (await page.title()).slice(0, 8192),
      })),
    );
    return {
      id: session.id,
      createdAt: session.createdAt,
      headless: session.headless,
      pages,
      provenance: 'untrusted_web_content',
    };
  }
}
