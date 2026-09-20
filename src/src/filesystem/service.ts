import { createHash } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { applyPatch } from 'diff';
import { z } from 'zod';
import { writeFileAtomic } from '../core/atomic.js';
import { ForgeBridgeError } from '../core/errors.js';
import { decodeCursor, encodeCursor, sha256 } from '../core/json.js';
import type { ResolvedPath } from './path-guard.js';
import { PathGuard } from './path-guard.js';

export type FileServiceLimits = {
  maxReadBytes: number;
  maxFileEntries: number;
  maxTreeDepth: number;
  maxOutputBytes: number;
};

const ListCursorSchema = z.object({
  version: z.literal(1),
  pathHash: z.string().regex(/^[a-f0-9]{64}$/),
  offset: z.number().int().nonnegative(),
});

export type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modifiedAt: string;
};

function entryType(stats: Awaited<ReturnType<typeof lstat>>): FileEntry['type'] {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  return 'other';
}

function contentHash(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

function binary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

async function hashOpenFile(handle: FileHandle, size: number): Promise<string> {
  const digest = createHash('sha256');
  const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, size)));
  let position = 0;
  while (position < size) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, size - position),
      position,
    );
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest('hex');
}

const SEARCH_WORKER_SOURCE = String.raw`
const { parentPort } = require('node:worker_threads');
parentPort.on('message', ({ query, text, maxMatches }) => {
  try {
    const expression = new RegExp(query, 'u');
    const matches = [];
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
      expression.lastIndex = 0;
      if (expression.test(lines[index])) matches.push({ lineIndex: index, line: lines[index] });
    }
    parentPort.postMessage({ ok: true, matches });
  } catch (error) {
    parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});
`;

type SearchWorkerResponse =
  { ok: true; matches: { lineIndex: number; line: string }[] } | { ok: false; message: string };

function searchTextInWorker(
  worker: Worker,
  query: string,
  text: string,
  maxMatches: number,
  timeoutMs: number,
): Promise<SearchWorkerResponse> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    const onMessage = (response: SearchWorkerResponse): void => {
      cleanup();
      resolve(response);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(
      () => {
        cleanup();
        reject(
          new ForgeBridgeError('search_timeout', 'Content search exceeded its deadline', {}, true),
        );
      },
      Math.max(1, timeoutMs),
    );
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.postMessage({ query, text, maxMatches });
  });
}

function compileGlob(pattern: string | undefined): RegExp | undefined {
  if (!pattern) return undefined;
  const value = pattern.replaceAll('\\', '/');
  let source = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '*' && value[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`^${source}$`, process.platform === 'win32' ? 'iu' : 'u');
}

export class FileService {
  readonly guard: PathGuard;
  readonly #limits: FileServiceLimits;

  constructor(guard: PathGuard, limits: FileServiceLimits) {
    this.guard = guard;
    this.#limits = limits;
  }

  async stat(requested: string): Promise<Record<string, unknown>> {
    const resolved = await this.guard.resolve(requested, { followFinalSymlink: false });
    this.assertNotSensitive(resolved);
    const info = await lstat(resolved.absolute);
    const result: Record<string, unknown> = {
      path: resolved.canonical,
      provenance: 'untrusted_repository_content',
      type: entryType(info),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      createdAt: info.birthtime.toISOString(),
      isSymbolicLink: info.isSymbolicLink(),
    };
    if (info.isFile() && info.size <= this.#limits.maxReadBytes) {
      result['sha256'] = contentHash(await readFile(resolved.absolute));
    }
    return result;
  }

  async list(
    requested: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{
    path: string;
    entries: FileEntry[];
    provenance: 'untrusted_repository_content';
    nextCursor?: string;
  }> {
    const resolved = await this.guard.resolve(requested);
    this.assertNotSensitive(resolved);
    const items = (await readdir(resolved.canonical, { withFileTypes: true }))
      .filter((item) => !this.guard.isSensitivePath(path.join(resolved.canonical, item.name)))
      .sort((left, right) => left.name.localeCompare(right.name));
    const pathHash = sha256(resolved.canonical);
    const decoded = options.cursor
      ? ListCursorSchema.parse(decodeCursor<unknown>(options.cursor))
      : undefined;
    if (decoded && decoded.pathHash !== pathHash) {
      throw new ForgeBridgeError('invalid_cursor', 'Cursor does not belong to this directory');
    }
    const offset = decoded?.offset ?? 0;
    const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
    const selected = items.slice(offset, offset + limit);
    const entries = await Promise.all(
      selected.map(async (item) => {
        const itemPath = path.join(resolved.canonical, item.name);
        const info = await lstat(itemPath);
        return {
          name: item.name,
          path: itemPath,
          type: entryType(info),
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
        } satisfies FileEntry;
      }),
    );
    const nextOffset = offset + entries.length;
    return {
      path: resolved.canonical,
      entries,
      provenance: 'untrusted_repository_content',
      ...(nextOffset < items.length
        ? { nextCursor: encodeCursor({ version: 1, pathHash, offset: nextOffset }) }
        : {}),
    };
  }

  async tree(
    requested: string,
    options: { depth?: number; maxEntries?: number } = {},
  ): Promise<{
    root: string;
    entries: (FileEntry & { depth: number })[];
    truncated: boolean;
    provenance: 'untrusted_repository_content';
  }> {
    const resolved = await this.guard.resolve(requested);
    this.assertNotSensitive(resolved);
    const maxDepth = Math.max(0, Math.min(options.depth ?? 4, this.#limits.maxTreeDepth));
    const maxEntries = Math.max(
      1,
      Math.min(options.maxEntries ?? 1000, this.#limits.maxFileEntries),
    );
    const entries: (FileEntry & { depth: number })[] = [];
    const pending: { directory: string; depth: number }[] = [
      { directory: resolved.canonical, depth: 0 },
    ];

    while (pending.length > 0 && entries.length < maxEntries) {
      const current = pending.shift();
      if (!current) break;
      const children = await readdir(current.directory, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        if (entries.length >= maxEntries) break;
        const childPath = path.join(current.directory, child.name);
        if (this.guard.isSensitivePath(childPath)) continue;
        const info = await lstat(childPath);
        const item = {
          name: child.name,
          path: childPath,
          type: entryType(info),
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          depth: current.depth + 1,
        } satisfies FileEntry & { depth: number };
        entries.push(item);
        if (info.isDirectory() && !info.isSymbolicLink() && item.depth < maxDepth) {
          pending.push({ directory: childPath, depth: item.depth });
        }
      }
    }
    return {
      root: resolved.canonical,
      entries,
      truncated: pending.length > 0,
      provenance: 'untrusted_repository_content',
    };
  }

  async read(
    requested: string,
    options: {
      offset?: number;
      length?: number;
      encoding?: 'utf8' | 'base64';
      maximumFileBytes?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    const resolved = await this.guard.resolve(requested);
    this.assertNotSensitive(resolved);
    let info = await stat(resolved.canonical);
    if (!info.isFile()) throw new ForgeBridgeError('not_a_file', 'Path is not a regular file');
    const offset = Math.max(0, options.offset ?? 0);
    const requestedLength = options.length ?? this.#limits.maxReadBytes;
    const length = Math.max(0, Math.min(requestedLength, this.#limits.maxReadBytes));
    const handle = await open(resolved.canonical, 'r');
    try {
      info = await handle.stat();
      if (!info.isFile()) throw new ForgeBridgeError('not_a_file', 'Path is not a regular file');
      if (options.maximumFileBytes !== undefined && info.size > options.maximumFileBytes) {
        throw new ForgeBridgeError('manifest_too_large', 'Manifest exceeds inspection byte limit', {
          maximumBytes: options.maximumFileBytes,
        });
      }
      const buffer = Buffer.alloc(Math.min(length, Math.max(0, info.size - offset)));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const bytes = buffer.subarray(0, bytesRead);
      const isBinary = binary(bytes);
      const encoding = options.encoding ?? (isBinary ? 'base64' : 'utf8');
      return {
        path: resolved.canonical,
        offset,
        bytesRead,
        size: info.size,
        eof: offset + bytesRead >= info.size,
        binary: isBinary,
        encoding,
        content: bytes.toString(encoding),
        sha256: await hashOpenFile(handle, info.size),
        provenance: 'untrusted_repository_content',
      };
    } finally {
      await handle.close();
    }
  }

  async searchNames(
    requested: string,
    query: string,
    options: { maxResults?: number; depth?: number } = {},
  ): Promise<{
    root: string;
    matches: string[];
    truncated: boolean;
    provenance: 'untrusted_repository_content';
  }> {
    const tree = await this.tree(requested, {
      depth: options.depth ?? this.#limits.maxTreeDepth,
      maxEntries: this.#limits.maxFileEntries,
    });
    const needle = query.toLocaleLowerCase('en-US');
    const max = Math.max(1, Math.min(options.maxResults ?? 200, 2000));
    const all = tree.entries
      .filter((entry) => entry.name.toLocaleLowerCase('en-US').includes(needle))
      .map((entry) => entry.path);
    return {
      root: tree.root,
      matches: all.slice(0, max),
      truncated: tree.truncated || all.length > max,
      provenance: 'untrusted_repository_content',
    };
  }

  async searchContent(
    requested: string,
    query: string,
    options: { glob?: string; maxResults?: number; timeoutMs?: number } = {},
  ): Promise<{
    root: string;
    matches: unknown[];
    truncated: boolean;
    provenance: 'untrusted_repository_content';
  }> {
    const resolved = await this.guard.resolve(requested);
    this.assertNotSensitive(resolved);
    const maxResults = Math.max(1, Math.min(options.maxResults ?? 200, 2000));
    const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? 30_000, 60_000));
    const deadline = Date.now() + timeoutMs;
    try {
      RegExp(query, 'u');
    } catch {
      throw new ForgeBridgeError(
        'invalid_search_pattern',
        'Search query is not a valid expression',
      );
    }
    const glob = compileGlob(options.glob);
    const matches: {
      path: { text: string };
      lines: { text: string };
      line_number: number;
    }[] = [];
    const pending: { directory: string; depth: number }[] = [
      { directory: resolved.canonical, depth: 0 },
    ];
    let entriesVisited = 0;
    let outputBytes = 0;
    let truncated = false;
    const worker = new Worker(SEARCH_WORKER_SOURCE, { eval: true });
    try {
      while (pending.length > 0 && matches.length < maxResults) {
        if (Date.now() > deadline) {
          throw new ForgeBridgeError(
            'search_timeout',
            'Content search exceeded its deadline',
            {},
            true,
          );
        }
        const current = pending.shift();
        if (!current) break;
        const children = await readdir(current.directory, { withFileTypes: true });
        children.sort((left, right) => left.name.localeCompare(right.name));
        for (const child of children) {
          entriesVisited += 1;
          if (entriesVisited > this.#limits.maxFileEntries) {
            truncated = true;
            break;
          }
          const childPath = path.join(current.directory, child.name);
          if (this.guard.isSensitivePath(childPath) || child.isSymbolicLink()) continue;
          if (child.isDirectory()) {
            if (current.depth < this.#limits.maxTreeDepth) {
              pending.push({ directory: childPath, depth: current.depth + 1 });
            } else truncated = true;
            continue;
          }
          if (!child.isFile()) continue;
          const relative = path.relative(resolved.canonical, childPath).replaceAll('\\', '/');
          if (glob && !glob.test(options.glob?.includes('/') ? relative : child.name)) continue;
          const information = await stat(childPath);
          const length = Math.min(information.size, this.#limits.maxReadBytes);
          if (information.size > length) truncated = true;
          const buffer = Buffer.alloc(length);
          const handle = await open(childPath, 'r');
          let bytesRead: number;
          try {
            ({ bytesRead } = await handle.read(buffer, 0, length, 0));
          } finally {
            await handle.close();
          }
          const bytes = buffer.subarray(0, bytesRead);
          if (binary(bytes)) continue;
          const response = await searchTextInWorker(
            worker,
            query,
            bytes.toString('utf8'),
            maxResults - matches.length,
            deadline - Date.now(),
          );
          if (!response.ok) {
            throw new ForgeBridgeError(
              'invalid_search_pattern',
              'Search query is not a valid expression',
            );
          }
          for (const found of response.matches) {
            const match = {
              path: { text: childPath },
              lines: { text: found.line },
              line_number: found.lineIndex + 1,
            };
            const matchBytes = Buffer.byteLength(JSON.stringify(match));
            if (outputBytes + matchBytes > this.#limits.maxOutputBytes) {
              truncated = true;
              break;
            }
            matches.push(match);
            outputBytes += matchBytes;
            if (matches.length >= maxResults) {
              truncated = true;
              break;
            }
          }
          if (
            truncated &&
            (matches.length >= maxResults || outputBytes >= this.#limits.maxOutputBytes)
          )
            break;
        }
        if (entriesVisited > this.#limits.maxFileEntries) break;
      }
    } finally {
      await worker.terminate();
    }
    return {
      root: resolved.canonical,
      matches,
      truncated,
      provenance: 'untrusted_repository_content',
    };
  }

  async create(
    requested: string,
    content: string,
    overwrite = false,
  ): Promise<Record<string, unknown>> {
    const resolved = await this.guard.resolve(requested);
    this.assertNotSensitive(resolved);
    if (resolved.exists && !overwrite) {
      throw new ForgeBridgeError(
        'already_exists',
        'File already exists; overwrite was not requested',
      );
    }
    await mkdir(path.dirname(resolved.canonical), { recursive: true });
    const checked = await this.guard.resolve(requested);
    this.assertNotSensitive(checked);
    if (checked.canonical !== resolved.canonical) {
      throw new ForgeBridgeError('path_changed', 'Path target changed during create');
    }
    if (checked.exists && !overwrite) {
      throw new ForgeBridgeError('already_exists', 'File appeared before create completed');
    }
    if (checked.exists) await writeFileAtomic(checked.canonical, content, 0o600);
    else {
      const handle = await open(checked.canonical, 'wx', 0o600);
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    const bytes = Buffer.from(content, 'utf8');
    return { path: checked.canonical, bytesWritten: bytes.length, sha256: contentHash(bytes) };
  }

  async update(
    requested: string,
    content: string,
    expectedSha256: string,
  ): Promise<Record<string, unknown>> {
    const beforeResolved = await this.guard.resolve(requested);
    this.assertNotSensitive(beforeResolved);
    const handle = await open(beforeResolved.canonical, 'r');
    let actualHash: string;
    try {
      const information = await handle.stat();
      if (!information.isFile()) {
        throw new ForgeBridgeError('not_a_file', 'Path is not a regular file');
      }
      actualHash = await hashOpenFile(handle, information.size);
    } finally {
      await handle.close();
    }
    if (actualHash !== expectedSha256) {
      throw new ForgeBridgeError('version_conflict', 'File changed since it was read', {
        expectedSha256,
        actualSha256: actualHash,
      });
    }
    const checkedAgain = await this.guard.resolve(requested);
    this.assertNotSensitive(checkedAgain);
    if (checkedAgain.canonical !== beforeResolved.canonical) {
      throw new ForgeBridgeError('path_changed', 'Path target changed during update');
    }
    await writeFileAtomic(checkedAgain.canonical, content, 0o600);
    return {
      path: checkedAgain.canonical,
      previousSha256: actualHash,
      sha256: sha256(content),
      bytesWritten: Buffer.byteLength(content),
    };
  }

  async patch(
    requested: string,
    unifiedDiff: string,
    expectedSha256: string,
  ): Promise<Record<string, unknown>> {
    const beforeResolved = await this.guard.resolve(requested);
    this.assertNotSensitive(beforeResolved);
    const information = await stat(beforeResolved.canonical);
    if (!information.isFile()) {
      throw new ForgeBridgeError('not_a_file', 'Path is not a regular file');
    }
    if (information.size > this.#limits.maxReadBytes) {
      throw new ForgeBridgeError('file_too_large', 'File exceeds the configured patch limit', {
        size: information.size,
        limit: this.#limits.maxReadBytes,
      });
    }
    const before = await readFile(beforeResolved.canonical, 'utf8');
    const actualHash = sha256(before);
    if (actualHash !== expectedSha256) {
      throw new ForgeBridgeError('version_conflict', 'File changed since it was read', {
        expectedSha256,
        actualSha256: actualHash,
      });
    }
    const after = applyPatch(before, unifiedDiff);
    if (after === false)
      throw new ForgeBridgeError('patch_failed', 'Unified diff did not apply cleanly');
    const checkedAgain = await this.guard.resolve(requested);
    this.assertNotSensitive(checkedAgain);
    if (checkedAgain.canonical !== beforeResolved.canonical) {
      throw new ForgeBridgeError('path_changed', 'Path target changed during patch');
    }
    await writeFileAtomic(checkedAgain.canonical, after, 0o600);
    return {
      path: checkedAgain.canonical,
      previousSha256: actualHash,
      sha256: sha256(after),
      bytesWritten: Buffer.byteLength(after),
    };
  }

  async mkdir(requested: string, recursive = true): Promise<{ path: string }> {
    const resolved = await this.guard.resolve(requested);
    this.assertNotSensitive(resolved);
    await mkdir(resolved.canonical, { recursive });
    const checked = await this.guard.resolve(requested);
    this.assertUnchanged({ ...resolved, exists: true }, checked, 'directory create');
    this.assertNotSensitive(checked);
    return { path: checked.canonical };
  }

  async move(
    source: string,
    destination: string,
    overwrite = false,
  ): Promise<Record<string, unknown>> {
    const from = await this.guard.resolve(source, { followFinalSymlink: false });
    const to = await this.guard.resolve(destination, { followFinalSymlink: false });
    this.assertNotSensitive(from);
    this.assertNotSensitive(to);
    if (to.exists && !overwrite) throw new ForgeBridgeError('already_exists', 'Destination exists');
    await mkdir(path.dirname(to.canonical), { recursive: true });
    const checkedFrom = await this.guard.resolve(source, { followFinalSymlink: false });
    const checkedTo = await this.guard.resolve(destination, { followFinalSymlink: false });
    this.assertUnchanged(from, checkedFrom, 'move source');
    this.assertUnchanged(to, checkedTo, 'move destination');
    this.assertNotSensitive(checkedFrom);
    this.assertNotSensitive(checkedTo);
    const sourceInformation = await lstat(checkedFrom.absolute);
    if (sourceInformation.isDirectory()) {
      await this.assertNoSensitiveDescendants(checkedFrom.canonical);
    }
    await rename(checkedFrom.absolute, checkedTo.absolute);
    return { from: checkedFrom.canonical, to: checkedTo.canonical };
  }

  async copy(
    source: string,
    destination: string,
    overwrite = false,
  ): Promise<Record<string, unknown>> {
    const from = await this.guard.resolve(source);
    const to = await this.guard.resolve(destination, { followFinalSymlink: false });
    this.assertNotSensitive(from);
    this.assertNotSensitive(to);
    if (to.exists && !overwrite) throw new ForgeBridgeError('already_exists', 'Destination exists');
    await mkdir(path.dirname(to.canonical), { recursive: true });
    const checkedFrom = await this.guard.resolve(source);
    const checkedTo = await this.guard.resolve(destination, { followFinalSymlink: false });
    this.assertUnchanged(from, checkedFrom, 'copy source');
    this.assertUnchanged(to, checkedTo, 'copy destination');
    this.assertNotSensitive(checkedFrom);
    this.assertNotSensitive(checkedTo);
    const info = await stat(checkedFrom.canonical);
    if (info.isDirectory()) await this.assertNoSensitiveDescendants(checkedFrom.canonical);
    if (info.isDirectory())
      await cp(checkedFrom.canonical, checkedTo.canonical, {
        recursive: true,
        force: overwrite,
        errorOnExist: !overwrite,
      });
    else
      await copyFile(
        checkedFrom.canonical,
        checkedTo.canonical,
        overwrite ? 0 : fileConstants.COPYFILE_EXCL,
      );
    return { from: checkedFrom.canonical, to: checkedTo.canonical };
  }

  async delete(requested: string, recursive = false): Promise<Record<string, unknown>> {
    const resolved = await this.guard.resolve(requested, { followFinalSymlink: false });
    this.assertNotSensitive(resolved);
    if (resolved.canonical === resolved.root) {
      throw new ForgeBridgeError('root_delete_denied', 'Deleting an allowed root is prohibited');
    }
    const checked = await this.guard.resolve(requested, { followFinalSymlink: false });
    this.assertUnchanged(resolved, checked, 'delete');
    this.assertNotSensitive(checked);
    const information = await lstat(checked.absolute);
    if (information.isDirectory()) await this.assertNoSensitiveDescendants(checked.canonical);
    await rm(checked.absolute, { recursive, force: false });
    return { path: checked.canonical, deleted: true };
  }

  private assertNotSensitive(resolved: ResolvedPath): void {
    if (!this.guard.isSensitive(resolved)) return;
    throw new ForgeBridgeError(
      'sensitive_path',
      'Sensitive paths are not available to file tools',
      {
        path: resolved.canonical,
      },
    );
  }

  private assertUnchanged(before: ResolvedPath, after: ResolvedPath, operation: string): void {
    if (before.canonical === after.canonical && before.exists === after.exists) return;
    throw new ForgeBridgeError('path_changed', `Path target changed during ${operation}`);
  }

  private async assertNoSensitiveDescendants(directory: string): Promise<void> {
    const pending = [directory];
    let visited = 0;
    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) break;
      for (const child of await readdir(current, { withFileTypes: true })) {
        visited += 1;
        if (visited > this.#limits.maxFileEntries) {
          throw new ForgeBridgeError(
            'sensitive_scan_limit',
            'Directory mutation exceeds the sensitive-path scan limit',
          );
        }
        const childPath = path.join(current, child.name);
        if (this.guard.isSensitivePath(childPath)) {
          throw new ForgeBridgeError(
            'sensitive_path',
            'Directory contains a sensitive path unavailable to file tools',
            { path: childPath },
          );
        }
        if (child.isDirectory() && !child.isSymbolicLink()) pending.push(childPath);
      }
    }
  }
}

export async function resolveFileScope(guard: PathGuard, requested: string): Promise<ResolvedPath> {
  return guard.resolve(requested, { followFinalSymlink: false });
}
