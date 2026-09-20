import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/manager.js';
import { PathGuard } from '../../src/filesystem/path-guard.js';

describe('BrowserManager', () => {
  let server: Server;
  let origin: string;
  let root: string;
  let browser: BrowserManager;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-browser-'));
    await mkdir(path.join(root, 'artifacts'));
    server = createServer((request, response) => {
      if (request.url === '/download') {
        response.setHeader('Content-Disposition', 'attachment; filename="report.txt"');
        response.end('downloaded');
        return;
      }
      if (request.url === '/too-large') {
        response.setHeader('Content-Disposition', 'attachment; filename="large.bin"');
        response.end('x'.repeat(128 * 1024));
        return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><body>
        <label>Name <input aria-label="Name" /></label>
        <button onclick="document.querySelector('#result').textContent='clicked'">Run</button>
        <a href="/download" download>Download report</a>
        <a href="/too-large" download>Download large file</a>
        <div id="result" role="status">idle</div>
      </body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    origin = `http://127.0.0.1:${address.port}`;
    const guard = await PathGuard.create([root]);
    browser = new BrowserManager({
      headless: true,
      allowedOrigins: ['http://127.0.0.1:*'],
      pathGuard: guard,
      artifactDirectory: path.join(root, 'artifacts'),
      maxTransferBytes: 64 * 1024,
      maxInstances: 1,
    });
  });

  afterEach(async () => {
    await browser.closeAll();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('uses semantic locators, snapshots, screenshots, tabs, and downloads', async () => {
    const session = await browser.launch(origin);
    expect(session.headless).toBe(true);
    await expect(browser.launch(origin)).rejects.toMatchObject({ code: 'resource_limit' });
    const snapshot = await browser.snapshot(session.id);
    expect(snapshot['accessibility']).toContain('button "Run"');
    await browser.type(session.id, { by: 'label', value: 'Name' }, 'ForgeBridge');
    await browser.click(session.id, { by: 'role', role: 'button', name: 'Run' });
    await browser.wait(session.id, { text: 'clicked' });
    const after = await browser.snapshot(session.id);
    expect(after['accessibility']).toContain('clicked');

    await browser.open(session.id, origin, true);
    expect((await browser.tabs(session.id)).pages).toHaveLength(2);

    const screenshot = await browser.screenshot(session.id);
    expect((await readFile(screenshot.path)).byteLength).toBeGreaterThan(100);
    const existingScreenshot = path.join(root, 'artifacts', 'existing.png');
    await writeFile(existingScreenshot, 'preserve-me');
    await expect(
      browser.screenshot(session.id, { path: existingScreenshot }),
    ).rejects.toMatchObject({ code: 'already_exists' });
    expect(await readFile(existingScreenshot, 'utf8')).toBe('preserve-me');

    const download = await browser.download(
      session.id,
      { by: 'role', role: 'link', name: 'Download report' },
      path.join(root, 'artifacts'),
    );
    expect(await readFile(String(download['path']), 'utf8')).toBe('downloaded');

    const filesBeforeOversizedDownload = await readdir(path.join(root, 'artifacts'));
    await expect(
      browser.download(
        session.id,
        { by: 'role', role: 'link', name: 'Download large file' },
        path.join(root, 'artifacts'),
      ),
    ).rejects.toMatchObject({ code: 'transfer_too_large' });
    expect(await readdir(path.join(root, 'artifacts'))).toEqual(filesBeforeOversizedDownload);
  });

  it('blocks an origin outside policy before navigation', async () => {
    const session = await browser.launch();
    await expect(browser.open(session.id, 'https://example.com')).rejects.toMatchObject({
      code: 'origin_denied',
    });
  });

  it('releases browser resources and launches a fresh context after close', async () => {
    const first = await browser.launch(origin);
    await browser.close(first.id);
    const second = await browser.launch(origin);
    expect(second.id).not.toBe(first.id);
    expect((await browser.snapshot(second.id))['accessibility']).toContain('button "Run"');
  });
});
