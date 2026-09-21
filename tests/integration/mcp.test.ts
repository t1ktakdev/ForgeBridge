import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import { createForgeBridgeMcpServer } from '../../src/mcp/server.js';

describe('ForgeBridge MCP adapter', () => {
  const agents: ForgeBridgeAgent[] = [];

  afterEach(async () => {
    await Promise.all(agents.map(async (agent) => agent.close({ cancelJobs: true })));
    agents.length = 0;
  });

  it('discovers compact tools and enforces a payload-bound delete approval', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-mcp-root-'));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-mcp-state-'));
    const target = path.join(root, 'delete-me.txt');
    await writeFile(target, 'hello');
    const agent = await ForgeBridgeAgent.create(defaultConfig(root), state);
    agents.push(agent);

    const server = createForgeBridgeMcpServer(agent, {
      actorId: 'test-client',
      sessionId: 'test-session',
    });
    const client = new Client({ name: 'forgebridge-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(client.getInstructions()).toContain('permissions_status');

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'project_inspect',
      'project_scripts',
      'project_check',
      'fs_read',
      'fs_write',
      'terminal',
      'process',
      'jobs',
      'git_read',
      'git_write',
      'browser_read',
      'browser_act',
      'windows_read',
      'windows_act',
      'foreground',
      'system_info',
      'approval_respond',
      'render_status',
      'permissions_status',
      'audit_read',
    ]);
    expect(listed.tools.every((tool) => tool.outputSchema?.type === 'object')).toBe(true);
    expect(listed.tools.find((tool) => tool.name === 'browser_read')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(listed.tools.find((tool) => tool.name === 'windows_read')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(listed.tools.find((tool) => tool.name === 'approval_respond')?._meta).toMatchObject({
      ui: { visibility: ['app'] },
    });
    expect(listed.tools.find((tool) => tool.name === 'render_status')?._meta).toMatchObject({
      ui: { resourceUri: 'ui://forgebridge/status-v1.html' },
      'ui/resourceUri': 'ui://forgebridge/status-v1.html',
      'openai/outputTemplate': 'ui://forgebridge/status-v1.html',
    });
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      'ui://forgebridge/status-v1.html',
    );
    const ui = await client.readResource({ uri: 'ui://forgebridge/status-v1.html' });
    expect(ui.contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
    const firstResource = ui.contents[0];
    const uiText = firstResource && 'text' in firstResource ? firstResource.text : '';
    expect(uiText).toContain('ui/initialize');
    expect(uiText).toContain('let appToken;');
    expect(uiText).not.toMatch(/const appToken = "[^"]+";/u);
    expect(firstResource?._meta).toMatchObject({
      ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
      'openai/widgetPrefersBorder': true,
    });
    const statusResource = await client.readResource({ uri: 'forgebridge://status' });
    const statusText = statusResource.contents[0];
    expect(
      statusText && 'text' in statusText ? JSON.parse(statusText.text) : undefined,
    ).toMatchObject({ paused: false, mode: 'balanced' });
    expect(
      (await agent.audit.list()).entries.some((entry) => entry.tool === 'forgebridge-status'),
    ).toBe(true);

    const rendered = await client.callTool({ name: 'render_status', arguments: {} });
    const appMeta = rendered._meta?.['io.github.t1ktakdev/forgebridge'] as
      { approvalToken?: unknown } | undefined;
    const appToken = appMeta?.approvalToken;
    expect(typeof appToken).toBe('string');
    if (typeof appToken !== 'string') throw new Error('Missing app-only approval capability');
    expect(rendered.isError).not.toBe(true);
    expect(
      (rendered.structuredContent as { data: { recentAudit: unknown[] } }).data.recentAudit,
    ).toBeInstanceOf(Array);

    const windowsStatus = await client.callTool({
      name: 'windows_read',
      arguments: { operation: 'status' },
    });
    expect(windowsStatus.isError).not.toBe(true);
    expect(windowsStatus.structuredContent).toMatchObject({
      data: { enabled: false, supported: process.platform === 'win32' },
    });
    const foregroundStatus = await client.callTool({
      name: 'foreground',
      arguments: { operation: 'status' },
    });
    expect(foregroundStatus.structuredContent).toMatchObject({
      data: { profile: 'background', foregroundAllowed: false, forceHeadlessBrowser: true },
    });

    const read = await client.callTool({
      name: 'fs_read',
      arguments: { operation: 'read', path: target },
    });
    expect(read.isError).not.toBe(true);
    expect((read.structuredContent as { data: { content: string } }).data.content).toBe('hello');

    const blocked = await client.callTool({
      name: 'fs_write',
      arguments: { operation: 'delete', path: target },
    });
    expect(blocked.isError).toBe(true);
    const approval = (
      blocked.structuredContent as { error: { details: { approval: { id: string } } } }
    ).error.details.approval;
    expect(await readFile(target, 'utf8')).toBe('hello');

    const rejectedApproval = await client.callTool({
      name: 'approval_respond',
      arguments: { approvalId: approval.id, response: 'once', appToken: 'x'.repeat(32) },
    });
    expect(rejectedApproval.isError).toBe(true);
    expect(rejectedApproval.structuredContent).toMatchObject({
      error: { code: 'invalid_app_approval_token' },
    });

    const appApproved = await client.callTool({
      name: 'approval_respond',
      arguments: { approvalId: approval.id, response: 'once', appToken },
    });
    expect(appApproved.isError).not.toBe(true);
    expect(appApproved.structuredContent).toMatchObject({
      data: { approvalId: approval.id, status: 'approved', response: 'once' },
    });
    const removed = await client.callTool({
      name: 'fs_write',
      arguments: { operation: 'delete', path: target, approvalIds: [approval.id] },
    });
    expect(removed.isError).not.toBe(true);
    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      (await agent.audit.list(0, 100)).entries.some(
        (entry) => entry.result === 'approval_required',
      ),
    ).toBe(true);

    await client.close();
    await server.close();
  });
});
