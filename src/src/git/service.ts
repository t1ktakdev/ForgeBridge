import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ForgeBridgeError } from '../core/errors.js';
import type { PathGuard } from '../filesystem/path-guard.js';
import { filteredEnvironment } from '../terminal/environment.js';
import { OutputBuffer } from '../terminal/output-buffer.js';
import { terminateProcessTree } from '../terminal/process-utils.js';

export type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  provenance: 'untrusted_repository_content';
};

export type SecretFinding = {
  path: string;
  rule: string;
};

const SENSITIVE_FILE =
  /(?:^|\/)(?:\.env(?:\..*)?|credentials?|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx))$/iu;
const SECRET_PATTERNS: readonly { id: string; expression: RegExp }[] = [
  { id: 'private-key', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { id: 'openai-key', expression: /\bsk-[A-Za-z0-9_-]{16,}/u },
  {
    id: 'github-token',
    expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  },
  { id: 'aws-access-key', expression: /\bAKIA[A-Z0-9]{16}\b/u },
  { id: 'jwt', expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u },
  {
    id: 'secret-assignment',
    expression:
      /\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[^\s,"';]{8,}/iu,
  },
];

const UNSAFE_GIT_ENVIRONMENT =
  /^(?:GIT_(?:CONFIG|DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|EXEC_PATH|TEMPLATE_DIR|SSH|SSH_COMMAND|ASKPASS|EXTERNAL_DIFF|DIFF_OPTS|PAGER)|SSH_ASKPASS|PAGER)/u;

function gitEnvironment(): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(filteredEnvironment()).filter(
      ([key]) => !UNSAFE_GIT_ENVIRONMENT.test(key.toLocaleUpperCase('en-US')),
    ),
  );
  environment['GIT_TERMINAL_PROMPT'] = '0';
  environment['GIT_OPTIONAL_LOCKS'] = '0';
  return environment;
}

function trustedGitExecutable(): string {
  const configured = process.env['FORGEBRIDGE_GIT_EXECUTABLE'];
  if (configured) {
    if (!path.isAbsolute(configured) || !existsSync(configured)) {
      throw new ForgeBridgeError(
        'git_unavailable',
        'FORGEBRIDGE_GIT_EXECUTABLE must name an existing absolute path',
      );
    }
    return configured;
  }
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
          path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'git.exe'),
          path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Git', 'cmd', 'git.exe'),
        ]
      : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new ForgeBridgeError(
      'git_unavailable',
      'Could not find Git in a trusted installation path; set FORGEBRIDGE_GIT_EXECUTABLE',
    );
  }
  return executable;
}

function trustedSshCommand(): string {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe'),
          path.join(
            process.env['ProgramFiles'] ?? 'C:\\Program Files',
            'Git',
            'usr',
            'bin',
            'ssh.exe',
          ),
        ]
      : ['/usr/bin/ssh', '/usr/local/bin/ssh'];
  const executable =
    candidates.find((candidate) => existsSync(candidate)) ??
    (process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : '/usr/bin/ssh');
  return `"${executable.replaceAll('\\', '/')}"`;
}

export class GitService {
  readonly #guard: PathGuard;
  readonly #maxOutputBytes: number;
  readonly #timeoutMs: number;
  #executable?: string;

  constructor(guard: PathGuard, maxOutputBytes: number, timeoutMs: number) {
    this.#guard = guard;
    this.#maxOutputBytes = maxOutputBytes;
    this.#timeoutMs = timeoutMs;
  }

  async repositoryRoot(requested: string): Promise<string> {
    const resolved = await this.#guard.resolve(requested);
    const result = await this.run(resolved.canonical, ['rev-parse', '--show-toplevel']);
    const root = (await this.#guard.resolve(result.stdout.trim())).canonical;
    return root;
  }

  async status(repository: string): Promise<GitCommandResult> {
    const root = await this.repositoryRoot(repository);
    return this.run(root, ['status', '--short', '--branch', '--untracked-files=all']);
  }

  async diff(
    repository: string,
    options: { staged?: boolean; path?: string; context?: number } = {},
  ): Promise<GitCommandResult> {
    const root = await this.repositoryRoot(repository);
    const args = [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      `--unified=${Math.max(0, Math.min(options.context ?? 3, 100))}`,
    ];
    if (options.staged) args.push('--cached');
    if (options.path) args.push('--', await this.relativePath(root, options.path));
    return this.run(root, [...args]);
  }

  async log(repository: string, limit = 20): Promise<GitCommandResult> {
    const root = await this.repositoryRoot(repository);
    return this.run(root, [
      'log',
      `--max-count=${Math.max(1, Math.min(limit, 200))}`,
      '--date=iso-strict',
      '--format=%H%x09%aI%x09%an%x09%ae%x09%s',
    ]);
  }

  async show(repository: string, revision: string): Promise<GitCommandResult> {
    this.validateRef(revision);
    const root = await this.repositoryRoot(repository);
    return this.run(root, [
      'show',
      '--no-ext-diff',
      '--no-textconv',
      '--stat',
      '--patch',
      revision,
      '--',
    ]);
  }

  async branches(repository: string): Promise<GitCommandResult> {
    const root = await this.repositoryRoot(repository);
    return this.run(root, [
      'branch',
      '--list',
      '--format=%(HEAD)%09%(refname:short)%09%(upstream:short)',
    ]);
  }

  async add(repository: string, paths: string[]): Promise<GitCommandResult> {
    const root = await this.repositoryRoot(repository);
    const relativePaths = await Promise.all(
      paths.map(async (item) => this.relativePath(root, item)),
    );
    return this.run(root, ['add', '--', ...relativePaths]);
  }

  async createBranch(
    repository: string,
    name: string,
    startPoint?: string,
  ): Promise<GitCommandResult> {
    this.validateRef(name);
    if (startPoint) this.validateRef(startPoint);
    const root = await this.repositoryRoot(repository);
    return this.run(root, ['switch', '-c', name, ...(startPoint ? [startPoint] : [])]);
  }

  async checkout(repository: string, name: string): Promise<GitCommandResult> {
    this.validateRef(name);
    const root = await this.repositoryRoot(repository);
    return this.run(root, ['switch', name]);
  }

  async fetch(repository: string, remote = 'origin'): Promise<GitCommandResult> {
    this.validateRef(remote);
    const root = await this.repositoryRoot(repository);
    return this.run(root, ['fetch', '--prune', remote], Math.max(this.#timeoutMs, 5 * 60_000));
  }

  async pull(repository: string, remote?: string, branch?: string): Promise<GitCommandResult> {
    if (remote) this.validateRef(remote);
    if (branch) this.validateRef(branch);
    const root = await this.repositoryRoot(repository);
    return this.run(
      root,
      ['pull', '--ff-only', ...(remote ? [remote] : []), ...(branch ? [branch] : [])],
      Math.max(this.#timeoutMs, 5 * 60_000),
    );
  }

  async preflightCommit(repository: string): Promise<{
    repository: string;
    stagedDiff: string;
    stagedDiffTruncated: boolean;
    findings: SecretFinding[];
    provenance: 'untrusted_repository_content';
  }> {
    const root = await this.repositoryRoot(repository);
    const namesResult = await this.run(root, ['diff', '--cached', '--name-only', '-z']);
    const names = namesResult.stdout.split('\0').filter(Boolean);
    const indexResult = await this.run(root, ['ls-files', '--stage', '-z']);
    const stagedObjects = new Map<string, string>();
    for (const entry of indexResult.stdout.split('\0').filter(Boolean)) {
      const separator = entry.indexOf('\t');
      if (separator < 0) continue;
      const metadata = entry.slice(0, separator).split(' ');
      const objectId = metadata[1];
      const stage = metadata[2];
      if (objectId && stage === '0' && /^[a-f0-9]{40,64}$/u.test(objectId)) {
        stagedObjects.set(entry.slice(separator + 1), objectId);
      }
    }
    const findings: SecretFinding[] = [];
    for (const name of names) {
      const normalized = name.replaceAll('\\', '/');
      if (SENSITIVE_FILE.test(normalized))
        findings.push({ path: normalized, rule: 'sensitive-filename' });

      const objectId = stagedObjects.get(name);
      if (!objectId) continue;
      const sizeResult = await this.run(root, ['cat-file', '-s', objectId]);
      const size = Number(sizeResult.stdout.trim());
      const scanLimit = Math.min(5 * 1024 * 1024, this.#maxOutputBytes);
      if (!Number.isSafeInteger(size) || size < 0 || size > scanLimit) {
        findings.push({ path: normalized, rule: 'large-staged-file' });
        continue;
      }

      const contents = await this.run(root, ['cat-file', 'blob', objectId]);
      if (contents.truncated) {
        findings.push({ path: normalized, rule: 'large-staged-file' });
        continue;
      }
      if (contents.stdout.includes('\0')) continue;
      for (const rule of SECRET_PATTERNS) {
        if (rule.expression.test(contents.stdout)) {
          findings.push({ path: normalized, rule: rule.id });
        }
      }
    }
    const staged = await this.diff(root, { staged: true });
    return {
      repository: root,
      stagedDiff: staged.stdout,
      stagedDiffTruncated: staged.truncated,
      findings,
      provenance: 'untrusted_repository_content',
    };
  }

  async commit(repository: string, message: string): Promise<GitCommandResult> {
    if (!message.trim())
      throw new ForgeBridgeError('invalid_commit_message', 'Commit message is empty');
    const preflight = await this.preflightCommit(repository);
    if (preflight.findings.length > 0) {
      throw new ForgeBridgeError('secret_scan_failed', 'Staged changes failed commit preflight', {
        findings: preflight.findings,
      });
    }
    return this.run(preflight.repository, ['commit', '-m', message]);
  }

  async push(repository: string, remote?: string, branch?: string): Promise<GitCommandResult> {
    if (remote) this.validateRef(remote);
    if (branch) this.validateRef(branch);
    const root = await this.repositoryRoot(repository);
    return this.run(
      root,
      ['push', ...(remote ? [remote] : []), ...(branch ? [branch] : [])],
      Math.max(this.#timeoutMs, 5 * 60_000),
    );
  }

  private async relativePath(root: string, requested: string): Promise<string> {
    const resolved = await this.#guard.resolve(
      path.isAbsolute(requested) ? requested : path.join(root, requested),
      {
        followFinalSymlink: false,
      },
    );
    const relative = path.relative(root, resolved.canonical);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ForgeBridgeError('path_outside_repository', 'Git path is outside repository');
    }
    return relative || '.';
  }

  private validateRef(value: string): void {
    if (!/^[A-Za-z0-9._/-]+$/u.test(value) || value.startsWith('-') || value.includes('..')) {
      throw new ForgeBridgeError('invalid_git_ref', 'Invalid Git ref or remote name');
    }
  }

  private async disabledFilterArguments(root: string): Promise<string[]> {
    const configured = await this.run(root, ['config', '--null', '--name-only', '--list']);
    if (configured.truncated) {
      throw new ForgeBridgeError(
        'unsafe_git_config',
        'Git configuration is too large to inspect safely',
      );
    }
    const drivers = new Set<string>();
    for (const key of configured.stdout.split('\0')) {
      const match = /^filter\.(.+)\.(?:clean|smudge|process|required)$/iu.exec(key);
      if (match?.[1]) drivers.add(match[1]);
    }
    return [...drivers].flatMap((driver) => [
      '-c',
      `filter.${driver}.clean=`,
      '-c',
      `filter.${driver}.smudge=`,
      '-c',
      `filter.${driver}.process=`,
      '-c',
      `filter.${driver}.required=false`,
    ]);
  }

  private async run(
    workingDirectory: string,
    args: string[],
    timeoutMs = this.#timeoutMs,
  ): Promise<GitCommandResult> {
    const filters =
      args[0] === 'config' || args[0] === 'rev-parse'
        ? []
        : await this.disabledFilterArguments(workingDirectory);
    return new Promise((resolve, reject) => {
      const child = spawn(
        (this.#executable ??= trustedGitExecutable()),
        [
          '--no-pager',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.untrackedCache=false',
          '-c',
          'commit.gpgSign=false',
          '-c',
          'credential.helper=',
          '-c',
          `core.sshCommand=${trustedSshCommand()}`,
          '-c',
          'protocol.ext.allow=never',
          '-c',
          'diff.ignoreSubmodules=all',
          '-c',
          'submodule.recurse=false',
          ...filters,
          ...args,
        ],
        {
          cwd: workingDirectory,
          windowsHide: true,
          shell: false,
          detached: process.platform !== 'win32',
          env: gitEnvironment(),
        },
      );
      const stdout = new OutputBuffer(this.#maxOutputBytes);
      const stderr = new OutputBuffer(this.#maxOutputBytes);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const pid = child.pid;
        void (pid ? terminateProcessTree(pid, true) : Promise.resolve()).finally(() => {
          reject(new ForgeBridgeError('git_timeout', 'Git command timed out', { args }, true));
        });
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => stdout.append(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.append(chunk));
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const out = stdout.read();
        const err = stderr.read();
        if (exitCode !== 0) {
          reject(
            new ForgeBridgeError(
              'git_failed',
              err.data || out.data || `git exited with ${exitCode}`,
              {
                exitCode,
                args,
              },
            ),
          );
          return;
        }
        resolve({
          stdout: out.data,
          stderr: err.data,
          exitCode,
          truncated: out.evictedBytes > 0 || err.evictedBytes > 0,
          provenance: 'untrusted_repository_content',
        });
      });
    });
  }
}
