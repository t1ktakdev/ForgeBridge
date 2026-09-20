import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import { createForgeBridgeMcpServer } from '../../src/mcp/server.js';

async function eventually(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for soak-test condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('short MCP soak', () => {
  let agent: ForgeBridgeAgent | undefined;
  const clients: Client[] = [];
  const servers: McpServer[] = [];

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map(async (client) => client.close()));
    await Promise.allSettled(servers.splice(0).map(async (server) => server.close()));
    await agent?.close({ cancelJobs: true });
  });

  async function connect(): Promise<Client> {
    if (!agent) throw new Error('Agent is unavailable');
    const server = createForgeBridgeMcpServer(agent, {
      actorId: 'soak-client',
      sessionId: `soak-${servers.length + 1}`,
    });
    const client = new Client({ name: 'forgebridge-soak', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    clients.push(client);
    servers.push(server);
    return client;
  }

  it('bounds memory and resources across repeated calls, jobs, browsers, and reconnects', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-soak-root-'));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-soak-state-'));
    const target = path.join(root, 'fixture.txt');
    await writeFile(target, 'soak fixture\n');
    const config = defaultConfig(root);
    config.mode = 'full';
    config.limits.maxOutputBytes = 32 * 1024;
    agent = await ForgeBridgeAgent.create(config, state);
    const rssBefore = process.memoryUsage().rss;
    let client = await connect();

    for (let index = 0; index < 100; index += 1) {
      const result = await client.callTool({
        name: 'fs_read',
        arguments: { operation: 'stat', path: target },
      });
      expect(result.isError).not.toBe(true);
    }
    for (let index = 0; index < 12; index += 1) {
      const result = await client.callTool({
        name: 'terminal',
        arguments: {
          operation: 'run',
          command: `node -e "process.stdout.write('out-${index}'); process.stderr.write('err-${index}')"`,
          workingDirectory: root,
        },
      });
      expect(result.isError).not.toBe(true);
    }

    const jobIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const result = await client.callTool({
        name: 'jobs',
        arguments: {
          operation: 'create',
          command: `node -e "setTimeout(()=>console.log('job-${index}'),150)"`,
          workingDirectory: root,
        },
      });
      expect(result.isError).not.toBe(true);
      jobIds.push((result.structuredContent as { data: { id: string } }).data.id);
    }
    await eventually(() => jobIds.every((id) => agent?.jobs.status(id).status !== 'running'));
    for (const id of jobIds) expect((await agent.jobs.logs(id)).data).toContain('job-');

    for (let index = 0; index < 5; index += 1) {
      const launched = await client.callTool({
        name: 'browser_read',
        arguments: { operation: 'launch' },
      });
      const sessionId = (launched.structuredContent as { data: { id: string } }).data.id;
      for (let snapshot = 0; snapshot < 5; snapshot += 1) {
        const result = await client.callTool({
          name: 'browser_read',
          arguments: { operation: 'snapshot', sessionId },
        });
        expect(result.isError).not.toBe(true);
      }
      await client.callTool({ name: 'browser_act', arguments: { operation: 'close', sessionId } });
    }

    for (let reconnect = 0; reconnect < 5; reconnect += 1) {
      await client.close();
      await servers.at(-1)?.close();
      client = await connect();
      expect(
        (await client.callTool({ name: 'permissions_status', arguments: {} })).isError,
      ).not.toBe(true);
    }

    expect(agent.executionPolicy.current().forceHeadlessBrowser).toBe(true);
    expect(agent.status()).toMatchObject({ execution: { resources: { activeCpuTasks: 0 } } });
    const page = await agent.audit.list(0, 25);
    expect(page.entries).toHaveLength(25);
    expect(page.next).toBe(25);
    const rssGrowth = process.memoryUsage().rss - rssBefore;
    expect(rssGrowth).toBeLessThan(256 * 1024 * 1024);
  }, 60_000);
});
