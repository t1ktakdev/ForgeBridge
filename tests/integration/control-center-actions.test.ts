import { mkdtemp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import { LocalTokenStore } from '../../src/core/local-token.js';
import { LocalHttpTransportServer } from '../../src/transports/http.js';

describe('Control Center lifecycle actions', () => {
  let http: LocalHttpTransportServer | undefined;
  let agent: ForgeBridgeAgent | undefined;

  afterEach(async () => {
    await http?.close();
    await agent?.close({ cancelJobs: true });
  });

  it('cancels a running job and keeps lifecycle errors structured', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'forgebridge-control-root-')));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-control-state-'));
    agent = await ForgeBridgeAgent.create(defaultConfig(root), state);
    const tokens = new LocalTokenStore(state);
    const credentialRecord = await tokens.loadOrCreate();
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
    const controlUrl = address.mcpUrl.replace('/mcp', '/control');
    const csrfResponse = await fetch(`${controlUrl}/csrf`, {
      headers: { Authorization: `Bearer ${credentialRecord.token}` },
    });
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    const headers = {
      Authorization: `Bearer ${credentialRecord.token}`,
      'Content-Type': 'application/json',
      'X-ForgeBridge-CSRF': csrf.csrfToken,
    };
    const post = async (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${controlUrl}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20';
    const job = await agent.jobs.start({ command, workingDirectory: root });
    expect(job.status).toBe('running');

    const cancelled = await post({ action: 'cancel_job', jobId: job.id });
    expect(cancelled.status).toBe(200);
    expect(agent.jobs.status(job.id).status).toBe('cancelled');

    const missingTerminal = await post({
      action: 'kill_terminal',
      sessionId: '00000000-0000-4000-8000-000000000010',
    });
    expect(missingTerminal.status).not.toBe(200);
    await expect(missingTerminal.json()).resolves.toMatchObject({
      error: { code: 'unknown_process' },
    });

    const missingBrowser = await post({
      action: 'close_browser_session',
      sessionId: '00000000-0000-4000-8000-000000000011',
    });
    expect(missingBrowser.status).not.toBe(200);
    await expect(missingBrowser.json()).resolves.toMatchObject({
      error: { code: 'unknown_browser_session' },
    });

    const audit = await agent.audit.list(0, 100);
    expect(audit.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'cancel_job', result: 'succeeded' }),
        expect.objectContaining({ operation: 'kill_terminal', result: 'failed' }),
        expect.objectContaining({ operation: 'close_browser_session', result: 'failed' }),
      ]),
    );
  });
});
