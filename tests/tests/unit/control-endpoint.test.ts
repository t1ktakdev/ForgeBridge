import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claimControlEndpoint, readControlEndpoint } from '../../src/control/endpoint.js';

describe('local control endpoint discovery', () => {
  it('publishes only loopback metadata and excludes a second owner', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-endpoint-'));
    const owner = await claimControlEndpoint(state);
    try {
      await expect(readControlEndpoint(state)).rejects.toMatchObject({ code: 'agent_starting' });
      await owner.publish('127.0.0.1', 12456);
      expect(await readControlEndpoint(state)).toEqual({ host: '127.0.0.1', port: 12456 });
      await expect(claimControlEndpoint(state)).rejects.toMatchObject({
        code: 'agent_state_in_use',
      });
    } finally {
      await owner.release();
    }
    expect(await readControlEndpoint(state)).toBeUndefined();
    const replacement = await claimControlEndpoint(state);
    await replacement.release();
    await rm(state, { recursive: true, force: true });
  });
  it('fails closed for malformed, public-host and oversized persisted endpoints', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-endpoint-'));
    await mkdir(path.join(state, 'runtime'));
    try {
      for (const data of [
        '{',
        'x'.repeat(5000),
        JSON.stringify({
          version: 1,
          owner: randomUUID(),
          pid: process.pid,
          host: 'example.com',
          port: 80,
        }),
      ]) {
        await writeFile(path.join(state, 'runtime', 'control-endpoint.json'), data);
        await expect(readControlEndpoint(state)).rejects.toMatchObject({
          code: 'invalid_control_endpoint',
        });
      }
    } finally {
      await rm(state, { recursive: true, force: true });
    }
  });
});
