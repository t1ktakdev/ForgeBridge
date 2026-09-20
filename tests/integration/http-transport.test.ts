import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import { LocalTokenStore } from '../../src/core/local-token.js';
import { LocalHttpTransportServer } from '../../src/transports/http.js';

describe('loopback HTTP transport', () => {
  let http: LocalHttpTransportServer | undefined;
  let agent: ForgeBridgeAgent | undefined;

  afterEach(async () => {
    await http?.close();
    await agent?.close({ cancelJobs: true });
  });

  it('requires a bearer token, rejects foreign origins, and serves MCP tools', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-http-root-'));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-http-state-'));
    agent = await ForgeBridgeAgent.create(defaultConfig(root), state);
    const tokens = new LocalTokenStore(state);
    const token = await tokens.loadOrCreate();
    http = new LocalHttpTransportServer({
      agent,
      tokens,
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: [],
      maxRequestBytes: 64 * 1024,
      maxConcurrentRequests: 4,
    });
    const address = await http.listen();

    expect((await fetch(address.mcpUrl.replace('/mcp', '/health'))).status).toBe(200);
    expect((await fetch(address.mcpUrl, { method: 'POST', body: '{}' })).status).toBe(401);
    expect(
      (
        await fetch(address.mcpUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token.token}`, Origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403);

    const client = new Client({ name: 'http-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(address.mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token.token}` } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'system_info')).toBe(true);
    const result = await client.callTool({ name: 'system_info', arguments: {} });
    expect(result.isError).not.toBe(true);

    const controlHeaders = {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
      'X-ForgeBridge-CSRF': '',
    };
    const rejectedPause = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'pause' }),
    });
    expect(rejectedPause.status).toBe(403);
    const csrfResponse = await fetch(address.mcpUrl.replace('/mcp', '/control/csrf'), {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    controlHeaders['X-ForgeBridge-CSRF'] = csrf.csrfToken;
    const malformedJson = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: '{',
    });
    expect(malformedJson.status).toBe(400);
    await expect(malformedJson.json()).resolves.toMatchObject({
      error: { code: 'invalid_json' },
    });
    const malformedAction = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'pause', unexpected: true }),
    });
    expect(malformedAction.status).toBe(400);
    await expect(malformedAction.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(agent.paused).toBe(false);
    const oversized = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'pause', padding: 'x'.repeat(70 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: 'request_too_large' },
    });
    expect(agent.paused).toBe(false);
    const pause = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'pause' }),
    });
    expect(pause.status).toBe(200);
    expect(agent.paused).toBe(true);
    const pausedStatus = await client.callTool({ name: 'system_info', arguments: {} });
    expect(pausedStatus.isError).not.toBe(true);
    expect((pausedStatus.structuredContent as { data: { paused: boolean } }).data.paused).toBe(
      true,
    );
    const pausedRead = await client.callTool({
      name: 'fs_read',
      arguments: { operation: 'stat', path: root },
    });
    expect(pausedRead.isError).toBe(true);
    expect((pausedRead.structuredContent as { error: { code: string } }).error.code).toBe(
      'agent_paused',
    );
    const mode = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'set_mode', mode: 'full' }),
    });
    expect(mode.status).toBe(200);
    expect(agent.config.mode).toBe('full');
    const gaming = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'set_execution_profile', profile: 'gaming' }),
    });
    expect(gaming.status).toBe(200);
    expect(agent.executionPolicy.current()).toMatchObject({
      profile: 'gaming',
      foregroundAllowed: false,
      forceHeadlessBrowser: true,
    });
    const projectMode = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'set_project_mode', root, mode: 'ask' }),
    });
    expect(projectMode.status).toBe(200);
    expect(agent.config.projectProfiles).toEqual([
      { root, mode: 'ask', autonomy: 'standard', rules: [] },
    ]);
    const trustedProject = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({
        action: 'set_project_policy',
        root,
        mode: 'full',
        autonomy: 'trusted-local',
      }),
    });
    expect(trustedProject.status).toBe(200);
    expect(agent.config.projectProfiles).toEqual([
      { root, mode: 'full', autonomy: 'trusted-local', rules: [] },
    ]);
    await agent.setProjectMode(root, 'ask');
    expect(agent.config.projectProfiles).toEqual([
      { root, mode: 'ask', autonomy: 'trusted-local', rules: [] },
    ]);
    const resume = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'resume' }),
    });
    expect(resume.status).toBe(200);
    expect(agent.paused).toBe(false);
    const projectWrite = await client.callTool({
      name: 'fs_write',
      arguments: { operation: 'create', path: path.join(root, 'project-mode.txt'), content: 'x' },
    });
    expect(projectWrite.isError).toBe(true);
    expect((projectWrite.structuredContent as { error: { code: string } }).error.code).toBe(
      'approval_required',
    );
    await client.close();

    const revoke = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
      method: 'POST',
      headers: controlHeaders,
      body: JSON.stringify({ action: 'revoke' }),
    });
    expect(revoke.status).toBe(200);
    expect(agent.paused).toBe(true);
    expect(
      (
        await fetch(address.mcpUrl.replace('/mcp', '/control/status'), {
          headers: { Authorization: `Bearer ${token.token}` },
        })
      ).status,
    ).toBe(401);
    const rotatedToken = await tokens.loadOrCreate();
    expect(rotatedToken.token).not.toBe(token.token);
    const rotatedCsrfResponse = await fetch(address.mcpUrl.replace('/mcp', '/control/csrf'), {
      headers: { Authorization: `Bearer ${rotatedToken.token}` },
    });
    const rotatedCsrf = (await rotatedCsrfResponse.json()) as { csrfToken: string };
    expect(rotatedCsrf.csrfToken).not.toBe(csrf.csrfToken);
  });

  it('returns a structured retryable error when the configured port is occupied', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-http-root-'));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-http-state-'));
    agent = await ForgeBridgeAgent.create(defaultConfig(root), state);
    const tokens = new LocalTokenStore(state);
    const occupied = await import('node:http').then(({ createServer }) => createServer());
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const occupiedAddress = occupied.address();
    if (!occupiedAddress || typeof occupiedAddress === 'string') throw new Error('No test port');
    http = new LocalHttpTransportServer({
      agent,
      tokens,
      host: '127.0.0.1',
      port: occupiedAddress.port,
      allowedOrigins: [],
      maxRequestBytes: 64 * 1024,
      maxConcurrentRequests: 4,
    });
    try {
      await expect(http.listen()).rejects.toMatchObject({
        code: 'http_listen_failed',
        retryable: true,
        details: { causeCode: 'EADDRINUSE' },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        occupied.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
