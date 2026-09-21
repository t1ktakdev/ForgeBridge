import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isMainModule } from '../../src/core/entrypoint.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-entrypoint-'));
  temporary.push(root);
  const directory = path.join(root, 'real directory');
  await mkdir(directory);
  const entry = path.join(directory, 'cli #.mjs');
  await writeFile(entry, '');
  return { root, directory, entry, url: pathToFileURL(entry).href };
}

describe('CLI entrypoint detection', () => {
  it('recognizes direct execution with URL-sensitive filename characters', async () => {
    const { entry, url } = await fixture();
    expect(isMainModule(url, entry)).toBe(true);
  });

  it('does not run an imported module or a missing entrypoint', async () => {
    const { url, root } = await fixture();
    expect(isMainModule(url, fileURLToPath(import.meta.url))).toBe(false);
    expect(isMainModule(url, path.join(root, 'missing.mjs'))).toBe(false);
    expect(isMainModule(url, '')).toBe(false);
  });

  it('recognizes an aliased temporary directory, including Windows junctions', async () => {
    const { root, directory, entry, url } = await fixture();
    const alias = path.join(root, 'directory alias');
    await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasEntry = path.join(alias, path.basename(entry));
    expect(isMainModule(url, aliasEntry)).toBe(true);
    expect(isMainModule(pathToFileURL(aliasEntry).href, entry)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('recognizes a POSIX npm bin symlink', async () => {
    const { root, entry, url } = await fixture();
    const bin = path.join(root, 'forgebridge');
    await symlink(entry, bin);
    expect(isMainModule(url, bin)).toBe(true);
  });
});
