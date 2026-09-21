#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runDeviceCommand } from './device/command.js';
import { isMainModule } from './core/entrypoint.js';
import { claimControlEndpoint, readControlEndpoint } from './control/endpoint.js';
import { ForgeBridgeAgent } from './agent.js';
import {
  defaultConfig,
  defaultStateDirectory,
  loadConfig,
  saveConfig,
  type ForgeBridgeConfig,
} from './core/config.js';
import { asForgeBridgeError } from './core/errors.js';
import { DeviceIdentityStore } from './core/identity.js';
import { LocalTokenStore } from './core/local-token.js';
import { ensurePrivateDirectory } from './core/file-permissions.js';
import { LocalHttpTransportServer } from './transports/http.js';
import { runSetupCommand } from './setup/command.js';
import { connectStdio } from './transports/stdio.js';
import {
  forgeBridgeStdioCommand,
  forgeBridgeLauncher,
  runTunnelClient,
  tunnelClientArguments,
  type TunnelOperation,
} from './tunnel/client.js';
import { FORGEBRIDGE_VERSION } from './version.js';

type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function stateDirectory(args: readonly string[]): string {
  return path.resolve(option(args, '--state') ?? defaultStateDirectory());
}

function configFile(args: readonly string[], state: string): string {
  return path.resolve(option(args, '--config') ?? path.join(state, 'config.json'));
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function usage(): string {
  return `ForgeBridge ${FORGEBRIDGE_VERSION}

Usage:
  forgebridge setup [--root PATH] [--local] [--chatgpt] [--cursor] [--claude] [--mode ask|balanced|full] [--autonomy standard|trusted-local] [--tunnel-id ID] [--non-interactive] [--force]
  forgebridge init [--root PATH] [--state PATH] [--force]
  forgebridge doctor [--config FILE] [--state PATH]
  forgebridge browser install [--with-deps]
  forgebridge serve --transport stdio|http [--config FILE] [--state PATH]
  forgebridge status [--config FILE] [--state PATH]
  forgebridge device list|status|rename NAME|ping|revoke [--config FILE] [--state PATH]
  forgebridge approvals [--config FILE] [--state PATH]
  forgebridge approve APPROVAL_ID [--kind once|session|temporary] [--duration-ms N] [--max-uses N]
  forgebridge deny APPROVAL_ID
  forgebridge pause | resume | revoke
  forgebridge execution normal|background|gaming
  forgebridge background on|off
  forgebridge project trust PATH
  forgebridge project set PATH --mode ask|balanced|full [--autonomy standard|trusted-local]
  forgebridge project remove PATH
  forgebridge foreground list
  forgebridge foreground approve|defer|cancel ACTION_ID
  forgebridge token show
  forgebridge tunnel init --tunnel-id ID [--profile NAME] [--tunnel-client PATH]
  forgebridge tunnel doctor|run [--profile NAME] [--tunnel-client PATH]

HTTP control commands authenticate to the configured loopback endpoint. ForgeBridge does not enable
auto-start implicitly. The packaged Windows scripts can configure or remove an explicit current-user
logon task after local review; see docs/autostart-windows.md.`;
}

async function readConfiguration(args: readonly string[]): Promise<{
  state: string;
  file: string;
  config: ForgeBridgeConfig;
}> {
  const state = stateDirectory(args);
  const file = configFile(args, state);
  return { state, file, config: await loadConfig(file) };
}

async function controlRequest(
  args: readonly string[],
  pathname: string,
  init: RequestInit = {},
): Promise<unknown> {
  const { state, config } = await readConfiguration(args);
  const token = await new LocalTokenStore(state).loadOrCreate();
  const endpoint = (await readControlEndpoint(state)) ?? config.localHttp;
  const host = endpoint.host === '::1' ? '[::1]' : endpoint.host;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token.token}`);
  headers.set('Content-Type', 'application/json');
  const origin = `http://${host}:${endpoint.port}`;
  if (init.method && init.method !== 'GET') {
    const csrfResponse = await fetch(`${origin}/control/csrf`, { headers });
    const csrfBody = (await csrfResponse.json()) as { csrfToken?: string };
    if (!csrfResponse.ok || !csrfBody.csrfToken) {
      throw new Error(`Could not obtain control CSRF token (${csrfResponse.status})`);
    }
    headers.set('X-ForgeBridge-CSRF', csrfBody.csrfToken);
  }
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers,
  });
  const body = (await response.json()) as unknown;
  if (!response.ok)
    throw new Error(`Control request failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

export async function runCli(
  args = process.argv.slice(2),
  io: CliIo = {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
  },
): Promise<number> {
  const command = args[0];
  if (command === '--version' || command === '-v' || command === 'version') {
    io.stdout(FORGEBRIDGE_VERSION);
    return 0;
  }
  if (!command || command === 'help' || has(args, '--help')) {
    io.stdout(usage());
    return 0;
  }

  if (command === 'setup') {
    return runSetupCommand(args, io, fileURLToPath(import.meta.url));
  }

  if (command === 'doctor') {
    const state = stateDirectory(args);
    const file = configFile(args, state);
    const checks: {
      name: string;
      status: 'pass' | 'warn' | 'fail';
      detail: string;
    }[] = [];
    const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
    checks.push({
      name: 'node',
      status: nodeMajor >= 22 ? 'pass' : 'fail',
      detail: `${process.version} (requires Node.js 22 or newer)`,
    });

    const initialized = await exists(file);
    let roots: { path: string; exists: boolean }[] = [];
    let executionProfile: string | undefined;
    let windowsUiAutomation: boolean | undefined;
    if (!initialized) {
      checks.push({
        name: 'config',
        status: 'fail',
        detail: `not initialized; configuration is missing at ${file}`,
      });
    } else {
      try {
        const config = await loadConfig(file);
        checks.push({ name: 'config', status: 'pass', detail: file });
        roots = await Promise.all(
          config.roots.map(async (root) => ({ path: root.path, exists: await exists(root.path) })),
        );
        for (const root of roots) {
          checks.push({
            name: 'root',
            status: root.exists ? 'pass' : 'fail',
            detail: root.exists ? root.path : `missing: ${root.path}`,
          });
        }
        executionProfile = config.execution.profile;
        windowsUiAutomation = config.windowsUiAutomation.enabled;
      } catch (error) {
        checks.push({
          name: 'config',
          status: 'fail',
          detail: asForgeBridgeError(error).message,
        });
      }
    }

    let controlEndpoint: { host: string; port: number } | undefined;
    try {
      controlEndpoint = await readControlEndpoint(state);
      checks.push({
        name: 'agent',
        status: controlEndpoint ? 'pass' : 'warn',
        detail: controlEndpoint
          ? `control endpoint active on ${controlEndpoint.host}:${controlEndpoint.port}`
          : 'agent is not currently running',
      });
    } catch (error) {
      checks.push({
        name: 'agent',
        status: 'warn',
        detail: asForgeBridgeError(error).message,
      });
    }

    const ok = checks.every((check) => check.status !== 'fail');
    const nextSteps: string[] = [];
    if (!initialized) nextSteps.push(`forgebridge init --root ${process.cwd()}`);
    else if (!controlEndpoint) nextSteps.push('forgebridge serve --transport stdio');
    nextSteps.push('forgebridge tunnel doctor --profile forgebridge-local');

    io.stdout(
      JSON.stringify(
        {
          ok,
          version: FORGEBRIDGE_VERSION,
          platform: {
            os: process.platform,
            architecture: process.arch,
            node: process.version,
          },
          state,
          config: file,
          initialized,
          roots,
          executionProfile,
          windowsUiAutomation,
          controlEndpoint: controlEndpoint ?? null,
          checks,
          nextSteps,
        },
        null,
        2,
      ),
    );
    return ok ? 0 : 1;
  }

  if (command === 'browser') {
    if (args[1] !== 'install') {
      throw new Error('browser requires: install [--with-deps]');
    }
    const playwrightEntry = fileURLToPath(import.meta.resolve('playwright'));
    const playwrightCli = path.join(path.dirname(playwrightEntry), 'cli.js');
    if (!(await exists(playwrightCli))) {
      throw new Error(`Playwright CLI was not found at ${playwrightCli}`);
    }
    const installArguments = [
      playwrightCli,
      'install',
      ...(has(args, '--with-deps') ? ['--with-deps'] : []),
      'chromium',
    ];
    const installed = spawnSync(process.execPath, installArguments, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });
    if (installed.error) throw installed.error;
    return installed.status ?? 1;
  }

  if (command === 'init') {
    const state = stateDirectory(args);
    const file = configFile(args, state);
    if ((await exists(file)) && !has(args, '--force')) {
      throw new Error(`Configuration already exists: ${file}. Use --force to replace it.`);
    }
    const root = path.resolve(option(args, '--root') ?? process.cwd());
    const config = defaultConfig(root);
    await ensurePrivateDirectory(state);
    await saveConfig(file, config);
    const identity = await new DeviceIdentityStore(state).loadOrCreate();
    await new LocalTokenStore(state).loadOrCreate();
    io.stdout(
      JSON.stringify(
        {
          initialized: true,
          config: file,
          state,
          root,
          deviceId: identity.deviceId,
          fingerprint: identity.fingerprint,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === 'serve') {
    const { state, file, config } = await readConfiguration(args);
    const transport = option(args, '--transport') ?? 'stdio';
    if (transport !== 'stdio' && transport !== 'http')
      throw new Error(`Unsupported transport: ${transport}`);
    const endpoint = await claimControlEndpoint(state);
    let agent: ForgeBridgeAgent | undefined;
    let http: LocalHttpTransportServer | undefined;
    let closeStdio: (() => Promise<void>) | undefined;
    try {
      agent = await ForgeBridgeAgent.create(config, state, [file]);
      agent.setTransport(transport);
      const activeAgent = agent;
      http = new LocalHttpTransportServer({
        agent,
        tokens: new LocalTokenStore(state),
        host: config.localHttp.host,
        port: transport === 'stdio' ? 0 : config.localHttp.port,
        allowedOrigins: config.localHttp.allowedOrigins,
        maxRequestBytes: config.limits.maxRequestBytes,
        maxConcurrentRequests: config.limits.maxConcurrentRequests,
        saveConfiguration: async () => saveConfig(file, activeAgent.config),
      });
      const address = await http.listen();
      await endpoint.publish(config.localHttp.host, address.port);
      let disconnected: Promise<void> | undefined;
      if (transport === 'stdio') {
        const connection = await connectStdio(agent);
        closeStdio = async () => connection.server.close();
        disconnected = new Promise<void>((resolve) => {
          const previous = connection.transport.onclose;
          connection.transport.onclose = () => {
            previous?.();
            resolve();
          };
          process.stdin.once('end', resolve);
        });
        io.stderr(
          'ForgeBridge MCP is running over stdio with authenticated loopback control. Use forgebridge status/approve with the same --state.',
        );
      } else io.stdout(JSON.stringify({ ready: true, ...address }, null, 2));
      let stop: () => void = () => undefined;
      const stopped = new Promise<void>((resolve) => {
        stop = resolve;
      });
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      try {
        await (disconnected ? Promise.race([stopped, disconnected]) : stopped);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
      return 0;
    } finally {
      await closeStdio?.();
      await http?.close();
      await agent?.close();
      await endpoint.release();
    }
  }

  if (command === 'token' && args[1] === 'show') {
    const token = await new LocalTokenStore(stateDirectory(args)).loadOrCreate();
    io.stdout(token.token);
    return 0;
  }

  if (command === 'tunnel') {
    const operation = args[1] as TunnelOperation | undefined;
    if (operation !== 'init' && operation !== 'doctor' && operation !== 'run') {
      throw new Error('tunnel requires one of: init, doctor, run');
    }
    const { state, file } = await readConfiguration(args);
    const profile = option(args, '--profile') ?? 'forgebridge-local';
    const executable = option(args, '--tunnel-client') ?? 'tunnel-client';
    const tunnelId = option(args, '--tunnel-id');
    const profileDirectory = option(args, '--profile-dir');
    const cliEntry = fileURLToPath(import.meta.url);
    const launcher = forgeBridgeLauncher(
      cliEntry,
      process.execPath,
      cliEntry.endsWith('.js') ? undefined : fileURLToPath(import.meta.resolve('tsx/cli')),
    );
    const mcpCommand =
      option(args, '--mcp-command') ?? forgeBridgeStdioCommand(file, state, launcher);
    const tunnelArgs = tunnelClientArguments({
      operation,
      profile,
      ...(profileDirectory ? { profileDirectory: path.resolve(profileDirectory) } : {}),
      ...(tunnelId ? { tunnelId } : {}),
      ...(operation === 'init' ? { mcpCommand } : {}),
      explain: operation === 'doctor',
    });
    return runTunnelClient(executable, tunnelArgs);
  }

  if (command === 'device') {
    return runDeviceCommand(args, io, (pathname, init) => controlRequest(args, pathname, init));
  }

  if (command === 'status') {
    io.stdout(JSON.stringify(await controlRequest(args, '/control/status'), null, 2));
    return 0;
  }
  if (command === 'approvals') {
    const result = (await controlRequest(args, '/control/status')) as {
      status?: { pendingApprovals?: unknown };
    };
    io.stdout(JSON.stringify(result.status?.pendingApprovals ?? [], null, 2));
    return 0;
  }
  if (command === 'execution') {
    const profile = args[1];
    if (profile !== 'normal' && profile !== 'background' && profile !== 'gaming') {
      throw new Error('execution requires one of: normal, background, gaming');
    }
    io.stdout(
      JSON.stringify(
        await controlRequest(args, '/control/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'set_execution_profile', profile }),
        }),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === 'background') {
    const value = args[1];
    if (value !== 'on' && value !== 'off') throw new Error('background requires on or off');
    io.stdout(
      JSON.stringify(
        await controlRequest(args, '/control/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'set_background_mode', enabled: value === 'on' }),
        }),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === 'project') {
    const operation = args[1];
    const root = args[2];
    if (!root) throw new Error('project requires a project path');
    if (operation === 'trust') {
      io.stdout(
        JSON.stringify(
          await controlRequest(args, '/control/action', {
            method: 'POST',
            body: JSON.stringify({
              action: 'set_project_policy',
              root,
              mode: 'full',
              autonomy: 'trusted-local',
            }),
          }),
          null,
          2,
        ),
      );
      return 0;
    }
    if (operation === 'set') {
      const mode = option(args, '--mode');
      const autonomy = option(args, '--autonomy') ?? 'standard';
      if (mode !== 'ask' && mode !== 'balanced' && mode !== 'full') {
        throw new Error('project set requires --mode ask|balanced|full');
      }
      if (autonomy !== 'standard' && autonomy !== 'trusted-local') {
        throw new Error('project set --autonomy requires standard|trusted-local');
      }
      io.stdout(
        JSON.stringify(
          await controlRequest(args, '/control/action', {
            method: 'POST',
            body: JSON.stringify({ action: 'set_project_policy', root, mode, autonomy }),
          }),
          null,
          2,
        ),
      );
      return 0;
    }
    if (operation === 'remove') {
      io.stdout(
        JSON.stringify(
          await controlRequest(args, '/control/action', {
            method: 'POST',
            body: JSON.stringify({ action: 'remove_project_profile', root }),
          }),
          null,
          2,
        ),
      );
      return 0;
    }
    throw new Error('project requires trust, set, or remove');
  }

  if (command === 'foreground') {
    const operation = args[1];
    if (operation === 'list') {
      const result = (await controlRequest(args, '/control/status')) as {
        status?: { execution?: { foregroundActions?: unknown } };
      };
      io.stdout(JSON.stringify(result.status?.execution?.foregroundActions ?? [], null, 2));
      return 0;
    }
    if (operation !== 'approve' && operation !== 'defer' && operation !== 'cancel') {
      throw new Error('foreground requires list or approve|defer|cancel ACTION_ID');
    }
    const foregroundActionId = args[2];
    if (!foregroundActionId) throw new Error(`foreground ${operation} requires an action ID`);
    io.stdout(
      JSON.stringify(
        await controlRequest(args, '/control/action', {
          method: 'POST',
          body: JSON.stringify({
            action: 'foreground_action',
            foregroundActionId,
            response: operation,
          }),
        }),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === 'approve' || command === 'deny') {
    const approvalId = args[1];
    if (!approvalId) throw new Error(`${command} requires an approval ID`);
    const response = command === 'deny' ? 'deny' : (option(args, '--kind') ?? 'once');
    if (!['deny', 'once', 'session', 'temporary'].includes(response)) {
      throw new Error(`Unsupported approval response: ${response}`);
    }
    const durationValue = option(args, '--duration-ms');
    const maxUsesValue = option(args, '--max-uses');
    io.stdout(
      JSON.stringify(
        await controlRequest(args, '/control/action', {
          method: 'POST',
          body: JSON.stringify({
            action: 'approval',
            approvalId,
            response,
            ...(durationValue ? { durationMs: Number(durationValue) } : {}),
            ...(maxUsesValue ? { maxUses: Number(maxUsesValue) } : {}),
          }),
        }),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === 'pause' || command === 'resume' || command === 'revoke') {
    io.stdout(
      JSON.stringify(
        await controlRequest(args, '/control/action', {
          method: 'POST',
          body: JSON.stringify({ action: command }),
        }),
        null,
        2,
      ),
    );
    return 0;
  }

  io.stderr(`Unknown command: ${command}\n\n${usage()}`);
  return 2;
}

if (isMainModule(import.meta.url)) {
  runCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const normalized = asForgeBridgeError(error);
      process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
      process.exitCode = 1;
    },
  );
}
