import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import * as pty from 'node-pty';
import { ForgeBridgeError } from '../core/errors.js';
import { OutputBuffer, type OutputSlice } from './output-buffer.js';
import {
  terminateProcessTree,
  trustedGitBashExecutable,
  trustedPowerShellCoreExecutable,
  windowsSystemExecutable,
} from './process-utils.js';
import { filteredEnvironment } from './environment.js';
import type { ExecutionPolicy, ResourceGovernor } from '../execution/policy.js';

export const SHELL_KINDS = ['powershell', 'pwsh', 'cmd', 'git-bash', 'wsl', 'bash'] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];

type ShellInvocation = {
  executable: string;
  args(command: string, interactive: boolean): string[];
};

export type TerminalRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  provenance: 'untrusted_process_output';
};

export type TerminalSessionState = {
  id: string;
  pid: number;
  shell: ShellKind;
  command: string;
  workingDirectory: string;
  startedAt: string;
  status: 'running' | 'exited';
  exitCode?: number;
  signal?: number;
};

type TerminalSession = TerminalSessionState & {
  terminal: pty.IPty;
  output: OutputBuffer;
};

function shellInvocation(kind: ShellKind): ShellInvocation {
  if (process.platform === 'win32') {
    if (kind === 'cmd') {
      return {
        executable: windowsSystemExecutable('cmd.exe'),
        args: (command, interactive) =>
          interactive ? ['/d', '/q', '/k', command] : ['/d', '/s', '/c', command],
      };
    }
    if (kind === 'git-bash' || kind === 'bash') {
      return {
        executable: trustedGitBashExecutable(),
        args: (command) => ['--noprofile', '--norc', '-lc', command],
      };
    }
    if (kind === 'wsl') {
      return {
        executable: windowsSystemExecutable('wsl.exe'),
        args: (command) => ['--', 'bash', '-lc', command],
      };
    }
    if (kind === 'pwsh') {
      return {
        executable: trustedPowerShellCoreExecutable(),
        args: (command, interactive) => [
          '-NoLogo',
          '-NoProfile',
          ...(interactive ? [] : ['-NonInteractive']),
          '-Command',
          command,
        ],
      };
    }
    return {
      executable: path.join(
        process.env['SystemRoot'] ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      args: (command, interactive) => [
        '-NoLogo',
        '-NoProfile',
        ...(interactive ? [] : ['-NonInteractive']),
        '-Command',
        command,
      ],
    };
  }

  if (kind !== 'bash') {
    throw new ForgeBridgeError('shell_unavailable', `${kind} is not available on this platform`);
  }
  return { executable: '/bin/bash', args: (command) => ['--noprofile', '--norc', '-lc', command] };
}

export class TerminalManager {
  readonly #maximumOutputBytes: number;
  readonly #defaultTimeoutMs: number;
  readonly #sessions = new Map<string, TerminalSession>();
  readonly #executionPolicy?: ExecutionPolicy;
  readonly #resources?: ResourceGovernor;

  constructor(
    maximumOutputBytes: number,
    defaultTimeoutMs: number,
    executionPolicy?: ExecutionPolicy,
    resources?: ResourceGovernor,
  ) {
    this.#maximumOutputBytes = maximumOutputBytes;
    this.#defaultTimeoutMs = defaultTimeoutMs;
    this.#executionPolicy = executionPolicy;
    this.#resources = resources;
  }

  run(options: {
    command: string;
    workingDirectory: string;
    shell?: ShellKind;
    timeoutMs?: number;
    environment?: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<TerminalRunResult> {
    const invocation = shellInvocation(
      options.shell ?? (process.platform === 'win32' ? 'powershell' : 'bash'),
    );
    const started = Date.now();
    const releaseSlot = this.#resources?.acquireCpuSlot() ?? (() => undefined);
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(invocation.executable, invocation.args(options.command, false), {
          cwd: options.workingDirectory,
          env: filteredEnvironment(options.environment),
          windowsHide: true,
          shell: false,
          detached: process.platform !== 'win32',
        });
        this.#executionPolicy?.applyProcessPriority(child.pid);
      } catch (error) {
        releaseSlot();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const stdout = new OutputBuffer(this.#maximumOutputBytes);
      const stderr = new OutputBuffer(this.#maximumOutputBytes);
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        releaseSlot();
      };
      const finish = (result: TerminalRunResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const terminate = (): void => {
        void terminateProcessTree(child.pid ?? -1, true).catch((error: unknown) => fail(error));
      };
      const abort = (): void => {
        cancelled = true;
        terminate();
      };
      const timeoutMs = Math.max(
        100,
        Math.min(options.timeoutMs ?? this.#defaultTimeoutMs, 60 * 60 * 1000),
      );
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      child.stdout.on('data', (chunk: Buffer) => stdout.append(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.append(chunk));
      child.once('error', (error) => {
        fail(
          cancelled
            ? new ForgeBridgeError('cancelled', 'Terminal request was cancelled', {}, true)
            : error,
        );
      });
      child.once('exit', (code, signal) => {
        if (cancelled) {
          fail(new ForgeBridgeError('cancelled', 'Terminal request was cancelled', {}, true));
          return;
        }
        const out = stdout.read();
        const err = stderr.read();
        if (
          process.platform === 'win32' &&
          (options.shell ?? 'powershell') === 'powershell' &&
          options.command.includes('&&') &&
          err.data.includes('InvalidEndOfLine')
        ) {
          fail(
            new ForgeBridgeError(
              'unsupported_shell_syntax',
              'Windows PowerShell does not support &&',
              {
                blocked_by: 'shell',
                shell: 'powershell',
                supportsAndAnd: false,
                next_action: 'use_semantic_tool_or_explicit_shell',
                workingDirectoryArgument: 'workingDirectory',
              },
            ),
          );
          return;
        }
        finish({
          stdout: out.data,
          stderr: err.data,
          exitCode: code,
          signal,
          timedOut,
          truncated: out.evictedBytes > 0 || err.evictedBytes > 0,
          durationMs: Date.now() - started,
          provenance: 'untrusted_process_output',
        });
      });
    });
  }

  start(options: {
    command: string;
    workingDirectory: string;
    shell?: ShellKind;
    columns?: number;
    rows?: number;
    environment?: Record<string, string>;
  }): TerminalSessionState {
    const releaseSlot = this.#resources?.acquireCpuSlot() ?? (() => undefined);
    const shell = options.shell ?? (process.platform === 'win32' ? 'powershell' : 'bash');
    const invocation = shellInvocation(shell);
    let terminal: pty.IPty;
    try {
      terminal = pty.spawn(invocation.executable, invocation.args(options.command, true), {
        name: 'xterm-256color',
        cols: Math.max(20, Math.min(options.columns ?? 120, 500)),
        rows: Math.max(5, Math.min(options.rows ?? 40, 300)),
        cwd: options.workingDirectory,
        env: filteredEnvironment(options.environment),
        useConpty: process.platform === 'win32',
      });
      this.#executionPolicy?.applyProcessPriority(terminal.pid);
    } catch (error) {
      releaseSlot();
      throw error;
    }
    const id = randomUUID();
    const session: TerminalSession = {
      id,
      pid: terminal.pid,
      shell,
      command: options.command,
      workingDirectory: options.workingDirectory,
      startedAt: new Date().toISOString(),
      status: 'running',
      terminal,
      output: new OutputBuffer(this.#maximumOutputBytes),
    };
    terminal.onData((data) => session.output.append(data));
    terminal.onExit(({ exitCode, signal }) => {
      releaseSlot();
      session.status = 'exited';
      session.exitCode = exitCode;
      session.signal = signal;
    });
    this.#sessions.set(id, session);
    return this.publicState(session);
  }

  input(id: string, data: string, appendNewline = false): void {
    const session = this.requireSession(id);
    if (session.status !== 'running')
      throw new ForgeBridgeError('process_exited', 'Terminal has exited');
    session.terminal.write(appendNewline ? `${data}\r` : data);
  }

  read(
    id: string,
    offset?: number,
    limit?: number,
  ): OutputSlice & {
    state: TerminalSessionState;
    provenance: 'untrusted_process_output';
  } {
    const session = this.requireSession(id);
    return {
      ...session.output.read(offset, limit),
      state: this.publicState(session),
      provenance: 'untrusted_process_output',
    };
  }

  resize(id: string, columns: number, rows: number): void {
    const session = this.requireSession(id);
    session.terminal.resize(Math.max(20, Math.min(columns, 500)), Math.max(5, Math.min(rows, 300)));
  }

  interrupt(id: string): void {
    const session = this.requireSession(id);
    if (session.status === 'running') session.terminal.write('\x03');
  }

  async kill(id: string, force = true): Promise<void> {
    const session = this.requireSession(id);
    if (session.status === 'running') {
      try {
        await terminateProcessTree(session.pid, force);
      } finally {
        session.terminal.kill();
      }
    }
  }

  list(): TerminalSessionState[] {
    return [...this.#sessions.values()].map((session) => this.publicState(session));
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.#sessions.values()]
        .filter((session) => session.status === 'running')
        .map(async (session) => this.kill(session.id, true)),
    );
  }

  private requireSession(id: string): TerminalSession {
    const session = this.#sessions.get(id);
    if (!session)
      throw new ForgeBridgeError('unknown_process', 'Unknown terminal process handle', { id });
    return session;
  }

  private publicState(session: TerminalSession): TerminalSessionState {
    return {
      id: session.id,
      pid: session.pid,
      shell: session.shell,
      command: session.command,
      workingDirectory: session.workingDirectory,
      startedAt: session.startedAt,
      status: session.status,
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
      ...(session.signal === undefined ? {} : { signal: session.signal }),
    };
  }
}
