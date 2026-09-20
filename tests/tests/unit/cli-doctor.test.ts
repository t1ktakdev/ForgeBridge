import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';

const temporaryDirectories: string[] = [];

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-doctor-'));
  temporaryDirectories.push(base);
  const root = path.join(base, 'project');
  const state = path.join(base, 'state');
  await mkdir(root);
  return { root, state };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('forgebridge doctor', () => {
  it('explains an uninitialized install and validates an initialized one', async () => {
    const { root, state } = await fixture();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    };

    const beforeCode = await runCli(['doctor', '--state', state], io);
    const beforeText = stdout.at(-1) ?? '{}';
    const before: unknown = JSON.parse(beforeText);
    expect(beforeCode).toBe(1);
    expect(before).toMatchObject({ ok: false, initialized: false });
    expect(beforeText).toContain('"name": "config"');
    expect(beforeText).toContain('"status": "fail"');
    expect(beforeText).toContain('forgebridge init --root');

    stdout.length = 0;
    expect(await runCli(['init', '--root', root, '--state', state], io)).toBe(0);

    stdout.length = 0;
    const afterCode = await runCli(['doctor', '--state', state], io);
    const afterText = stdout.at(-1) ?? '{}';
    const after: unknown = JSON.parse(afterText);
    expect(afterCode).toBe(0);
    expect(after).toMatchObject({
      ok: true,
      initialized: true,
      roots: [{ path: path.resolve(root), exists: true }],
    });
    expect(afterText).toContain('"name": "node"');
    expect(afterText).toContain('"name": "config"');
    expect(afterText).toContain('"name": "agent"');
    expect(afterText).toContain('"status": "warn"');
    expect(stderr).toEqual([]);
  });
});
