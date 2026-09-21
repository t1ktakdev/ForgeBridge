import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from './atomic.js';
import { ForgeBridgeError } from './errors.js';
import { restrictPrivateFile } from './file-permissions.js';

const IdentitySchema = z.object({
  version: z.literal(1),
  deviceId: z.uuid(),
  deviceName: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  publicKeyPem: z.string().min(1),
  privateKeyPem: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export type DeviceIdentity = z.infer<typeof IdentitySchema>;

export class DeviceIdentityStore {
  readonly file: string;

  constructor(stateDirectory: string) {
    this.file = path.join(stateDirectory, 'identity.json');
  }

  async loadOrCreate(): Promise<DeviceIdentity> {
    try {
      const parsed = IdentitySchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
      await restrictPrivateFile(this.file);
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const fingerprint = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    const identity: DeviceIdentity = {
      version: 1,
      deviceId: randomUUID(),
      deviceName: os.hostname().slice(0, 128) || 'ForgeBridge device',
      createdAt: new Date().toISOString(),
      publicKeyPem,
      privateKeyPem,
      fingerprint,
    };

    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.file, `${JSON.stringify(identity, null, 2)}\n`, 0o600);
    await restrictPrivateFile(this.file);
    return identity;
  }

  async rename(deviceName: string): Promise<DeviceIdentity> {
    const normalized = deviceName.trim();
    if (!normalized || normalized.length > 128) {
      throw new ForgeBridgeError(
        'invalid_device_name',
        'Device name must contain between 1 and 128 non-whitespace characters',
      );
    }
    const identity = await this.loadOrCreate();
    const updated = IdentitySchema.parse({ ...identity, deviceName: normalized });
    await writeFileAtomic(this.file, `${JSON.stringify(updated, null, 2)}\n`, 0o600);
    await restrictPrivateFile(this.file);
    return updated;
  }

  sign(identity: DeviceIdentity, payload: string): string {
    return sign(null, Buffer.from(payload, 'utf8'), identity.privateKeyPem).toString('base64url');
  }
}
