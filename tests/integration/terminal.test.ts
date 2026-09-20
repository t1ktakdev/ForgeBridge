import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalManager } from '../../src/terminal/manager.js';
import { processExists } from '../../src/terminal/process-utils.js';

const managers: TerminalManager[] = [];

async function eventually(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map(async (manager) => manager.close()));
});

describe('TerminalManager', () => {
  it('captures stdout, stderr, and exit code separately', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-terminal-'));
    const manager = new TerminalManager(64 * 1024, 10_000);
    managers.push(manager);
    const command =
      process.platform === 'win32'
        ? "[Console]::Out.WriteLine('out'); [Console]::Error.WriteLine('err'); exit 7"
        : "printf 'out\\n'; printf 'err\\n' >&2; exit 7";
    const result = await manager.run({ command, workingDirectory: root });
    expect(result.stdout).toContain('out');
    expect(result.stderr).toContain('err');
    expect(result.exitCode).toBe(7);
  });

  it('times out and terminates a long process', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-terminal-'));
    const manager = new TerminalManager(64 * 1024, 10_000);
    managers.push(manager);
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 10' : 'sleep 10';
    const started = Date.now();
    const result = await manager.run({ command, workingDirectory: root, timeoutMs: 250 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('reports cancellation and terminates the owned process tree', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-terminal-'));
    const manager = new TerminalManager(64 * 1024, 10_000);
    managers.push(manager);
    const controller = new AbortController();
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20';
    const started = Date.now();
    const running = manager.run({
      command,
      workingDirectory: root,
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort('test cancellation'), 100);
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('does not leave a spawned child behind after cancellation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-terminal-'));
    const script = path.join(root, 'tree-parent.mjs');
    const pidFile = path.join(root, 'child.pid');
    await writeFile(
      script,
      "import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); writeFileSync('child.pid',String(child.pid)); setInterval(()=>{},1000);\n",
    );
    const manager = new TerminalManager(64 * 1024, 30_000);
    managers.push(manager);
    const controller = new AbortController();
    const running = manager.run({
      command: 'node tree-parent.mjs',
      workingDirectory: root,
      signal: controller.signal,
    });
    await eventually(async () =>
      access(pidFile)
        .then(() => true)
        .catch(() => false),
    );
    const childPid = Number(await readFile(pidFile, 'utf8'));
    expect(processExists(childPid)).toBe(true);
    controller.abort('terminate tree');
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    await eventually(() => !processExists(childPid));
  });

  it('bounds huge output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-terminal-'));
    const manager = new TerminalManager(2048, 10_000);
    managers.push(manager);
    const command =
      process.platform === 'win32'
        ? "[Console]::Out.Write(('x' * 10000))"
        : "printf '%010000d' 0 | tr '0' x";
    const result = await manager.run({ command, workingDirectory: root });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(2048);
    expect(result.truncated).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    'does not resolve cmd.exe from a caller-controlled ComSpec path',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-terminal-'));
      const marker = path.join(root, 'fake-cmd-ran.txt');
      const fake = path.join(root, 'cmd.cmd');
      await writeFile(fake, `@echo pwned>"${marker}"\r\n@exit /b 1\r\n`);
      const originalComSpec = process.env['ComSpec'];
      process.env['ComSpec'] = fake;
      const manager = new TerminalManager(64 * 1024, 10_000);
      managers.push(manager);
      try {
        await expect(
          manager.run({ command: 'echo trusted-cmd', workingDirectory: root, shell: 'cmd' }),
        ).resolves.toMatchObject({ exitCode: 0 });
      } finally {
        if (originalComSpec === undefined) delete process.env['ComSpec'];
        else process.env['ComSpec'] = originalComSpec;
      }
      await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.runIf(process.platform === 'win32')(
    'supports interactive ConPTY input and output',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-terminal-'));
      const manager = new TerminalManager(64 * 1024, 10_000);
      managers.push(manager);
      const session = manager.start({
        command: "$answer=Read-Host 'value'; Write-Output ('got:'+ $answer); exit",
        workingDirectory: root,
        shell: 'powershell',
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      manager.input(session.id, 'forge', true);
      await eventually(() => manager.read(session.id).state.status === 'exited');
      const output = manager.read(session.id, 0, 64 * 1024);
      expect(output.data).toContain('got:forge');
      expect(output.state.status).toBe('exited');
    },
  );
});
