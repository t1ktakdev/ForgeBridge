import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ForgeBridgeError } from '../core/errors.js';

const execFileAsync = promisify(execFile);

export function windowsSystemExecutable(name: string): string {
  return path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', name);
}

export function trustedPowerShellCoreExecutable(): string {
  const configured = process.env['FORGEBRIDGE_PWSH_EXECUTABLE'];
  if (configured) {
    if (!path.isAbsolute(configured) || !existsSync(configured)) {
      throw new ForgeBridgeError(
        'shell_unavailable',
        'FORGEBRIDGE_PWSH_EXECUTABLE must name an existing absolute path',
      );
    }
    return configured;
  }
  const candidates = [
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'powershell', 'pwsh.exe'),
  ];
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new ForgeBridgeError(
      'shell_unavailable',
      'Could not find PowerShell Core in a trusted location; set FORGEBRIDGE_PWSH_EXECUTABLE',
    );
  }
  return executable;
}

export function trustedGitBashExecutable(): string {
  const configured = process.env['FORGEBRIDGE_GIT_BASH'];
  if (configured) {
    if (!path.isAbsolute(configured) || !existsSync(configured)) {
      throw new ForgeBridgeError(
        'shell_unavailable',
        'FORGEBRIDGE_GIT_BASH must name an existing absolute path',
      );
    }
    return configured;
  }
  const candidates = [
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new ForgeBridgeError(
      'shell_unavailable',
      'Could not find Git Bash in a trusted location; set FORGEBRIDGE_GIT_BASH',
    );
  }
  return executable;
}

export async function terminateProcessTree(pid: number, force = false): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process ID');
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/t'];
    if (force) args.push('/f');
    try {
      const taskkill = windowsSystemExecutable('taskkill.exe');
      await execFileAsync(taskkill, args, { windowsHide: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH' && processExists(pid)) throw error;
    }
    return;
  }

  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type CommandRisk = {
  flags: string[];
  summary: string[];
};

export function classifyCommand(command: string): CommandRisk {
  const flags: string[] = [];
  const summary: string[] = [];
  const checks: readonly [RegExp, string, string][] = [
    [
      /(?:^|[;&|]\s*|\s)(?:Remove-Item|del|erase|rd|rmdir|rm|unlink)(?:\.exe)?\s/iu,
      'filesystem-delete',
      'use filesystem deletion with an exact path approval',
    ],
    [
      /\b(?:runas|sudo)\b|Start-Process\b[^\r\n]*\b-Verb\s+RunAs\b/iu,
      'elevation',
      'requests elevation',
    ],
    [
      /\b(?:schtasks(?:\.exe)?\s+\/create|sc(?:\.exe)?\s+create|crontab\s+-|reg(?:\.exe)?\s+add\b[^\r\n]*(?:\\Run|\\RunOnce))\b/iu,
      'persistence',
      'creates persistence',
    ],
    [
      /\b(?:mimikatz|procdump(?:\.exe)?\b[^\r\n]*\blsass|sekurlsa|reg(?:\.exe)?\s+save\s+HKLM\\SAM)\b/iu,
      'credential-dump',
      'resembles credential dumping',
    ],
    [
      /\b(?:format(?:\.com)?\s+[a-z]:|diskpart|Remove-Item\b[^\r\n]*-Recurse|rm\s+-[a-z]*r[a-z]*f)\b/iu,
      'destructive',
      'contains a destructive filesystem operation',
    ],
    [/\bgit(?:\.exe)?\s+push\b/iu, 'git-push', 'pushes Git data to a remote'],
    [
      /\bgit(?:\.exe)?\s+push\b[^\r\n]*(?:--force(?:-with-lease)?|-f\b)/iu,
      'git-force-push',
      'force-pushes Git history',
    ],
    [
      /\bgit(?:\.exe)?\s+(?:reset\b[^\r\n]*--hard|clean\b)/iu,
      'git-destructive',
      'performs a destructive Git operation',
    ],
    [
      /\b(?:npm|pnpm|yarn|bun|pip|pipx|poetry|cargo|gem|choco|winget)(?:\.exe)?\s+(?:install|add)\b/iu,
      'package-install',
      'installs software packages',
    ],
  ];
  for (const [expression, flag, description] of checks) {
    if (!expression.test(command)) continue;
    flags.push(flag);
    summary.push(description);
  }
  return { flags, summary };
}
