import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/core/json.js';
import { FileService } from '../../src/filesystem/service.js';
import { PathGuard } from '../../src/filesystem/path-guard.js';

async function service(root: string, protectedPaths: readonly string[] = []): Promise<FileService> {
  return new FileService(await PathGuard.create([root], protectedPaths), {
    maxReadBytes: 1024,
    maxFileEntries: 100,
    maxTreeDepth: 8,
    maxOutputBytes: 64 * 1024,
  });
}

describe('FileService', () => {
  it('creates, reads, patches, and paginates files with version checks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-fs-'));
    const files = await service(root);
    const target = path.join(root, 'hello.txt');
    await files.create(target, 'hello\nworld\n');
    const first = await files.read(target);
    expect(first['content']).toBe('hello\nworld\n');
    expect(first['sha256']).toBe(sha256('hello\nworld\n'));

    await files.patch(
      target,
      '@@ -1,2 +1,2 @@\n hello\n-world\n+ForgeBridge\n',
      String(first['sha256']),
    );
    expect(await readFile(target, 'utf8')).toBe('hello\nForgeBridge\n');
    await expect(
      files.patch(target, '@@ -1 +1 @@\n-hello\n+bye\n', String(first['sha256'])),
    ).rejects.toMatchObject({ code: 'version_conflict' });

    const patched = await files.read(target);
    await files.update(target, 'whole-file update\n', String(patched['sha256']));
    expect(await readFile(target, 'utf8')).toBe('whole-file update\n');
    await expect(
      files.update(target, 'stale update\n', String(patched['sha256'])),
    ).rejects.toMatchObject({ code: 'version_conflict' });

    await files.create(path.join(root, 'a.txt'), 'a');
    await files.create(path.join(root, 'b.txt'), 'b');
    const pageOne = await files.list(root, { limit: 2 });
    expect(pageOne.entries).toHaveLength(2);
    expect(pageOne.nextCursor).toBeTruthy();
    const pageTwo = await files.list(root, { limit: 2, cursor: pageOne.nextCursor });
    expect(pageTwo.entries).toHaveLength(1);
  });

  it('returns bounded byte ranges for large files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-fs-'));
    const files = await service(root);
    const target = path.join(root, 'large.txt');
    await writeFile(target, 'x'.repeat(5000));
    const result = await files.read(target, { offset: 1000, length: 4000 });
    expect(result['bytesRead']).toBe(1024);
    expect(result['eof']).toBe(false);
  });

  it('does not follow a final symlink while deleting', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-fs-'));
    const root = path.join(parent, 'root');
    const outside = path.join(parent, 'outside');
    await import('node:fs/promises').then((fs) => fs.mkdir(root));
    await import('node:fs/promises').then((fs) => fs.mkdir(outside));
    await writeFile(path.join(outside, 'keep.txt'), 'keep');
    const link = path.join(root, 'link');
    await import('node:fs/promises').then((fs) =>
      fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'),
    );
    const files = await service(root);
    await files.delete(link, true);
    expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('refuses to delete the allowed root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-fs-'));
    const files = await service(root);
    await expect(files.delete(root, true)).rejects.toMatchObject({ code: 'root_delete_denied' });
  });

  it('does not disclose or mutate sensitive files or protected agent state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-fs-'));
    const state = path.join(root, '.agent-state');
    const sensitiveNeedle = ['value-not-recognized', '-by-generic-redaction'].join('');
    await mkdir(state);
    await writeFile(path.join(state, 'local-token.json'), sensitiveNeedle);
    await writeFile(path.join(root, '.env.local'), `CUSTOM_VALUE=${sensitiveNeedle}\n`);
    await writeFile(path.join(root, 'ordinary.txt'), 'ordinary needle\n');
    const files = await service(root, [state]);

    await expect(files.read(path.join(state, 'local-token.json'))).rejects.toMatchObject({
      code: 'sensitive_path',
    });
    await expect(
      files.copy(path.join(root, '.env.local'), path.join(root, 'copied.txt')),
    ).rejects.toMatchObject({ code: 'sensitive_path' });
    await expect(files.delete(state, true)).rejects.toMatchObject({ code: 'sensitive_path' });
    await expect(files.create(path.join(state, 'config.json'), '{}', true)).rejects.toMatchObject({
      code: 'sensitive_path',
    });

    const listed = await files.list(root);
    expect(listed.entries.map((entry) => entry.name)).toEqual(['ordinary.txt']);
    const tree = await files.tree(root);
    expect(JSON.stringify(tree)).not.toContain('.agent-state');
    expect(JSON.stringify(tree)).not.toContain('.env.local');
    const search = await files.searchContent(root, sensitiveNeedle);
    expect(search.matches).toEqual([]);
  });

  it('blocks directory mutations that would encompass sensitive descendants', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-fs-'));
    const source = path.join(root, 'source');
    const protectedState = path.join(source, 'nested-state');
    await mkdir(protectedState, { recursive: true });
    await writeFile(path.join(source, 'ordinary.txt'), 'ordinary\n');
    await writeFile(path.join(source, '.env'), 'PRIVATE_VALUE=not-for-tools\n');
    await writeFile(path.join(protectedState, 'config.json'), '{}\n');
    const files = await service(root, [protectedState]);

    await expect(files.copy(source, path.join(root, 'copy'))).rejects.toMatchObject({
      code: 'sensitive_path',
    });
    await expect(files.move(source, path.join(root, 'moved'))).rejects.toMatchObject({
      code: 'sensitive_path',
    });
    await expect(files.delete(source, true)).rejects.toMatchObject({ code: 'sensitive_path' });

    expect(await readFile(path.join(source, 'ordinary.txt'), 'utf8')).toBe('ordinary\n');
  });

  it('searches content internally with regex, glob, and output limits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-fs-'));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'index.ts'), 'first needle\nsecond needle\n');
    await writeFile(path.join(root, 'src', 'ignore.txt'), 'needle\n');
    const files = await service(root);

    const result = await files.searchContent(root, '^second needle$', {
      glob: '**/*.ts',
      maxResults: 10,
    });
    expect(result.matches).toMatchObject([
      { path: { text: path.join(root, 'src', 'index.ts') }, line_number: 2 },
    ]);
    await expect(files.searchContent(root, '[')).rejects.toMatchObject({
      code: 'invalid_search_pattern',
    });
    expect((await files.searchContent(root, 'needle', { maxResults: 1 })).truncated).toBe(true);
  });

  it('bounds patch input and isolates pathological regular expressions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-fs-'));
    const large = path.join(root, 'large.txt');
    await writeFile(large, `${'a'.repeat(128 * 1024)}!`);
    const pathological = path.join(root, 'pathological.txt');
    await writeFile(pathological, `${'a'.repeat(900)}!`);
    const files = await service(root);

    const partial = await files.read(large, { length: 32 });
    expect(partial['sha256']).toBe(sha256(`${'a'.repeat(128 * 1024)}!`));
    await expect(
      files.patch(large, '@@ -1 +1 @@\n-a\n+b\n', String(partial['sha256'])),
    ).rejects.toMatchObject({
      code: 'file_too_large',
    });
    await expect(
      files.searchContent(root, '(a+)+$', { glob: path.basename(pathological), timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: 'search_timeout' });
  });
});
