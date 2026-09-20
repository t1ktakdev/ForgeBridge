import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../core/atomic.js';
import { ForgeBridgeError } from '../core/errors.js';
import type { Redactor } from '../core/redactor.js';
import type { ShellKind } from '../terminal/manager.js';
import { filteredEnvironment } from '../terminal/environment.js';
import {
  terminateProcessTree,
  trustedGitBashExecutable,
  trustedPowerShellCoreExecutable,
  windowsSystemExecutable,
} from '../terminal/process-utils.js';
import type { ExecutionPolicy, ResourceGovernor } from '../execution/policy.js';

const JobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

const JobRecordSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1).max(64),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
  status: JobStatusSchema,
  pid: z.number().int().positive().optional(),
  workingDirectory: z.string(),
  command: z.string(),
  shell: z.string(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  logFile: z.string(),
  logTruncated: z.boolean().default(false),
});

export type JobRecord = z.infer<typeof JobRecordSchema>;

type Runtime = { child: ChildProcess; pendingWrites: Promise<void>; loggedBytes: number };

function invocation(shell: ShellKind, command: string): { executable: string; args: string[] } {
  if (process.platform === 'win32') {
    if (shell === 'cmd') {
      return {
        executable: windowsSystemExecutable('cmd.exe'),
        args: ['/d', '/s', '/c', command],
      };
    }
    if (shell === 'wsl') {
      return {
        executable: windowsSystemExecutable('wsl.exe'),
        args: ['--', 'bash', '-lc', command],
      };
    }
    if (shell === 'git-bash' || shell === 'bash') {
      return {
        executable: trustedGitBashExecutable(),
        args: ['--noprofile', '--norc', '-lc', command],
      };
    }
    return {
      executable:
        shell === 'pwsh'
          ? trustedPowerShellCoreExecutable()
          : path.join(
              process.env['SystemRoot'] ?? 'C:\\Windows',
              'System32',
              'WindowsPowerShell',
              'v1.0',
              'powershell.exe',
            ),
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    };
  }
  if (shell !== 'bash')
    throw new ForgeBridgeError('shell_unavailable', `${shell} is not available on this platform`);
  return { executable: '/bin/bash', args: ['--noprofile', '--norc', '-lc', command] };
}

export class JobManager {
  readonly #stateFile: string;
  readonly #logsDirectory: string;
  readonly #maxLogBytes: number;
  readonly #redactor: Redactor;
  readonly #executionPolicy?: ExecutionPolicy;
  readonly #resources?: ResourceGovernor;
  #records = new Map<string, JobRecord>();
  #runtimes = new Map<string, Runtime>();
  #persistQueue: Promise<void> = Promise.resolve();

  constructor(
    stateDirectory: string,
    maxLogBytes: number,
    redactor: Redactor,
    executionPolicy?: ExecutionPolicy,
    resources?: ResourceGovernor,
  ) {
    this.#stateFile = path.join(stateDirectory, 'state', 'jobs.json');
    this.#logsDirectory = path.join(stateDirectory, 'logs', 'jobs');
    this.#maxLogBytes = maxLogBytes;
    this.#redactor = redactor;
    this.#executionPolicy = executionPolicy;
    this.#resources = resources;
  }

  async initialize(): Promise<void> {
    await mkdir(this.#logsDirectory, { recursive: true, mode: 0o700 });
    try {
      const records = z
        .array(JobRecordSchema)
        .parse(JSON.parse(await readFile(this.#stateFile, 'utf8')));
      let changed = false;
      for (const record of records) {
        const expectedLogFile = path.join(this.#logsDirectory, `${record.id}.log`);
        const actual = path.resolve(record.logFile);
        const expected = path.resolve(expectedLogFile);
        if (
          process.platform === 'win32'
            ? actual.toLocaleLowerCase('en-US') !== expected.toLocaleLowerCase('en-US')
            : actual !== expected
        ) {
          throw new ForgeBridgeError(
            'invalid_job_state',
            'Persisted job log path is outside the ForgeBridge job log directory',
            { id: record.id },
          );
        }
        if (record.status === 'queued' || record.status === 'running') {
          record.status = 'interrupted';
          record.finishedAt = new Date().toISOString();
          changed = true;
        }
        this.#records.set(record.id, record);
      }
      if (changed) await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (error instanceof ForgeBridgeError) throw error;
      throw new ForgeBridgeError('invalid_job_state', 'Persisted job state is malformed');
    }
  }

  async start(options: {
    type?: string;
    command: string;
    workingDirectory: string;
    shell?: ShellKind;
    metadata?: Record<string, unknown>;
    environment?: Record<string, string>;
  }): Promise<JobRecord> {
    const parallelLimit = this.#executionPolicy?.current().maxParallelJobs;
    if (parallelLimit !== undefined && this.#runtimes.size >= parallelLimit) {
      throw new ForgeBridgeError(
        'resource_limit',
        `The execution profile allows at most ${parallelLimit} parallel jobs`,
        { limit: parallelLimit, active: this.#runtimes.size },
        true,
      );
    }
    const releaseSlot = this.#resources?.acquireCpuSlot() ?? (() => undefined);
    const id = randomUUID();
    const shell = options.shell ?? (process.platform === 'win32' ? 'powershell' : 'bash');
    const logFile = path.join(this.#logsDirectory, `${id}.log`);
    const redactedCommand = this.#redactor.redactText(options.command).value;
    const record: JobRecord = {
      id,
      type: options.type ?? 'command',
      createdAt: new Date().toISOString(),
      status: 'queued',
      workingDirectory: options.workingDirectory,
      command: redactedCommand,
      shell,
      metadata: this.#redactor.redact(options.metadata ?? {}).value,
      logFile,
      logTruncated: false,
    };
    this.#records.set(id, record);
    let child: ChildProcess;
    try {
      await writeFileAtomic(logFile, '', 0o600);
      await this.persist();
      const command = invocation(shell, options.command);
      child = spawn(command.executable, command.args, {
        cwd: options.workingDirectory,
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        env: filteredEnvironment(options.environment),
      });
      this.#executionPolicy?.applyProcessPriority(child.pid);
    } catch (error) {
      releaseSlot();
      this.#records.delete(id);
      throw error;
    }
    record.pid = child.pid;
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    const runtime: Runtime = { child, pendingWrites: Promise.resolve(), loggedBytes: 0 };
    this.#runtimes.set(id, runtime);

    const log = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const text = this.#redactor.redactText(chunk.toString('utf8')).value;
      const line = `[${new Date().toISOString()}] ${stream}: ${text}`;
      const bytes = Buffer.byteLength(line);
      if (runtime.loggedBytes + bytes > this.#maxLogBytes) {
        if (!record.logTruncated) {
          record.logTruncated = true;
          const marker = `\n[${new Date().toISOString()}] forgebridge: log quota reached\n`;
          runtime.pendingWrites = runtime.pendingWrites.then(async () =>
            appendFile(logFile, marker),
          );
          void this.persist().catch(() => undefined);
        }
        return;
      }
      runtime.loggedBytes += bytes;
      runtime.pendingWrites = runtime.pendingWrites.then(async () => appendFile(logFile, line));
    };
    child.stdout?.on('data', (chunk: Buffer) => log('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => log('stderr', chunk));
    child.once('error', (error) => {
      releaseSlot();
      log('stderr', Buffer.from(`ForgeBridge could not start process: ${error.message}\n`));
      record.status = 'failed';
      record.finishedAt = new Date().toISOString();
      this.#runtimes.delete(id);
      void runtime.pendingWrites.then(async () => this.persist()).catch(() => undefined);
    });
    child.once('exit', (exitCode, signal) => {
      releaseSlot();
      record.exitCode = exitCode;
      record.signal = signal;
      if (record.status !== 'cancelled') record.status = exitCode === 0 ? 'succeeded' : 'failed';
      record.finishedAt = new Date().toISOString();
      this.#runtimes.delete(id);
      void runtime.pendingWrites.then(async () => this.persist()).catch(() => undefined);
    });
    try {
      await this.persist();
    } catch (error) {
      record.status = 'failed';
      record.finishedAt = new Date().toISOString();
      this.#runtimes.delete(id);
      releaseSlot();
      if (child.pid) await terminateProcessTree(child.pid, true).catch(() => undefined);
      await this.persist().catch(() => undefined);
      throw error;
    }
    return { ...record };
  }

  status(id: string): JobRecord {
    return { ...this.requireRecord(id) };
  }

  list(options: { status?: JobStatus; limit?: number } = {}): JobRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    return [...this.#records.values()]
      .filter((record) => !options.status || record.status === options.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async logs(
    id: string,
    offset = 0,
    limit = 64 * 1024,
  ): Promise<{
    offset: number;
    nextOffset: number;
    totalBytes: number;
    data: string;
    eof: boolean;
    provenance: 'untrusted_process_output';
  }> {
    const record = this.requireRecord(id);
    const info = await stat(record.logFile);
    const safeOffset = Math.max(0, offset);
    if (safeOffset > info.size) {
      throw new ForgeBridgeError('invalid_offset', 'Log offset is beyond the current log size');
    }
    const length = Math.min(Math.max(1, limit), 1024 * 1024, info.size - safeOffset);
    const buffer = Buffer.alloc(length);
    const handle = await open(record.logFile, 'r');
    try {
      const { bytesRead } = await handle.read(buffer, 0, length, safeOffset);
      return {
        offset: safeOffset,
        nextOffset: safeOffset + bytesRead,
        totalBytes: info.size,
        data: buffer.subarray(0, bytesRead).toString('utf8'),
        eof: safeOffset + bytesRead >= info.size && !this.#runtimes.has(id),
        provenance: 'untrusted_process_output',
      };
    } finally {
      await handle.close();
    }
  }

  async cancel(id: string): Promise<JobRecord> {
    const record = this.requireRecord(id);
    const runtime = this.#runtimes.get(id);
    if (!runtime || record.status !== 'running') return { ...record };
    record.status = 'cancelled';
    record.finishedAt = new Date().toISOString();
    await this.persist();
    try {
      if (record.pid) await terminateProcessTree(record.pid, true);
    } catch (error) {
      if (this.#runtimes.has(id)) {
        record.status = 'running';
        delete record.finishedAt;
        await this.persist();
      }
      throw error;
    }
    return { ...record };
  }

  async close(cancelRunning = false): Promise<void> {
    if (!cancelRunning) return;
    await Promise.all([...this.#runtimes.keys()].map(async (id) => this.cancel(id)));
  }

  private requireRecord(id: string): JobRecord {
    const record = this.#records.get(id);
    if (!record) throw new ForgeBridgeError('unknown_job', 'Unknown job handle', { id });
    return record;
  }

  private async persist(): Promise<void> {
    const write = async (): Promise<void> =>
      writeFileAtomic(
        this.#stateFile,
        `${JSON.stringify([...this.#records.values()], null, 2)}\n`,
        0o600,
      );
    const queued = this.#persistQueue.then(write, write);
    this.#persistQueue = queued.catch(() => undefined);
    await queued;
  }
}
