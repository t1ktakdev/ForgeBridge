import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { npmInvocation } from './pnpm-invocation.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDirectory = path.join(repository, 'release');
const tarballs = (await readdir(releaseDirectory)).filter((name) => name.endsWith('.tgz'));
if (tarballs.length !== 1) throw new Error('Run pnpm run package:artifact before validation');
const artifact = path.join(releaseDirectory, tarballs[0]);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-package-'));
const extracted = path.join(temporary, 'extracted');
const installed = path.join(temporary, 'installed');
const state = path.join(temporary, 'state');
const project = path.join(temporary, 'project');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

function createRpcClient(child) {
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index).replace(/\r$/u, '');
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const callback = pending.get(message.id);
      if (callback) {
        pending.delete(message.id);
        callback.resolve(message);
      }
    }
  });
  return {
    send(message, timeoutMs = 20_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new Error(`Timed out waiting for MCP response ${message.id}`));
        }, timeoutMs);
        pending.set(message.id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
        });
        child.stdin.write(`${JSON.stringify(message)}\n`);
      });
    },
    notify(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
  };
}

try {
  await import('node:fs/promises').then(({ mkdir }) =>
    Promise.all([mkdir(extracted), mkdir(installed), mkdir(project)]),
  );
  run('tar', ['-xf', artifact, '-C', extracted]);
  const entries = run('tar', ['-tf', artifact]).split(/\r?\n/u);
  const required = [
    'package/package.json',
    'package/dist/cli.js',
    'package/README.md',
    'package/README.ru.md',
    'package/LICENSE',
    'package/SECURITY.md',
    'package/CHANGELOG.md',
    'package/SBOM.cdx.json',
    'package/server.json',
    'package/docs/installation.md',
    'package/docs/public-release.md',
    'package/docs/release-readiness.md',
    'package/docs/security-model.md',
    'package/docs/secure-tunnel.md',
    'package/docs/secure-tunnel.ru.md',
    'package/scripts/install-windows.ps1',
    'package/scripts/uninstall-windows.ps1',
    'package/scripts/configure-autostart-windows.ps1',
    'package/scripts/run-autostart-windows.ps1',
    'package/scripts/remove-autostart-windows.ps1',
  ];
  for (const name of required) {
    if (!entries.includes(name)) throw new Error(`Package is missing ${name}`);
  }
  const forbidden = entries.find(
    (name) =>
      name.startsWith('package/tests/') ||
      name.startsWith('package/src/') ||
      name.includes('/.git/') ||
      /(?:^|\/)\.env(?:\.|$)/u.test(name) ||
      /\.(?:pem|key|p12|pfx)$/iu.test(name),
  );
  if (forbidden) throw new Error(`Forbidden package entry: ${forbidden}`);

  const packagedManifest = JSON.parse(
    await readFile(path.join(extracted, 'package', 'package.json'), 'utf8'),
  );
  if (packagedManifest.bin?.forgebridge !== 'dist/cli.js') {
    throw new Error('Packaged forgebridge bin does not point to dist/cli.js');
  }
  if (typeof packagedManifest.name !== 'string' || !packagedManifest.name) {
    throw new Error('Packaged manifest is missing a package name');
  }
  const registryMetadata = JSON.parse(
    await readFile(path.join(extracted, 'package', 'server.json'), 'utf8'),
  );
  if (
    registryMetadata.name !== packagedManifest.mcpName ||
    registryMetadata.version !== packagedManifest.version ||
    registryMetadata.packages?.[0]?.identifier !== packagedManifest.name ||
    registryMetadata.packages?.[0]?.version !== packagedManifest.version
  ) {
    throw new Error('server.json does not match the packaged npm identity/version');
  }
  const packagePathSegments = packagedManifest.name.split('/');
  const checksum = (await readFile(path.join(releaseDirectory, 'SHA256SUMS'), 'utf8'))
    .trim()
    .split(/\s+/u)[0];
  const actualChecksum = createHash('sha256')
    .update(await readFile(artifact))
    .digest('hex');
  if (checksum !== actualChecksum) throw new Error('Artifact checksum does not match SHA256SUMS');

  const [npmInstallCommand, npmInstallArguments] = npmInvocation([
    'install',
    '--prefix',
    installed,
    '--no-audit',
    '--no-fund',
    artifact,
  ]);
  run(npmInstallCommand, npmInstallArguments, {
    cwd: temporary,
  });
  const packageRoot = path.join(installed, 'node_modules', ...packagePathSegments);
  const cli = path.join(packageRoot, 'dist', 'cli.js');
  const version = run(process.execPath, [cli, '--version'], { cwd: temporary });
  if (version !== packagedManifest.version) throw new Error(`Unexpected CLI version: ${version}`);
  const [binCommand, binArguments] = npmInvocation([
    'exec',
    '--offline',
    '--prefix',
    installed,
    '--',
    'forgebridge',
    '--version',
  ]);
  const binVersion = run(binCommand, binArguments, { cwd: installed });
  if (binVersion !== version) throw new Error('Installed npm bin shim returned the wrong version');
  run(process.execPath, [cli, 'init', '--root', project, '--state', state], { cwd: temporary });
  const configFile = path.join(state, 'config.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.mode = 'full';
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(path.join(project, 'search-fixture.txt'), 'installed artifact needle\n', 'utf8');
  await writeFile(
    path.join(project, 'package.json'),
    JSON.stringify({ name: 'installed-fixture', scripts: { test: 'node --version' } }),
  );
  run('git', ['init'], { cwd: project });
  run('git', ['config', 'user.name', 'ForgeBridge Package Test'], { cwd: project });
  run('git', ['config', 'user.email', 'forgebridge-package@example.invalid'], { cwd: project });
  run('git', ['add', '.'], { cwd: project });
  run('git', ['commit', '-m', 'package fixture'], { cwd: project });

  const child = spawn(
    process.execPath,
    [cli, 'serve', '--transport', 'stdio', '--config', configFile, '--state', state],
    { cwd: temporary, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false },
  );
  child.stderr.resume();
  const rpc = createRpcClient(child);
  try {
    const initialized = await rpc.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'forgebridge-package-validation', version: '1.0.0' },
      },
    });
    if (initialized.error) throw new Error(JSON.stringify(initialized.error));
    rpc.notify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    const tools = await rpc.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const names = tools.result?.tools?.map((tool) => tool.name) ?? [];
    for (const name of [
      'project_inspect',
      'project_scripts',
      'project_check',
      'fs_read',
      'terminal',
      'browser_read',
      'permissions_status',
    ]) {
      if (!names.includes(name)) throw new Error(`Installed MCP server is missing ${name}`);
    }
    const status = await rpc.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'permissions_status', arguments: {} },
    });
    if (status.error || status.result?.isError) throw new Error('Installed MCP status call failed');

    const projectSnapshot = await rpc.send({
      jsonrpc: '2.0',
      id: 801,
      method: 'tools/call',
      params: { name: 'project_inspect', arguments: { workingDirectory: project } },
    });
    const snapshotData = projectSnapshot.result?.structuredContent?.data;
    if (projectSnapshot.result?.isError || snapshotData?.name !== 'installed-fixture') {
      throw new Error('Installed project inspection failed');
    }
    const plan = snapshotData.checks.find((item) => item.kind === 'test');
    if (!plan) throw new Error('Installed inspection has no test plan');
    const checkArguments = { workingDirectory: project, kind: 'test', planSha256: plan.planSha256 };
    const pendingCheck = await rpc.send({
      jsonrpc: '2.0',
      id: 802,
      method: 'tools/call',
      params: { name: 'project_check', arguments: checkArguments },
    });
    const approvalIds = pendingCheck.result?.structuredContent?.error?.details?.approval_ids;
    if (!Array.isArray(approvalIds) || approvalIds.length !== 1)
      throw new Error('Installed validation must require exact approval even in FULL');
    for (const id of approvalIds)
      run(process.execPath, [cli, 'approve', id, '--kind', 'once', '--state', state], {
        cwd: temporary,
      });
    const checked = await rpc.send({
      jsonrpc: '2.0',
      id: 803,
      method: 'tools/call',
      params: { name: 'project_check', arguments: { ...checkArguments, approvalIds } },
    });
    if (
      checked.result?.isError ||
      checked.result?.structuredContent?.data?.result?.exitCode !== 0
    ) {
      throw new Error('Installed validation approval retry failed: ' + JSON.stringify(checked));
    }

    run(process.execPath, [cli, 'project', 'trust', project, '--state', state], { cwd: temporary });
    const trustedSnapshot = await rpc.send({
      jsonrpc: '2.0',
      id: 804,
      method: 'tools/call',
      params: { name: 'project_inspect', arguments: { workingDirectory: project } },
    });
    const trustedPolicy = trustedSnapshot.result?.structuredContent?.data?.permissionPolicy;
    if (
      trustedSnapshot.result?.isError ||
      trustedPolicy?.effectiveMode !== 'full' ||
      trustedPolicy?.autonomy !== 'trusted-local'
    ) {
      throw new Error('Installed trusted-local project policy was not applied');
    }
    const trustedCheck = await rpc.send({
      jsonrpc: '2.0',
      id: 805,
      method: 'tools/call',
      params: { name: 'project_check', arguments: checkArguments },
    });
    if (
      trustedCheck.result?.isError ||
      trustedCheck.result?.structuredContent?.data?.result?.exitCode !== 0
    ) {
      throw new Error('Installed trusted-local validation failed: ' + JSON.stringify(trustedCheck));
    }
    run(process.execPath, [cli, 'project', 'remove', project, '--state', state], {
      cwd: temporary,
    });

    const fileStatus = await rpc.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'fs_read', arguments: { operation: 'stat', path: project } },
    });
    if (fileStatus.error || fileStatus.result?.isError) {
      throw new Error(`Installed filesystem call failed: ${JSON.stringify(fileStatus)}`);
    }
    const search = await rpc.send({
      jsonrpc: '2.0',
      id: 45,
      method: 'tools/call',
      params: {
        name: 'fs_read',
        arguments: { operation: 'search_content', path: project, query: 'artifact needle' },
      },
    });
    if (
      search.error ||
      search.result?.isError ||
      search.result?.structuredContent?.data?.matches?.length !== 1
    ) {
      throw new Error(`Installed filesystem search failed: ${JSON.stringify(search)}`);
    }
    const terminal = await rpc.send({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'terminal',
        arguments: { operation: 'run', command: 'node --version', workingDirectory: project },
      },
    });
    if (terminal.error || terminal.result?.isError) {
      throw new Error(`Installed terminal call failed: ${JSON.stringify(terminal)}`);
    }
    const interactive = await rpc.send({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'terminal',
        arguments: {
          operation: 'start',
          command: 'node -e "console.log(\'package-pty-ok\')"',
          workingDirectory: project,
        },
      },
    });
    const processId = interactive.result?.structuredContent?.data?.id;
    if (interactive.error || interactive.result?.isError || typeof processId !== 'string') {
      throw new Error(`Installed node-pty call failed: ${JSON.stringify(interactive)}`);
    }
    let ptyOutput = '';
    for (let attempt = 0; attempt < 20 && !ptyOutput.includes('package-pty-ok'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const read = await rpc.send({
        jsonrpc: '2.0',
        id: 70 + attempt,
        method: 'tools/call',
        params: { name: 'terminal', arguments: { operation: 'read', processId } },
      });
      ptyOutput = read.result?.structuredContent?.data?.data ?? '';
    }
    if (!ptyOutput.includes('package-pty-ok'))
      throw new Error('Installed node-pty produced no output');
    const browser = await rpc.send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'browser_read', arguments: { operation: 'launch' } },
    });
    if (browser.error || browser.result?.isError) {
      throw new Error(`Installed browser call failed: ${JSON.stringify(browser)}`);
    }
    const browserSessionId = browser.result?.structuredContent?.data?.id;
    if (typeof browserSessionId !== 'string')
      throw new Error('Installed browser returned no session ID');
    const closeBrowser = await rpc.send({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'browser_act',
        arguments: { operation: 'close', sessionId: browserSessionId },
      },
    });
    if (closeBrowser.error || closeBrowser.result?.isError) {
      throw new Error(`Installed browser close failed: ${JSON.stringify(closeBrowser)}`);
    }
    const created = await rpc.send({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'fs_write',
        arguments: {
          operation: 'create',
          path: path.join(project, 'installed-change.txt'),
          content: 'installed artifact write\n',
        },
      },
    });
    if (created.error || created.result?.isError) {
      throw new Error(`Installed filesystem write failed: ${JSON.stringify(created)}`);
    }
    const git = await rpc.send({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'git_read', arguments: { operation: 'status', repository: project } },
    });
    if (
      git.error ||
      git.result?.isError ||
      !git.result?.structuredContent?.data?.stdout?.includes('installed-change.txt')
    ) {
      throw new Error(`Installed Git status failed: ${JSON.stringify(git)}`);
    }
    const job = await rpc.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'jobs',
        arguments: {
          operation: 'create',
          command: 'node -e "setTimeout(()=>console.log(\'installed-job-ok\'),150)"',
          workingDirectory: project,
        },
      },
    });
    const jobId = job.result?.structuredContent?.data?.id;
    if (job.error || job.result?.isError || typeof jobId !== 'string') {
      throw new Error(`Installed durable job start failed: ${JSON.stringify(job)}`);
    }
    let jobStatus;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      jobStatus = await rpc.send({
        jsonrpc: '2.0',
        id: 120 + attempt,
        method: 'tools/call',
        params: { name: 'jobs', arguments: { operation: 'status', jobId } },
      });
      if (jobStatus.result?.structuredContent?.data?.status !== 'running') break;
    }
    if (jobStatus?.result?.structuredContent?.data?.status !== 'succeeded') {
      throw new Error(`Installed durable job failed: ${JSON.stringify(jobStatus)}`);
    }
    const jobLogs = await rpc.send({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'jobs', arguments: { operation: 'logs', jobId } },
    });
    if (!jobLogs.result?.structuredContent?.data?.data?.includes('installed-job-ok')) {
      throw new Error(`Installed durable job logs failed: ${JSON.stringify(jobLogs)}`);
    }
    const foreground = await rpc.send({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'foreground', arguments: { operation: 'status' } },
    });
    if (
      foreground.error ||
      foreground.result?.isError ||
      foreground.result?.structuredContent?.data?.profile !== 'background' ||
      foreground.result?.structuredContent?.data?.forceHeadlessBrowser !== true
    ) {
      throw new Error(`Installed background profile check failed: ${JSON.stringify(foreground)}`);
    }
    const audit = await rpc.send({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'audit_read', arguments: { afterSequence: 0, limit: 500 } },
    });
    if (
      audit.error ||
      audit.result?.isError ||
      !Array.isArray(audit.result?.structuredContent?.data?.entries) ||
      audit.result.structuredContent.data.entries.length === 0
    ) {
      throw new Error(`Installed audit read failed: ${JSON.stringify(audit)}`);
    }
  } finally {
    await stopChild(child);
  }

  const httpPort = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not reserve a package-validation HTTP port'));
        return;
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  config.localHttp.port = httpPort;
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const authValue = JSON.parse(await readFile(path.join(state, 'local-token.json'), 'utf8')).token;
  const httpChild = spawn(
    process.execPath,
    [cli, 'serve', '--transport', 'http', '--config', configFile, '--state', state],
    { cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false },
  );
  httpChild.stdout.resume();
  httpChild.stderr.resume();
  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      response = await globalThis
        .fetch(`http://127.0.0.1:${httpPort}/control/status`, {
          headers: { Authorization: `Bearer ${authValue}` },
        })
        .catch(() => undefined);
      if (response?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!response?.ok) throw new Error('Installed authenticated HTTP transport did not start');
    const status = await response.json();
    if (status?.status?.execution?.forceHeadlessBrowser !== true) {
      throw new Error(`Installed HTTP status was unexpected: ${JSON.stringify(status)}`);
    }
  } finally {
    await stopChild(httpChild);
  }

  let tunnelClient = 'not-configured';
  const tunnelClientPath = process.env.FORGEBRIDGE_TUNNEL_CLIENT;
  if (tunnelClientPath) {
    const tunnelVersion = run(tunnelClientPath, ['--version'], { cwd: temporary });
    tunnelClient = `binary-verified:${tunnelVersion}`;
  }

  const [npmUninstallCommand, npmUninstallArguments] = npmInvocation([
    'uninstall',
    '--prefix',
    installed,
    packagedManifest.name,
    '--no-audit',
    '--no-fund',
  ]);
  run(npmUninstallCommand, npmUninstallArguments, {
    cwd: temporary,
  });
  const remaining = await readFile(path.join(packageRoot, 'package.json'))
    .then(() => true)
    .catch(() => false);
  if (remaining) throw new Error('npm uninstall left the ForgeBridge package installed');
  let windowsInstaller = 'not-applicable';
  if (process.platform === 'win32') {
    const windowsInstall = path.join(temporary, 'windows-install');
    const windowsState = path.join(temporary, 'windows-state');
    const installer = path.join(extracted, 'package', 'scripts', 'install-windows.ps1');
    const uninstaller = path.join(extracted, 'package', 'scripts', 'uninstall-windows.ps1');
    run(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installer,
        '-PackagePath',
        artifact,
        '-InstallRoot',
        windowsInstall,
      ],
      { cwd: temporary },
    );
    const windowsCli = path.join(
      windowsInstall,
      'node_modules',
      ...packagePathSegments,
      'dist',
      'cli.js',
    );
    if (run(process.execPath, [windowsCli, '--version'], { cwd: temporary }) !== version) {
      throw new Error('Windows installer CLI smoke test returned the wrong version');
    }
    run(process.execPath, [windowsCli, 'init', '--root', project, '--state', windowsState], {
      cwd: temporary,
    });
    run(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '& $env:FORGEBRIDGE_UNINSTALL_SCRIPT -InstallRoot $env:FORGEBRIDGE_INSTALL_ROOT -StateDirectory $env:FORGEBRIDGE_STATE_DIR -Confirm:$false',
      ],
      {
        cwd: temporary,
        env: {
          ...process.env,
          FORGEBRIDGE_UNINSTALL_SCRIPT: uninstaller,
          FORGEBRIDGE_INSTALL_ROOT: windowsInstall,
          FORGEBRIDGE_STATE_DIR: windowsState,
        },
      },
    );
    if (!(await readFile(path.join(windowsState, 'config.json'), 'utf8'))) {
      throw new Error('Windows uninstaller did not preserve state by default');
    }
    run(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '& $env:FORGEBRIDGE_UNINSTALL_SCRIPT -InstallRoot $env:FORGEBRIDGE_INSTALL_ROOT -StateDirectory $env:FORGEBRIDGE_STATE_DIR -RemoveState -Confirm:$false',
      ],
      {
        cwd: temporary,
        env: {
          ...process.env,
          FORGEBRIDGE_UNINSTALL_SCRIPT: uninstaller,
          FORGEBRIDGE_INSTALL_ROOT: windowsInstall,
          FORGEBRIDGE_STATE_DIR: windowsState,
        },
      },
    );
    const stateRemains = await readFile(path.join(windowsState, 'config.json'))
      .then(() => true)
      .catch(() => false);
    if (stateRemains)
      throw new Error('Windows uninstaller did not remove explicitly selected state');
    windowsInstaller = 'passed';
  }
  process.stdout.write(
    `${JSON.stringify({ artifact, sha256: actualChecksum, version, project: 'passed', stdioApproval: 'passed', trustedLocal: 'passed', mcp: 'passed', http: 'passed', filesystem: 'passed', terminal: 'passed', pty: 'passed', git: 'passed', jobs: 'passed', browser: 'passed', audit: 'passed', background: 'passed', tunnelClient, uninstall: 'passed', windowsInstaller }, null, 2)}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
