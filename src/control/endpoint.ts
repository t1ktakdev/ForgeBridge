import { mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { z } from 'zod';
import { ForgeBridgeError } from '../core/errors.js';
import { writeFileAtomic } from '../core/atomic.js';
import { sha256 } from '../core/json.js';

const EndpointSchema = z
  .object({
    version: z.literal(1),
    owner: z.uuid(),
    pid: z.number().int().positive(),
    host: z.enum(['127.0.0.1', '::1']),
    port: z.number().int().min(1).max(65535).nullable(),
  })
  .strict();
const endpointFile = (state: string) => path.join(state, 'runtime', 'control-endpoint.json');
async function readRecord(file: string) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096)
      throw new Error('Endpoint record is oversized or not a file');
    const data = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    return EndpointSchema.parse(JSON.parse(data.subarray(0, bytesRead).toString('utf8')));
  } finally {
    await handle.close();
  }
}
export async function readControlEndpoint(state: string) {
  try {
    const endpoint = await readRecord(endpointFile(state));
    if (endpoint.port === null)
      throw new ForgeBridgeError(
        'agent_starting',
        'The agent control endpoint is still starting',
        {},
        true,
      );
    return { host: endpoint.host, port: endpoint.port };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof ForgeBridgeError) throw error;
    throw new ForgeBridgeError(
      'invalid_control_endpoint',
      'Invalid local control endpoint record; do not send credentials',
    );
  }
}

/** OS-owned lease serializes startup and stale-file recovery, and disappears on process exit.
 * The IPC listener exchanges no data and accepts no commands. */
async function claimLease(state: string) {
  if (process.platform !== 'win32' && process.platform !== 'linux') return undefined;
  const canonical = await realpath(state);
  const key = sha256(process.platform === 'win32' ? canonical.toLowerCase() : canonical).slice(
    0,
    40,
  );
  const address =
    process.platform === 'win32'
      ? '\\\\.\\pipe\\forgebridge-state-' + key
      : '\0forgebridge-state-' + key;
  const lease = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      lease.once('error', reject);
      lease.listen(address, resolve);
    });
  } catch {
    throw new ForgeBridgeError(
      'agent_state_in_use',
      'Another agent owns this state directory; use its control endpoint or a separate state directory',
    );
  }
  lease.unref();
  return () =>
    new Promise<void>((resolve, reject) =>
      lease.close((error) => (error ? reject(error) : resolve())),
    );
}

/** One CLI server per state directory. No credential is persisted in this record. */
export async function claimControlEndpoint(state: string) {
  const file = endpointFile(state);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const releaseLease = await claimLease(state);
  const record = {
    version: 1 as const,
    owner: randomUUID(),
    pid: process.pid,
    host: '127.0.0.1' as '127.0.0.1' | '::1',
    port: null as number | null,
  };
  try {
    let handle;
    try {
      handle = await open(file, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const old = await readRecord(file);
      let alive = true;
      try {
        process.kill(old.pid, 0);
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      if (alive || !releaseLease)
        throw new ForgeBridgeError(
          'agent_state_in_use',
          'A control record already exists. A live or inaccessible PID is never taken over.',
          { path: file },
        );
      await rm(file);
      handle = await open(file, 'wx', 0o600);
    }
    try {
      await handle.writeFile(JSON.stringify(record));
    } finally {
      await handle.close();
    }
  } catch (error) {
    await releaseLease?.();
    throw error;
  }
  return {
    async publish(host: '127.0.0.1' | '::1', port: number) {
      record.host = host;
      record.port = port;
      await writeFileAtomic(file, JSON.stringify(EndpointSchema.parse(record)));
    },
    async release() {
      try {
        const current = await readRecord(file);
        if (current.owner === record.owner) await rm(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      } finally {
        await releaseLease?.();
      }
    },
  };
}
