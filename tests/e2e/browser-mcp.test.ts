import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import { createForgeBridgeMcpServer } from '../../src/mcp/server.js';

type ToolData = Record<string, unknown>;

describe('browser tools over MCP', () => {
  let fixtureServer: Server;
  let origin: string;
  let root: string;
  let uploadPath: string;
  let agent: ForgeBridgeAgent;
  let mcpServer: McpServer;
  let client: Client;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-browser-mcp-'));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-browser-mcp-state-'));
    await mkdir(path.join(root, 'artifacts'));
    uploadPath = path.join(root, 'upload.txt');
    await writeFile(uploadPath, 'uploaded through MCP');

    fixtureServer = createServer((request, response) => {
      if (request.url?.startsWith('/api')) {
        response.setHeader('Content-Type', 'application/json');
        response.end('{"ok":true}');
        return;
      }
      if (request.url === '/download') {
        response.setHeader('Content-Disposition', 'attachment; filename="report.txt"');
        response.end('downloaded through MCP');
        return;
      }
      if (request.url === '/redirect') {
        response.statusCode = 302;
        response.setHeader('Location', 'https://example.com/blocked?access_token=not-for-output');
        response.end();
        return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><body>
        <input type="file" aria-label="Upload file" onchange="document.querySelector('#upload').textContent=this.files[0].name" />
        <button onclick="alert('confirm local action')">Open dialog</button>
        <a href="/download" download>Download report</a>
        <div id="network" role="status">waiting</div>
        <div id="upload" role="status">no upload</div>
        <input aria-label="Keyboard target" value="ready" onkeydown="this.value=event.key" />
        <script>
          console.log('fixture-ready');
          fetch('/api?access_token=not-for-output').then(() => {
            document.querySelector('#network').textContent = 'network done';
          });
        </script>
      </body></html>`);
    });
    await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
    const address = fixtureServer.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    origin = `http://127.0.0.1:${address.port}`;

    const config = defaultConfig(root);
    config.mode = 'full';
    config.browser.maxObservationEntries = 10;
    agent = await ForgeBridgeAgent.create(config, state);
    mcpServer = createForgeBridgeMcpServer(agent, {
      actorId: 'browser-mcp-test',
      sessionId: 'browser-mcp-session',
    });
    client = new Client({ name: 'browser-mcp-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await mcpServer.close();
    await agent.close({ cancelJobs: true });
    await new Promise<void>((resolve, reject) =>
      fixtureServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function call(name: string, argumentsValue: Record<string, unknown>): Promise<ToolData> {
    const result = await client.callTool({ name, arguments: argumentsValue });
    if (result.isError) throw new Error(JSON.stringify(result.structuredContent));
    return (result.structuredContent as { data: ToolData }).data;
  }

  async function callApproved(
    name: string,
    argumentsValue: Record<string, unknown>,
  ): Promise<ToolData> {
    const first = await client.callTool({ name, arguments: argumentsValue });
    expect(first.isError).toBe(true);
    const error = first.structuredContent as {
      error?: { code?: string; details?: { approval?: { id: string } } };
    };
    expect(error.error?.code).toBe('approval_required');
    const approvalId = error.error?.details?.approval?.id;
    if (!approvalId) throw new Error('Approval ID missing');
    await agent.approvals.respond(approvalId, 'once');
    return call(name, { ...argumentsValue, approvalIds: [approvalId] });
  }

  it('observes, uploads, downloads, handles dialogs, and blocks redirect escapes', async () => {
    const session = await call('browser_read', { operation: 'launch' });
    const sessionId = String(session['id']);
    await call('browser_act', { operation: 'open', sessionId, url: origin });
    await call('browser_act', {
      operation: 'wait',
      sessionId,
      text: 'network done',
      timeoutMs: 10_000,
    });

    const observations = await call('browser_read', {
      operation: 'observations',
      sessionId,
      afterSequence: 0,
      limit: 10,
    });
    const entries = observations['entries'] as {
      sequence: number;
      type: string;
      text?: string;
      url?: string;
      status?: number;
    }[];
    expect(
      entries.some((entry) => entry.type === 'console' && entry.text === 'fixture-ready'),
    ).toBe(true);
    expect(entries.some((entry) => entry.type === 'request' && entry.url === `${origin}/api`)).toBe(
      true,
    );
    expect(
      entries.some(
        (entry) =>
          entry.type === 'response' && entry.url === `${origin}/api` && entry.status === 200,
      ),
    ).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('access_token');
    expect(JSON.stringify(entries)).not.toContain('not-for-output');

    const consoleEntries = (
      await call('browser_read', {
        operation: 'console',
        sessionId,
      })
    )['entries'] as { type: string; text?: string }[];
    expect(
      consoleEntries.some((entry) => entry.type === 'console' && entry.text === 'fixture-ready'),
    ).toBe(true);
    const networkEntries = (
      await call('browser_read', {
        operation: 'network',
        sessionId,
      })
    )['entries'] as { type: string }[];
    expect(networkEntries.some((entry) => entry.type === 'request')).toBe(true);
    expect(networkEntries.some((entry) => entry.type === 'response')).toBe(true);

    await call('browser_act', {
      operation: 'press',
      sessionId,
      locator: { by: 'label', value: 'Keyboard target', exact: true },
      key: 'ArrowUp',
    });
    const pressedSnapshot = JSON.stringify(
      await call('browser_read', { operation: 'snapshot', sessionId }),
    );
    expect(pressedSnapshot).toContain('ArrowUp');

    await call('browser_act', {
      operation: 'upload',
      sessionId,
      locator: { by: 'label', value: 'Upload file' },
      files: [uploadPath],
    });
    await call('browser_act', { operation: 'wait', sessionId, text: 'upload.txt' });

    const download = await call('browser_act', {
      operation: 'download',
      sessionId,
      locator: { by: 'role', role: 'link', name: 'Download report' },
      destinationDirectory: path.join(root, 'artifacts'),
    });
    expect(await readFile(String(download['path']), 'utf8')).toBe('downloaded through MCP');

    await call('browser_act', {
      operation: 'click',
      sessionId,
      locator: { by: 'role', role: 'button', name: 'Open dialog' },
      purpose: 'interact',
    });
    expect(await call('browser_read', { operation: 'dialog_status', sessionId })).toMatchObject({
      present: true,
      type: 'alert',
      message: 'confirm local action',
    });
    expect(
      await callApproved('browser_act', { operation: 'dialog', sessionId, action: 'accept' }),
    ).toMatchObject({ present: true, type: 'alert' });
    expect(await call('browser_read', { operation: 'dialog_status', sessionId })).toMatchObject({
      present: false,
    });

    const redirect = await client.callTool({
      name: 'browser_act',
      arguments: { operation: 'open', sessionId, url: `${origin}/redirect` },
    });
    expect(redirect.isError).toBe(true);
    expect(redirect.structuredContent).toMatchObject({ error: { code: 'origin_denied' } });

    for (let index = 0; index < 4; index += 1) {
      await call('browser_act', {
        operation: 'open',
        sessionId,
        url: `${origin}/?iteration=${index}`,
      });
    }
    const expired = await client.callTool({
      name: 'browser_read',
      arguments: { operation: 'observations', sessionId, afterSequence: 0 },
    });
    expect(expired.isError).toBe(true);
    expect(expired.structuredContent).toMatchObject({ error: { code: 'offset_expired' } });
  });
});
