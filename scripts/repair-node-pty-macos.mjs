import { chmodSync, lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function repairNodePtyMacos(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') return { repaired: [], checked: [] };

  const arch = options.arch ?? process.arch;
  const require = createRequire(import.meta.url);
  const packageJson = options.packageJson ?? require.resolve('node-pty/package.json');
  const packageRoot = realpathSync(path.dirname(packageJson));
  const candidates = [
    path.join(packageRoot, 'build', 'Release', 'spawn-helper'),
    path.join(packageRoot, 'prebuilds', `darwin-${arch}`, 'spawn-helper'),
  ];

  const repaired = [];
  const checked = [];
  for (const candidate of candidates) {
    let info;
    try {
      info = lstatSync(candidate);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Refusing unexpected node-pty helper type: ${candidate}`);
    }
    const canonical = realpathSync(candidate);
    if (!isInside(packageRoot, canonical)) {
      throw new Error(`Refusing node-pty helper outside package root: ${candidate}`);
    }
    checked.push(canonical);
    if ((info.mode & 0o111) === 0) {
      chmodSync(canonical, info.mode | 0o111);
      const repairedInfo = lstatSync(canonical);
      if ((repairedInfo.mode & 0o111) === 0) {
        throw new Error(`Could not make node-pty spawn-helper executable: ${canonical}`);
      }
      repaired.push(canonical);
    }
  }

  if (checked.length === 0) {
    throw new Error(
      `node-pty spawn-helper was not found for darwin-${arch}; interactive terminals cannot start`,
    );
  }
  return { repaired, checked };
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const result = repairNodePtyMacos();
  if (result.repaired.length > 0) {
    process.stdout.write(
      `ForgeBridge repaired node-pty macOS spawn-helper permissions (${result.repaired.length}).\n`,
    );
  }
}
