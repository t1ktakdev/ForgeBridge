import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { defaultStateDirectory, type ProjectAutonomy } from '../core/config.js';
import { forgeBridgeLauncher } from '../tunnel/client.js';
import {
  performSetup,
  SETUP_CLIENTS,
  type SetupClient,
  type SetupMode,
  type SetupResult,
} from './wizard.js';

type SetupIo = {
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

function parseMode(value: string | undefined): SetupMode {
  const mode = value ?? 'balanced';
  if (mode !== 'ask' && mode !== 'balanced' && mode !== 'full') {
    throw new Error('setup --mode requires ask|balanced|full');
  }
  return mode;
}

function parseAutonomy(value: string | undefined): ProjectAutonomy {
  const autonomy = value ?? 'standard';
  if (autonomy !== 'standard' && autonomy !== 'trusted-local') {
    throw new Error('setup --autonomy requires standard|trusted-local');
  }
  return autonomy;
}

function parseClients(value: string): SetupClient[] {
  const clients = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (clients.length === 0) return ['local'];
  const unique = [...new Set(clients)];
  for (const client of unique) {
    if (!(SETUP_CLIENTS as readonly string[]).includes(client)) {
      throw new Error(`Unsupported setup client: ${client}`);
    }
  }
  return unique as SetupClient[];
}

function clientsFromFlags(args: readonly string[]): SetupClient[] {
  return SETUP_CLIENTS.filter((client) => has(args, `--${client}`));
}

function validateTunnelId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^tunnel_[a-f0-9]{32}$/u.test(value)) {
    throw new Error(
      'setup --tunnel-id expects tunnel_ followed by 32 lowercase hexadecimal characters',
    );
  }
  return value;
}

function renderSetupResult(result: SetupResult): string {
  const lines = [
    'ForgeBridge setup complete.',
    `Project: ${result.root}`,
    `State: ${result.state}`,
    `Config: ${result.config}`,
    `Policy: ${result.policy.mode} / ${result.policy.autonomy}`,
    `Node: ${result.platform.node} (${result.platform.nodeSupported ? 'ok' : 'unsupported'})`,
    `Git: ${result.platform.git.version ?? (result.platform.git.available ? 'available' : 'not found')}`,
  ];

  if (result.reusedExistingConfig) {
    lines.push(
      'Existing ForgeBridge configuration was reused; no policy settings were overwritten.',
    );
  }

  const local = result.clients.local;
  if (local?.command) {
    lines.push('', 'Local stdio command:', local.command);
  }

  const cursor = result.clients.cursor;
  if (cursor?.mcpJson) {
    lines.push('', 'Cursor mcp.json:', JSON.stringify(cursor.mcpJson, null, 2));
  }

  const claude = result.clients.claude;
  if (claude?.command) {
    lines.push('', 'Claude Code command:', claude.command);
  }

  const chatgpt = result.clients.chatgpt;
  if (chatgpt?.tunnelInitCommand) {
    lines.push('', 'ChatGPT Secure MCP Tunnel init:', chatgpt.tunnelInitCommand);
    for (const instruction of chatgpt.instructions ?? []) lines.push(`  - ${instruction}`);
  }

  lines.push('', 'Next checks:');
  for (const step of result.nextSteps) lines.push(`  ${step}`);
  return lines.join('\n');
}

export async function runSetupCommand(
  args: readonly string[],
  io: SetupIo,
  cliEntry: string,
): Promise<number> {
  const nonInteractive = has(args, '--non-interactive');
  let root = option(args, '--root');
  let modeValue = option(args, '--mode');
  let autonomyValue = option(args, '--autonomy');
  let clients = clientsFromFlags(args);
  let tunnelId = option(args, '--tunnel-id');

  if (!nonInteractive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(
        'Interactive setup requires a TTY. Use --non-interactive for scripted setup.',
      );
    }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!root) {
        const answer = (await prompt.question(`Project root [${process.cwd()}]: `)).trim();
        root = answer || process.cwd();
      }
      if (!modeValue) {
        const answer = (
          await prompt.question('Security mode ask|balanced|full [balanced]: ')
        ).trim();
        modeValue = answer || 'balanced';
      }
      if (!autonomyValue) {
        const answer = (
          await prompt.question('Project autonomy standard|trusted-local [standard]: ')
        ).trim();
        autonomyValue = answer || 'standard';
      }
      if (clients.length === 0) {
        const answer = (
          await prompt.question('Clients local,chatgpt,cursor,claude [local]: ')
        ).trim();
        clients = parseClients(answer || 'local');
      }
      if (clients.includes('chatgpt') && !tunnelId) {
        const answer = (
          await prompt.question('OpenAI tunnel ID [leave blank to configure later]: ')
        ).trim();
        tunnelId = answer || undefined;
      }
    } finally {
      prompt.close();
    }
  }

  root = path.resolve(root ?? process.cwd());
  const mode = parseMode(modeValue);
  const autonomy = parseAutonomy(autonomyValue);
  if (clients.length === 0) clients = ['local'];
  tunnelId = validateTunnelId(tunnelId);

  const state = path.resolve(option(args, '--state') ?? defaultStateDirectory());
  const configFile = path.resolve(option(args, '--config') ?? path.join(state, 'config.json'));
  const launcher = forgeBridgeLauncher(
    cliEntry,
    process.execPath,
    cliEntry.endsWith('.js') ? undefined : fileURLToPath(import.meta.resolve('tsx/cli')),
  );

  const result = await performSetup({
    root,
    state,
    configFile,
    launcher,
    clients,
    mode,
    autonomy,
    force: has(args, '--force'),
    ...(tunnelId ? { tunnelId } : {}),
  });

  io.stdout(nonInteractive ? JSON.stringify(result, null, 2) : renderSetupResult(result));
  if (!result.ok) {
    io.stderr(
      'Setup completed with failed environment checks. Run forgebridge doctor for details.',
    );
  }
  return result.ok ? 0 : 1;
}
