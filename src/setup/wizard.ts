import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { access } from 'node:fs/promises';
import type { ForgeBridgeConfig, ProjectAutonomy } from '../core/config.js';
import { defaultConfig, loadConfig, saveConfig } from '../core/config.js';
import { ensurePrivateDirectory } from '../core/file-permissions.js';
import { DeviceIdentityStore } from '../core/identity.js';
import { LocalTokenStore } from '../core/local-token.js';

export const SETUP_CLIENTS = ['local', 'chatgpt', 'cursor', 'claude'] as const;
export type SetupClient = (typeof SETUP_CLIENTS)[number];
export type SetupMode = ForgeBridgeConfig['mode'];

export type SetupOptions = {
  root: string;
  state: string;
  configFile: string;
  launcher: readonly string[];
  clients: readonly SetupClient[];
  mode: SetupMode;
  autonomy: ProjectAutonomy;
  force?: boolean;
  tunnelId?: string;
};

export type StdioClientDefinition = {
  type: 'stdio';
  command: string;
  args: string[];
};

export type SetupResult = {
  ok: boolean;
  initialized: boolean;
  reusedExistingConfig: boolean;
  version: 1;
  platform: {
    os: NodeJS.Platform;
    architecture: string;
    node: string;
    nodeSupported: boolean;
    git: { available: boolean; version?: string };
  };
  root: string;
  state: string;
  config: string;
  device: { id: string; fingerprint: string };
  policy: { mode: SetupMode; autonomy: ProjectAutonomy };
  clients: Partial<
    Record<
      SetupClient,
      {
        kind: 'stdio' | 'tunnel';
        command?: string;
        mcpJson?: { mcpServers: { forgebridge: StdioClientDefinition } };
        tunnelId?: string;
        tunnelInitCommand?: string;
        instructions?: string[];
      }
    >
  >;
  checks: { name: string; status: 'pass' | 'warn' | 'fail'; detail: string }[];
  nextSteps: string[];
};

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string, platform = process.platform): string {
  if (platform === 'win32') return `'${value.replaceAll("'", "''")}'`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildStdioClientDefinition(
  launcher: readonly string[],
  configFile: string,
  state: string,
): StdioClientDefinition {
  const [command, ...launcherArgs] = launcher;
  if (!command) throw new Error('ForgeBridge launcher is empty');
  return {
    type: 'stdio',
    command,
    args: [
      ...launcherArgs,
      'serve',
      '--transport',
      'stdio',
      '--config',
      configFile,
      '--state',
      state,
    ],
  };
}

export function commandLine(command: string, args: readonly string[], platform = process.platform) {
  const quoted = [command, ...args].map((part) => shellQuote(part, platform)).join(' ');
  return platform === 'win32' ? `& ${quoted}` : quoted;
}

export function claudeCodeCommand(
  definition: StdioClientDefinition,
  platform = process.platform,
): string {
  const quoted = [
    'claude',
    'mcp',
    'add',
    '--transport',
    'stdio',
    'forgebridge',
    '--',
    definition.command,
    ...definition.args,
  ]
    .map((part) => shellQuote(part, platform))
    .join(' ');
  return platform === 'win32' ? '& ' + quoted : quoted;
}

export function forgeBridgeCommand(
  launcher: readonly string[],
  args: readonly string[],
  platform = process.platform,
): string {
  const [command, ...launcherArgs] = launcher;
  if (!command) throw new Error('ForgeBridge launcher is empty');
  return commandLine(command, [...launcherArgs, ...args], platform);
}

function pathKey(value: string, platform = process.platform): string {
  const resolved = path.resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function detectGit(): { available: boolean; version?: string } {
  const result = spawnSync('git', ['--version'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return { available: false };
  const version = result.stdout.trim();
  return version ? { available: true, version } : { available: true };
}

function applyPolicy(
  config: ForgeBridgeConfig,
  root: string,
  mode: SetupMode,
  autonomy: ProjectAutonomy,
): ForgeBridgeConfig {
  const canonicalRoot = path.resolve(root);
  config.mode = mode;
  config.projectProfiles = [
    ...config.projectProfiles.filter((profile) => pathKey(profile.root) !== pathKey(canonicalRoot)),
    { root: canonicalRoot, mode, autonomy, rules: [] },
  ];
  return config;
}

export async function performSetup(options: SetupOptions): Promise<SetupResult> {
  const root = path.resolve(options.root);
  const state = path.resolve(options.state);
  const configFile = path.resolve(options.configFile);
  const configExists = await exists(configFile);
  let config: ForgeBridgeConfig;
  let reusedExistingConfig = false;

  await ensurePrivateDirectory(state);
  if (configExists && !options.force) {
    config = await loadConfig(configFile);
    reusedExistingConfig = true;
  } else {
    config = defaultConfig(root);
    applyPolicy(config, root, options.mode, options.autonomy);
    await saveConfig(configFile, config);
  }

  const identity = await new DeviceIdentityStore(state).loadOrCreate();
  await new LocalTokenStore(state).loadOrCreate();

  const requestedRootKey = pathKey(root);
  const configuredRoot =
    config.projectProfiles.find((profile) => pathKey(profile.root) === requestedRootKey)?.root ??
    config.roots.find((entry) => pathKey(entry.path) === requestedRootKey)?.path ??
    config.projectProfiles[0]?.root ??
    config.roots[0]?.path ??
    root;
  const effectiveRoot = path.resolve(reusedExistingConfig ? configuredRoot : root);
  const rootExists = await exists(effectiveRoot);

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const git = detectGit();
  const checks: SetupResult['checks'] = [
    {
      name: 'node',
      status: nodeMajor >= 22 ? 'pass' : 'fail',
      detail: `${process.version} (requires Node.js 22 or newer)`,
    },
    {
      name: 'git',
      status: git.available ? 'pass' : 'warn',
      detail: git.version ?? 'Git was not found on PATH; Git tools will be unavailable',
    },
    {
      name: 'config',
      status: 'pass',
      detail: reusedExistingConfig
        ? `reused existing configuration at ${configFile}`
        : `created configuration at ${configFile}`,
    },
    {
      name: 'root',
      status: rootExists ? 'pass' : 'fail',
      detail: rootExists ? effectiveRoot : `missing: ${effectiveRoot}`,
    },
  ];

  const definition = buildStdioClientDefinition(options.launcher, configFile, state);
  const clients: SetupResult['clients'] = {};
  const selected = new Set(options.clients.length > 0 ? options.clients : ['local']);

  if (selected.has('local')) {
    clients.local = {
      kind: 'stdio',
      command: commandLine(definition.command, definition.args),
      mcpJson: { mcpServers: { forgebridge: definition } },
    };
  }
  if (selected.has('cursor')) {
    clients.cursor = {
      kind: 'stdio',
      mcpJson: { mcpServers: { forgebridge: definition } },
      instructions: [
        'Save this as ~/.cursor/mcp.json for global use or .cursor/mcp.json for project use.',
        'Open Cursor Customize > MCPs and verify forgebridge is connected.',
      ],
    };
  }
  if (selected.has('claude')) {
    clients.claude = {
      kind: 'stdio',
      command: claudeCodeCommand(definition),
      mcpJson: { mcpServers: { forgebridge: definition } },
      instructions: ['Run the command, then verify with: claude mcp get forgebridge'],
    };
  }
  if (selected.has('chatgpt')) {
    const tunnelArgs = [
      'tunnel',
      'init',
      ...(options.tunnelId ? ['--tunnel-id', options.tunnelId] : ['--tunnel-id', '<TUNNEL_ID>']),
      '--config',
      configFile,
      '--state',
      state,
    ];
    clients.chatgpt = {
      kind: 'tunnel',
      ...(options.tunnelId ? { tunnelId: options.tunnelId } : {}),
      tunnelInitCommand: forgeBridgeCommand(options.launcher, tunnelArgs),
      instructions: [
        'Create or select a Secure MCP Tunnel in OpenAI Platform and associate it with the target ChatGPT workspace.',
        options.tunnelId
          ? 'Run the generated tunnel init command.'
          : 'Replace <TUNNEL_ID> with the tunnel ID from OpenAI Platform, then run the generated command.',
        'Set CONTROL_PLANE_API_KEY only in the environment, then run tunnel doctor and tunnel run as separate commands.',
        'In ChatGPT Plugins developer mode, choose Tunnel and select the associated tunnel.',
      ],
    };
  }

  const nextSteps = [
    forgeBridgeCommand(options.launcher, ['doctor', '--config', configFile, '--state', state]),
    forgeBridgeCommand(options.launcher, ['browser', 'install']),
  ];
  if (selected.has('chatgpt')) {
    nextSteps.push(
      forgeBridgeCommand(options.launcher, [
        'tunnel',
        'doctor',
        '--config',
        configFile,
        '--state',
        state,
      ]),
      forgeBridgeCommand(options.launcher, [
        'tunnel',
        'run',
        '--config',
        configFile,
        '--state',
        state,
      ]),
    );
  }

  return {
    ok: checks.every((check) => check.status !== 'fail'),
    initialized: true,
    reusedExistingConfig,
    version: 1,
    platform: {
      os: process.platform,
      architecture: process.arch,
      node: process.version,
      nodeSupported: nodeMajor >= 22,
      git,
    },
    root: effectiveRoot,
    state,
    config: configFile,
    device: { id: identity.deviceId, fingerprint: identity.fingerprint },
    policy: {
      mode: reusedExistingConfig ? config.mode : options.mode,
      autonomy:
        config.projectProfiles.find((profile) => pathKey(profile.root) === pathKey(effectiveRoot))
          ?.autonomy ?? 'standard',
    },
    clients,
    checks,
    nextSteps,
  };
}
