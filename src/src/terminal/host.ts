import { execFile } from 'node:child_process';
import os from 'node:os';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import path from 'node:path';
import { promisify } from 'node:util';
import { filteredEnvironment } from './environment.js';

export function shellContract(platform = process.platform) {
  return platform === 'win32'
    ? {
        default: 'powershell',
        name: 'Windows PowerShell',
        version: null as string | null,
        supportsAndAnd: false,
        sequence: ';',
        conditionalSuccess: 'if ($LASTEXITCODE -eq 0) { ... }',
        workingDirectoryArgument: 'workingDirectory',
        profilesLoaded: false,
      }
    : {
        default: 'bash',
        name: 'Bash',
        version: null as string | null,
        supportsAndAnd: true,
        sequence: ';',
        conditionalSuccess: '&&',
        workingDirectoryArgument: 'workingDirectory',
        profilesLoaded: false,
      };
}

let hostPromise: Promise<ReturnType<typeof collectHost>> | undefined;
function collectHost() {
  return {
    os: process.platform,
    release: os.release(),
    architecture: process.arch,
    node: {
      version: process.version,
      executable: process.execPath,
      source: 'ForgeBridge host process',
    },
    shell: shellContract(),
  };
}

/** One bounded, fixed version probe per agent process. Never resolves executables from a project. */
export function environmentInfo(): Promise<ReturnType<typeof collectHost>> {
  return (hostPromise ??= (async () => {
    const result = collectHost();
    const executable =
      process.platform === 'win32'
        ? path.join(
            process.env['SystemRoot'] ?? 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          )
        : '/bin/bash';
    const args =
      process.platform === 'win32'
        ? [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '$PSVersionTable.PSVersion.ToString()',
          ]
        : ['--noprofile', '--norc', '--version'];
    try {
      const { stdout } = await promisify(execFile)(executable, args, {
        cwd: os.tmpdir(),
        windowsHide: true,
        timeout: 2000,
        maxBuffer: 4096,
        env: filteredEnvironment(),
      });
      result.shell.version = /\d+\.\d+(?:\.\d+)*/u.exec(stdout)?.[0] ?? null;
    } catch {
      /* An unavailable version probe must not invent a version or prevent inspection. */
    }
    return result;
  })());
}

export type RuntimeProbe = {
  name: 'node' | 'python' | 'rust' | 'go' | 'dotnet' | 'java';
  installedVersion: string | null;
  source: string;
};

let runtimePromise: Promise<RuntimeProbe[]> | undefined;

async function fixedVersionProbe(
  name: RuntimeProbe['name'],
  executable: string,
  args: string[],
  versionPattern: RegExp,
): Promise<RuntimeProbe> {
  try {
    const { stdout, stderr } = await promisify(execFile)(executable, args, {
      cwd: os.tmpdir(),
      windowsHide: true,
      timeout: 2000,
      maxBuffer: 8192,
      env: filteredEnvironment(),
    });
    const output = `${stdout}\n${stderr}`;
    return {
      name,
      installedVersion: versionPattern.exec(output)?.[1] ?? null,
      source: `${executable} ${args.join(' ')}`,
    };
  } catch {
    return { name, installedVersion: null, source: `${executable} unavailable` };
  }
}

/**
 * Probe common language runtimes with fixed commands from a neutral cwd. Repository files are never
 * executed and no repository-local PATH entries are added. Results are cached for the agent process.
 */
export function runtimeInfo(): Promise<RuntimeProbe[]> {
  return (runtimePromise ??= (async () => {
    const probes = await Promise.all([
      fixedVersionProbe(
        'python',
        process.platform === 'win32' ? 'python.exe' : 'python3',
        ['--version'],
        /Python\s+(\d+\.\d+(?:\.\d+)?)/iu,
      ),
      fixedVersionProbe('rust', 'rustc', ['--version'], /rustc\s+(\d+\.\d+(?:\.\d+)?)/iu),
      fixedVersionProbe('go', 'go', ['version'], /go(?:version\s+go)?(\d+\.\d+(?:\.\d+)?)/iu),
      fixedVersionProbe('dotnet', 'dotnet', ['--version'], /(\d+\.\d+(?:\.\d+)?)/u),
      fixedVersionProbe('java', 'java', ['-version'], /version\s+"?(\d+(?:\.\d+){0,3})/iu),
    ]);
    return [
      {
        name: 'node' as const,
        installedVersion: process.version.replace(/^v/u, ''),
        source: process.execPath,
      },
      ...probes,
    ];
  })());
}

/** Read version metadata at standard global install prefixes, without invoking shims/Corepack. */
export async function packageManagerInfo() {
  const prefixes = [
    ...new Set([
      path.dirname(process.execPath),
      ...(process.platform === 'win32' && process.env['APPDATA']
        ? [path.join(process.env['APPDATA'], 'npm')]
        : ['/usr/local/lib', '/usr/lib']),
    ]),
  ];
  const found: { name: string; version: string; source: string }[] = [];
  for (const name of ['pnpm', 'npm', 'yarn']) {
    for (const prefix of prefixes) {
      const file = path.join(prefix, 'node_modules', name, 'package.json');
      let handle;
      try {
        handle = await open(file, 'r');
        const info = await handle.stat();
        if (!info.isFile() || info.size > 32 * 1024) continue;
        const buffer = Buffer.alloc(info.size);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const parsed = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
        const result = z
          .object({
            name: z.literal(name),
            version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u),
          })
          .safeParse(parsed);
        if (result.success) {
          found.push({ name, version: result.data.version, source: file });
          break;
        }
      } catch {
        /* Missing, inaccessible, or nonstandard installations stay unknown. */
      } finally {
        await handle?.close();
      }
    }
  }
  return found;
}
