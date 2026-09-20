import { execFile } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function icaclsExecutable(): string {
  return path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe');
}

function currentWindowsAccount(): string | undefined {
  const username = process.env['USERNAME'];
  if (!username) return undefined;
  const domain = process.env['USERDOMAIN'];
  return domain ? `${domain}\\${username}` : username;
}

export async function ensurePrivateDirectory(target: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    await chmod(target, 0o700);
    return;
  }
  const account = currentWindowsAccount();
  if (!account) return;
  await execFileAsync(
    icaclsExecutable(),
    [target, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`],
    { windowsHide: true },
  );
}

export async function restrictPrivateFile(target: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(target, 0o600);
    return;
  }
  const account = currentWindowsAccount();
  if (!account) return;
  await execFileAsync(
    icaclsExecutable(),
    [target, '/inheritance:r', '/grant:r', `${account}:(F)`],
    {
      windowsHide: true,
    },
  );
}
