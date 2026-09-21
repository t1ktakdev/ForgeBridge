import { mkdtemp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import { DeviceIdentityStore } from '../../src/core/identity.js';
import { LocalTokenStore } from '../../src/core/local-token.js';
import { LocalHttpTransportServer } from '../../src/transports/http.js';
import { FORGEBRIDGE_VERSION } from '../../src/version.js';

describe('device control plane', () => {
  let http: LocalHttpTransportServer | undefined;
  let agent: ForgeBridgeAgent | undefined;

  afterEach(async () => {
    await http?.close();
    await agent?.close({ cancelJobs: true });
  });

  it('reports runtime device metadata and persists audited renames', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'forgebridge-device-root-')));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-device-state-'));
    agent = await ForgeBridgeAgent.create(defaultConfig(root), state);
    agent.setTransport('http');

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

    const statusResponse = await fetch(`${controlUrl}/status`, {
      headers: { Authorization: `Bearer ${credentialRecord.token}` },
    });
    expect(statusResponse.status).toBe(200);
    const status = (await statusResponse.json()) as {
      status: {
        device: {
          id: string;
          name: string;
          hostname: string;
          forgeBridgeVersion: string;
          capabilities: string[];
          health: string;
          lastSeen: string;
          transport: string;
          activeProject: string | null;
          executionProfile: string;
        };
      };
    };
    expect(status.status.device).toMatchObject({
      id: agent.identity.deviceId,
      name: agent.identity.deviceName,
      hostname: os.hostname(),
      forgeBridgeVersion: FORGEBRIDGE_VERSION,
      health: 'ready',
      transport: 'http',
      activeProject: root,
      executionProfile: 'background',
    });
    expect(status.status.device.capabilities).toContain('filesystem.read');
    expect(Number.isNaN(Date.parse(status.status.device.lastSeen))).toBe(false);

    const csrfResponse = await fetch(`${controlUrl}/csrf`, {
      headers: { Authorization: `Bearer ${credentialRecord.token}` },
    });
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    const rename = await fetch(`${controlUrl}/action`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentialRecord.token}`,
        'Content-Type': 'application/json',
        'X-ForgeBridge-CSRF': csrf.csrfToken,
      },
      body: JSON.stringify({ action: 'rename_device', name: '  Lab Workstation  ' }),
    });
    expect(rename.status).toBe(200);
    await expect(rename.json()).resolves.toMatchObject({
      status: { device: { name: 'Lab Workstation' } },
    });

    const reloaded = await new DeviceIdentityStore(state).loadOrCreate();
    expect(reloaded.deviceName).toBe('Lab Workstation');
    expect(reloaded.deviceId).toBe(agent.identity.deviceId);
    expect(
      (await agent.audit.list(0, 100)).entries.some(
        (entry) => entry.operation === 'rename_device' && entry.result === 'succeeded',
      ),
    ).toBe(true);
  });
});
