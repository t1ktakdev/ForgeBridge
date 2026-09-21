import { closeSync, existsSync, openSync, readSync, realpathSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';

// Resolve JS launchers separately from standalone pnpm executables. In particular,
// npm_execpath may be just "pnpm" under pnpm/setup; it is not a Node script path.
export function pnpmInvocation(args, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const node = options.execPath ?? process.execPath;
  const exists = options.exists ?? existsSync;
  const realpath = options.realpath ?? realpathSync;
  const read =
    options.read ??
    ((file) => {
      const descriptor = openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(256);
        return buffer.subarray(0, readSync(descriptor, buffer, 0, 256, 0)).toString('utf8');
      } finally {
        closeSync(descriptor);
      }
    });
  const paths = platform === 'win32' ? path.win32 : path.posix;
  function launcher(candidate) {
    if (!exists(candidate)) return undefined;
    const resolved = realpath(candidate);
    if (/\.(?:c?js|mjs)$/iu.test(resolved)) return [node, [resolved, ...args]];
    if (/\.(?:cmd|bat)$/iu.test(resolved)) {
      const directory = paths.dirname(resolved);
      for (const relative of [
        ['node_modules', 'pnpm', 'bin', 'pnpm.cjs'],
        ['node_modules', 'corepack', 'dist', 'pnpm.js'],
        ['pnpm.cjs'],
      ]) {
        const script = paths.join(directory, ...relative);
        if (exists(script)) return [node, [script, ...args]];
      }
      return undefined;
    }
    // Extensionless JS scripts (including symlink targets) have a Node shebang.
    if (/^#![^\r\n]*\bnode(?:\s|$)/u.test(read(resolved))) {
      return [node, [resolved, ...args]];
    }
    return [resolved, args];
  }
  const lifecycle = env.npm_execpath;
  if (
    lifecycle &&
    paths.isAbsolute(lifecycle) &&
    /^pnpm(?:\.(?:c?js|mjs|exe|cmd|bat))?$/iu.test(paths.basename(lifecycle))
  ) {
    const invocation = launcher(lifecycle);
    if (invocation) return invocation;
  }
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of searchPath.split(paths.delimiter).filter(Boolean)) {
    for (const name of platform === 'win32' ? ['pnpm.exe', 'pnpm.cmd', 'pnpm'] : ['pnpm']) {
      const invocation = launcher(paths.join(directory, name));
      if (invocation) return invocation;
    }
  }
  throw new Error(
    'Cannot locate a pnpm executable or JavaScript launcher. Install the packageManager version from package.json and ensure pnpm is on PATH.',
  );
}
