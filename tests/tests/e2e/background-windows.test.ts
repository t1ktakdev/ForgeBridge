import { execFile, spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';

const execFileAsync = promisify(execFile);
const nativeIt =
  process.platform === 'win32' && process.env['FORGEBRIDGE_NATIVE_UIA_TEST'] === '1' ? it : it.skip;

type WindowSummary = {
  name: string;
  className: string;
  processId: number;
  windowHandle: number;
};

type DesktopState = {
  clipboardSequence: number;
  cursorX: number;
  cursorY: number;
  foregroundWindow: number;
};

async function desktopState(): Promise<DesktopState> {
  const script = String.raw`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ForgeBridgeDesktopState {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
}
'@
$point = [ForgeBridgeDesktopState+POINT]::new()
if (-not [ForgeBridgeDesktopState]::GetCursorPos([ref]$point)) { throw 'GetCursorPos failed' }
[Console]::Write((@{
  clipboardSequence = [long][ForgeBridgeDesktopState]::GetClipboardSequenceNumber()
  cursorX = $point.X
  cursorY = $point.Y
  foregroundWindow = [long][ForgeBridgeDesktopState]::GetForegroundWindow()
} | ConvertTo-Json -Compress))`;
  const result = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true },
  );
  return JSON.parse(result.stdout) as DesktopState;
}

async function foregroundWindow(): Promise<number> {
  return (await desktopState()).foregroundWindow;
}

async function eventually<T>(
  read: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for native fixture state');
}

describe('Windows background execution', () => {
  let agent: ForgeBridgeAgent | undefined;
  const ownedProcessIds = new Set<number>();

  afterEach(async () => {
    await agent?.close({ cancelJobs: true });
    await Promise.all(
      [...ownedProcessIds].map(async (processId) => {
        await execFileAsync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {
          windowsHide: true,
        }).catch(() => undefined);
      }),
    );
    ownedProcessIds.clear();
  });

  nativeIt(
    'keeps a harmless foreground fixture active during background-safe work',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-background-root-'));
      const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-background-state-'));
      const file = path.join(root, `focus-fixture-${Date.now()}.txt`);
      await writeFile(file, 'before');
      const config = defaultConfig(root);
      config.mode = 'full';
      config.windowsUiAutomation.enabled = true;
      config.execution.backgroundMode = false;
      config.execution.profile = 'normal';
      agent = await ForgeBridgeAgent.create(config, state);

      const known = new Set(
        ((await agent.windowsUiAutomation.windows(500))['windows'] as WindowSummary[]).map(
          (window) => window.windowHandle,
        ),
      );
      spawn('notepad.exe', [file], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      const fixture = await eventually(async () =>
        ((await agent?.windowsUiAutomation.windows(500))?.['windows'] as WindowSummary[]).find(
          (window) => !known.has(window.windowHandle) && window.name.includes(path.basename(file)),
        ),
      );
      ownedProcessIds.add(fixture.processId);
      const target = { windowHandle: fixture.windowHandle };
      await agent.windowsUiAutomation.act(target, { by: 'controlType', value: 'Window' }, 'focus');
      await eventually(async () =>
        (await foregroundWindow()) === fixture.windowHandle ? fixture.windowHandle : undefined,
      );
      await agent.setExecutionProfile('gaming');
      const before = await desktopState();
      const visibleBefore = new Set(
        ((await agent.windowsUiAutomation.windows(500))['windows'] as WindowSummary[]).map(
          (window) => window.windowHandle,
        ),
      );

      await agent.files.create(path.join(root, 'background.txt'), 'safe');
      expect(
        (
          await agent.terminal.run({
            command: "Write-Output 'background-terminal'",
            workingDirectory: root,
          })
        ).stdout,
      ).toContain('background-terminal');
      const job = await agent.jobs.start({
        command: 'node -e "setTimeout(()=>console.log(\'background-job\'),2000)"',
        workingDirectory: root,
      });
      await eventually(() =>
        agent?.jobs.status(job.id).status === 'running' ? job.id : undefined,
      );
      const windowsDuringJob = (await agent.windowsUiAutomation.windows(500))[
        'windows'
      ] as WindowSummary[];
      expect(
        windowsDuringJob.some(
          (window) =>
            !visibleBefore.has(window.windowHandle) &&
            (/ConsoleWindowClass|CASCADIA_HOSTING_WINDOW/iu.test(window.className) ||
              /PowerShell|Command Prompt/iu.test(window.name)),
        ),
      ).toBe(false);
      await eventually(() =>
        agent?.jobs.status(job.id).status === 'succeeded' ? job.id : undefined,
      );
      await agent.terminal.run({ command: 'git init --quiet', workingDirectory: root });
      expect((await agent.git.status(root)).stdout).toContain('No commits yet');
      const browser = await agent.browser.launch();
      expect(browser.headless).toBe(true);

      await agent.windowsUiAutomation.act(
        target,
        { by: 'controlType', value: 'Document' },
        'set_value',
        'background-safe semantic edit',
      );
      const after = await desktopState();
      expect(after.foregroundWindow).toBe(before.foregroundWindow);
      expect({ x: after.cursorX, y: after.cursorY }).toEqual({
        x: before.cursorX,
        y: before.cursorY,
      });
      expect(after.clipboardSequence).toBe(before.clipboardSequence);
      const windowsAfter = (await agent.windowsUiAutomation.windows(500))[
        'windows'
      ] as WindowSummary[];
      expect(
        windowsAfter.some(
          (window) =>
            !known.has(window.windowHandle) && /chrome|chromium|msedge/iu.test(window.className),
        ),
      ).toBe(false);

      await expect(
        agent.windowsUiAutomation.act(target, { by: 'controlType', value: 'Window' }, 'focus'),
      ).rejects.toMatchObject({ code: 'foreground_required' });
      const [pending] = agent.foregroundActions.list(['pending']);
      if (!pending) throw new Error('Expected a deferred foreground action');
      await agent.respondForegroundAction(pending.id, 'approve');
      expect(agent.foregroundActions.get(pending.id).status).toBe('approved');
      await agent.setExecutionProfile('normal');
      expect(agent.foregroundActions.get(pending.id).status).toBe('completed');
    },
    120_000,
  );
});
