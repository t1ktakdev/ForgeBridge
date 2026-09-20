import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';
import { PathGuard } from '../../src/filesystem/path-guard.js';
import { GitService } from '../../src/git/service.js';

const execFileAsync = promisify(execFile);

describe('GitService', () => {
  let root: string;
  let git: GitService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-git-'));
    await execFileAsync('git', ['init'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'ForgeBridge Test'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'forgebridge@example.invalid'], {
      cwd: root,
    });
    await writeFile(path.join(root, 'README.md'), '# fixture\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: root });
    git = new GitService(await PathGuard.create([root]), 1024 * 1024, 10_000);
  });

  it('reads status and diff and creates a commit with the existing author config', async () => {
    await writeFile(path.join(root, 'README.md'), '# fixture\nchanged\n');
    const status = await git.status(root);
    expect(status.stdout).toContain('README.md');
    expect(status.provenance).toBe('untrusted_repository_content');
    expect((await git.diff(root)).stdout).toContain('+changed');
    await git.add(root, ['README.md']);
    const preflight = await git.preflightCommit(root);
    expect(preflight.findings).toEqual([]);
    expect(preflight.stagedDiff).toContain('+changed');
    await git.commit(root, 'change fixture');
    const log = await git.log(root, 1);
    expect(log.stdout).toContain('change fixture');
    expect(log.stdout).toContain('ForgeBridge Test');
    const shown = await git.show(root, 'HEAD');
    expect(shown.stdout).toContain('change fixture');
    expect(shown.stdout).toContain('+changed');
  });

  it('blocks sensitive filenames before commit', async () => {
    await writeFile(path.join(root, '.env'), 'VALUE=very-secret-value\n');
    await git.add(root, ['.env']);
    const preflight = await git.preflightCommit(root);
    expect(preflight.findings).toContainEqual({ path: '.env', rule: 'sensitive-filename' });
    await expect(git.commit(root, 'unsafe')).rejects.toMatchObject({ code: 'secret_scan_failed' });
  });

  it('blocks secret-like added lines without returning the secret', async () => {
    await mkdir(path.join(root, 'src'));
    const secretKeyName = ['api', 'key'].join('_');
    const fakeSecretValue = ['abcdefghijkl', 'mnop123456\\n'].join('');
    await writeFile(path.join(root, 'src', 'config.txt'), `${secretKeyName}=${fakeSecretValue}`);
    await git.add(root, ['src/config.txt']);
    const preflight = await git.preflightCommit(root);
    expect(preflight.findings).toContainEqual({
      path: 'src/config.txt',
      rule: 'secret-assignment',
    });
    expect(JSON.stringify(preflight.findings)).not.toContain(fakeSecretValue);
  });

  it('rejects ref option injection', async () => {
    await expect(git.createBranch(root, '--upload-pack=evil')).rejects.toMatchObject({
      code: 'invalid_git_ref',
    });
    await expect(git.createBranch(root, 'safe-name', '--upload-pack=evil')).rejects.toMatchObject({
      code: 'invalid_git_ref',
    });
  });

  it('disables repository hooks for agent-owned Git operations', async () => {
    const marker = path.join(root, 'hook-ran.txt');
    const hook = path.join(root, '.git', 'hooks', 'pre-commit');
    const portableMarker = marker.replaceAll('\\', '/');
    await writeFile(hook, `#!/bin/sh\nprintf pwned > "${portableMarker}"\nexit 1\n`);
    await chmod(hook, 0o755);
    await execFileAsync('git', ['config', 'commit.gpgSign', 'true'], { cwd: root });
    await writeFile(path.join(root, 'README.md'), '# fixture\nsafe change\n');
    await git.add(root, ['README.md']);

    await expect(git.commit(root, 'safe commit')).resolves.toMatchObject({ exitCode: 0 });
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not resolve the Git executable from malicious repository content', async () => {
    const marker = path.join(root, 'fake-git-ran.txt');
    const fake = path.join(root, process.platform === 'win32' ? 'git.cmd' : 'git');
    await writeFile(
      fake,
      process.platform === 'win32'
        ? `@echo pwned>"${marker}"\r\n@exit /b 1\r\n`
        : `#!/bin/sh\nprintf pwned > "${marker}"\nexit 1\n`,
    );
    await chmod(fake, 0o755);
    const originalPath = process.env['PATH'];
    process.env['PATH'] = `${root}${path.delimiter}${originalPath ?? ''}`;
    try {
      const isolated = new GitService(await PathGuard.create([root]), 1024 * 1024, 10_000);
      await expect(isolated.status(root)).resolves.toMatchObject({ exitCode: 0 });
    } finally {
      if (originalPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = originalPath;
    }
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not execute repository-configured content filters or text converters', async () => {
    const cleanMarker = path.join(root, 'clean-filter-ran.txt');
    const textconvMarker = path.join(root, 'textconv-ran.txt');
    const helper = path.join(root, 'malicious-filter.mjs');
    const quote = (value: string): string =>
      `"${value.replaceAll('\\', '/').replaceAll('"', '\\"')}"`;
    await writeFile(
      helper,
      "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], 'ran'); process.stdin.pipe(process.stdout);\n",
    );
    await writeFile(path.join(root, '.gitattributes'), '*.txt filter=evil diff=evil\n');
    await writeFile(path.join(root, 'payload.txt'), 'safe payload\n');
    await execFileAsync(
      'git',
      [
        'config',
        'filter.evil.clean',
        `${quote(process.execPath)} ${quote(helper)} ${quote(cleanMarker)}`,
      ],
      { cwd: root },
    );
    await execFileAsync(
      'git',
      [
        'config',
        'diff.evil.textconv',
        `${quote(process.execPath)} ${quote(helper)} ${quote(textconvMarker)}`,
      ],
      { cwd: root },
    );

    await git.add(root, ['.gitattributes', 'payload.txt']);
    await expect(access(cleanMarker)).rejects.toMatchObject({ code: 'ENOENT' });
    await git.commit(root, 'add filtered fixture');
    await writeFile(path.join(root, 'payload.txt'), 'changed payload\n');
    await expect(git.diff(root)).resolves.toMatchObject({ exitCode: 0 });
    await expect(git.status(root)).resolves.toMatchObject({ exitCode: 0 });
    await expect(access(cleanMarker)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(textconvMarker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
