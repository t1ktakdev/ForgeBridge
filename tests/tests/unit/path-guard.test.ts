import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathGuard } from '../../src/filesystem/path-guard.js';

describe('PathGuard', () => {
  it('allows canonical paths inside a configured root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-root-'));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'index.ts'), 'export {};');
    const guard = await PathGuard.create([root]);
    const result = await guard.resolve(path.join(root, 'src', '..', 'src', 'index.ts'));
    expect(result.root).toBe(await import('node:fs/promises').then((fs) => fs.realpath(root)));
    expect(result.exists).toBe(true);
  });

  it('denies traversal outside an allowed root', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-root-'));
    const root = path.join(parent, 'allowed');
    await mkdir(root);
    const guard = await PathGuard.create([root]);
    await expect(guard.resolve(path.join(root, '..', 'outside.txt'))).rejects.toMatchObject({
      code: 'path_outside_roots',
    });
  });

  it('denies a symlink or junction that escapes the root', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-root-'));
    const root = path.join(parent, 'allowed');
    const outside = path.join(parent, 'outside');
    await mkdir(root);
    await mkdir(outside);
    const link = path.join(root, 'escape');
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const guard = await PathGuard.create([root]);
    await expect(guard.resolve(path.join(link, 'secret.txt'))).rejects.toMatchObject({
      code: 'path_outside_roots',
    });
  });

  it.runIf(process.platform === 'win32')('rejects alternate data streams', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-root-'));
    const guard = await PathGuard.create([root]);
    await expect(guard.resolve(path.join(root, 'file.txt:secret'))).rejects.toMatchObject({
      code: 'invalid_path',
    });
  });

  it('classifies common credential paths as sensitive', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-root-'));
    await writeFile(path.join(root, '.env'), 'TOKEN=value');
    await writeFile(path.join(root, '.npmrc'), '//registry.example/:_authToken=value');
    const guard = await PathGuard.create([root]);
    expect(guard.isSensitive(await guard.resolve(path.join(root, '.env')))).toBe(true);
    expect(guard.isSensitive(await guard.resolve(path.join(root, '.npmrc')))).toBe(true);
  });

  it('protects ForgeBridge state nested below a broad allowed root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-root-'));
    const state = path.join(root, 'state');
    await mkdir(state);
    await writeFile(path.join(state, 'local-token.json'), '{"token":"secret"}');
    const guard = await PathGuard.create([root], [state]);

    expect(guard.isProtected(await guard.resolve(state))).toBe(true);
    expect(guard.isSensitive(await guard.resolve(path.join(state, 'local-token.json')))).toBe(true);
    expect(guard.isSensitivePath(path.join(root, 'ordinary.txt'))).toBe(false);
  });
});
