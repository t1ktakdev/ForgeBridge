import process from 'node:process';
import console from 'node:console';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const root = process.cwd();
const executable = process.argv[2] ?? process.env['FORGEBRIDGE_TUNNEL_CLIENT'];
if (!executable || !path.isAbsolute(executable))
  throw new Error('Provide the verified absolute tunnel-client executable path');
const temporary = path.join(root, '.validation-tmp');
await mkdir(temporary, { recursive: true });
const base = await mkdtemp(path.join(temporary, 'native tunnel with spaces-'));
const env = { ...process.env };
delete env['CONTROL_PLANE_API_KEY'];
try {
  const version = await run(executable, ['--version'], {
    cwd: base,
    env,
    windowsHide: true,
    timeout: 10000,
  });
  const results = [];
  for (const mode of ['packaged', 'development']) {
    const state = path.join(base, mode + ' state');
    const profiles = path.join(base, mode + ' profiles');
    const cli = path.join(root, 'dist', 'cli.js');
    await run(process.execPath, [cli, 'init', '--root', root, '--state', state], {
      cwd: base,
      env,
      windowsHide: true,
      timeout: 10000,
    });
    const launch =
      mode === 'packaged'
        ? [cli]
        : [
            path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
            path.join(root, 'src', 'cli.ts'),
          ];
    const result = await run(
      process.execPath,
      [
        ...launch,
        'tunnel',
        'init',
        '--tunnel-id',
        'tunnel_00000000000000000000000000000000',
        '--profile',
        mode,
        '--profile-dir',
        profiles,
        '--tunnel-client',
        executable,
        '--state',
        state,
      ],
      { cwd: base, env, windowsHide: true, timeout: 30000, maxBuffer: 65536 },
    );
    const files = await readdir(profiles, { recursive: true, withFileTypes: true });
    let found = false;
    for (const file of files.filter((item) => item.isFile())) {
      const contents = await readFile(path.join(file.parentPath, file.name), 'utf8');
      if (contents.includes('127.0.0.1:0') && contents.includes('CONTROL_PLANE_API_KEY'))
        found = true;
    }
    if (!found)
      throw new Error(
        'Generated profile lacks ephemeral health binding or environment key reference',
      );
    results.push({
      mode,
      profileCreated: true,
      ephemeralHealth: true,
      initAccepted: result.stdout.length >= 0,
    });
  }
  console.log(
    JSON.stringify(
      {
        version: version.stdout.trim(),
        results,
        runtimeCredentialsUsed: false,
        liveTunnel: 'not-run',
      },
      null,
      2,
    ),
  );
} finally {
  await rm(base, { recursive: true, force: true });
}
