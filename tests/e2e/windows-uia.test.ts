import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import { createForgeBridgeMcpServer } from '../../src/mcp/server.js';

const execFileAsync = promisify(execFile);
const nativeIt =
  process.platform === 'win32' && process.env['FORGEBRIDGE_NATIVE_UIA_TEST'] === '1' ? it : it.skip;

type WindowSummary = {
  name: string;
  className: string;
  processId: number;
  windowHandle: number;
};

describe('Windows UI Automation over MCP', () => {
  let agent: ForgeBridgeAgent | undefined;
  let mcpServer: McpServer | undefined;
  let client: Client | undefined;
  const ownedProcessIds = new Set<number>();

  afterEach(async () => {
    await client?.close();
    await mcpServer?.close();
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
    'edits Notepad and operates Calculator through semantic control patterns',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-uia-root-'));
      const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-uia-state-'));
      const config = defaultConfig(root);
      config.mode = 'full';
      config.windowsUiAutomation.enabled = true;
      agent = await ForgeBridgeAgent.create(config, state);
      mcpServer = createForgeBridgeMcpServer(agent, {
        actorId: 'windows-uia-test',
        sessionId: 'windows-uia-session',
      });
      client = new Client({ name: 'windows-uia-client', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const call = async (name: string, argumentsValue: Record<string, unknown>) => {
        const result = await client?.callTool({ name, arguments: argumentsValue });
        if (!result || result.isError) throw new Error(JSON.stringify(result?.structuredContent));
        return (result.structuredContent as { data: Record<string, unknown> }).data;
      };
      const callApproved = async (name: string, argumentsValue: Record<string, unknown>) => {
        const first = await client?.callTool({ name, arguments: argumentsValue });
        if (!first?.isError) throw new Error('Expected a local approval request');
        const approvalId = (
          first.structuredContent as {
            error?: { details?: { approval?: { id?: string } } };
          }
        ).error?.details?.approval?.id;
        if (!approvalId) throw new Error('Approval ID missing');
        await agent?.approvals.respond(approvalId, 'once');
        return call(name, { ...argumentsValue, approvalIds: [approvalId] });
      };
      const listWindows = async (): Promise<WindowSummary[]> => {
        const result = await call('windows_read', { operation: 'windows', limit: 500 });
        return result['windows'] as WindowSummary[];
      };
      const waitForWindow = async (
        knownHandles: Set<number>,
        predicate: (window: WindowSummary) => boolean,
      ): Promise<WindowSummary> => {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const found = (await listWindows()).find(
            (window) => !knownHandles.has(window.windowHandle) && predicate(window),
          );
          if (found) return found;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('Timed out waiting for native fixture window');
      };
      const invoke = async (target: { windowHandle: number }, automationId: string) => {
        await call('windows_act', {
          operation: 'invoke',
          target,
          locator: { by: 'automationId', value: automationId },
          purpose: 'interact',
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
      };

      const status = await call('windows_read', { operation: 'status' });
      expect(status).toMatchObject({ enabled: true, supported: true, desktopAvailable: true });
      expect(String(status['limitation'])).toContain('higher-integrity');

      const beforeNotepad = new Set((await listWindows()).map((window) => window.windowHandle));
      const fileName = `forgebridge-uia-${Date.now()}.txt`;
      const file = path.join(root, fileName);
      await writeFile(file, 'before');
      spawn('notepad.exe', [file], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      const notepad = await waitForWindow(beforeNotepad, (window) =>
        window.name.includes(fileName),
      );
      ownedProcessIds.add(notepad.processId);
      const notepadTarget = { windowHandle: notepad.windowHandle };
      let documentElement: { controlType: string; patterns: string[]; value?: string } | undefined;
      const loadDeadline = Date.now() + 10_000;
      while (Date.now() < loadDeadline && documentElement?.value !== 'before') {
        const beforeEdit = await call('windows_read', {
          operation: 'snapshot',
          target: notepadTarget,
          depth: 12,
          maxElements: 500,
        });
        documentElement = (
          beforeEdit['elements'] as { controlType: string; patterns: string[]; value?: string }[]
        ).find(
          (element) => element.controlType === 'Document' && element.patterns.includes('Value'),
        );
      }
      expect(documentElement?.value).toBe('before');
      const screenshot = await call('windows_read', {
        operation: 'screenshot',
        target: notepadTarget,
      });
      expect((await readFile(String(screenshot['path']))).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      const existingScreenshot = path.join(root, 'existing-uia.png');
      await writeFile(existingScreenshot, 'preserve-me');
      const refusedScreenshot = await client.callTool({
        name: 'windows_read',
        arguments: {
          operation: 'screenshot',
          target: notepadTarget,
          path: existingScreenshot,
        },
      });
      expect(refusedScreenshot.isError).toBe(true);
      expect(refusedScreenshot.structuredContent).toMatchObject({
        error: { code: 'already_exists' },
      });
      expect(await readFile(existingScreenshot, 'utf8')).toBe('preserve-me');
      const literalText = 'updated $([Environment]::MachineName) semantically';
      await call('windows_act', {
        operation: 'set_value',
        target: notepadTarget,
        locator: { by: 'controlType', value: 'Document' },
        value: literalText,
        purpose: 'interact',
      });
      let editedValue = '';
      const editDeadline = Date.now() + 10_000;
      while (Date.now() < editDeadline && editedValue.trim() !== literalText) {
        const afterEdit = await call('windows_read', {
          operation: 'snapshot',
          target: notepadTarget,
          depth: 4,
          maxElements: 100,
        });
        editedValue =
          (afterEdit['elements'] as { controlType: string; value?: string }[]).find(
            (element) => element.controlType === 'Document',
          )?.value ?? '';
      }
      expect(editedValue.trim()).toBe(literalText);

      const beforeCalculator = new Set((await listWindows()).map((window) => window.windowHandle));
      spawn('calc.exe', [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      const calculator = await waitForWindow(beforeCalculator, (window) =>
        /ApplicationFrameWindow|CalcFrame/u.test(window.className),
      );
      ownedProcessIds.add(calculator.processId);
      const calculatorTarget = { windowHandle: calculator.windowHandle };
      await invoke(calculatorTarget, 'clearButton');
      await invoke(calculatorTarget, 'num7Button');
      await invoke(calculatorTarget, 'plusButton');
      await invoke(calculatorTarget, 'num3Button');
      await callApproved('windows_act', {
        operation: 'invoke',
        target: calculatorTarget,
        locator: { by: 'automationId', value: 'equalButton' },
        purpose: 'submit',
      });

      const deadline = Date.now() + 5000;
      let resultName = '';
      while (Date.now() < deadline && !resultName.includes('10')) {
        const calculatorSnapshot = await call('windows_read', {
          operation: 'snapshot',
          target: calculatorTarget,
          depth: 12,
          maxElements: 1000,
        });
        resultName =
          (calculatorSnapshot['elements'] as { automationId: string; name: string }[]).find(
            (element) => element.automationId === 'CalculatorResults',
          )?.name ?? '';
      }
      expect(resultName).toContain('10');
    },
    90_000,
  );
});
