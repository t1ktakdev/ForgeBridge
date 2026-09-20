import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeviceIdentityStore } from '../../src/core/identity.js';

describe('DeviceIdentityStore', () => {
  it('creates a stable Ed25519 identity', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-identity-'));
    const store = new DeviceIdentityStore(directory);
    const first = await store.loadOrCreate();
    const second = await store.loadOrCreate();
    expect(second.deviceId).toBe(first.deviceId);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(store.sign(first, 'payload')).toMatch(/^[A-Za-z0-9_-]+$/u);
  });
});
