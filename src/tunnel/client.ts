import { spawn } from 'node:child_process';
import os from 'node:os';
import { ForgeBridgeError } from '../core/errors.js';
import { filteredEnvironment } from '../terminal/environment.js';

const TUNNEL_ID_PATTERN = /^tunnel_[a-f0-9]{32}$/u;
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export type TunnelOperation = 'init' | 'doctor' | 'run';

export type TunnelClientOptions = {
  operation: TunnelOperation;
  profile: string;
  tunnelId?: string;
  mcpCommand?: string;
  explain?: boolean;
  profileDirectory?: string;
};

/** Encode the official tunnel-client argv grammar, not a Windows shell command. */
export function quoteCommandArgument(value: string, _platform = process.platform): string {
  if (!value || /[\0\r\n]/u.test(value)) {
    throw new ForgeBridgeError(
      'invalid_tunnel_argument',
      'Tunnel arguments must be nonempty and single-line',
      { platform: _platform },
    );
  }
  if (!/[\s"'\\]/u.test(value)) return value;
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function forgeBridgeLauncher(
  cliEntry: string,
  nodeExecutable: string,
  tsxEntry?: string,
): string[] {
  if (cliEntry.endsWith('.js')) return [nodeExecutable, cliEntry];
  if (!tsxEntry)
    throw new ForgeBridgeError(
      'missing_development_launcher',
      'Development CLI requires the installed tsx CLI entry',
    );
  return [nodeExecutable, tsxEntry, cliEntry];
}

export function forgeBridgeStdioCommand(
  configFile: string,
  stateDirectory: string,
  launcher: readonly string[] = ['forgebridge'],
): string {
  return [
    ...launcher.map((argument) => quoteCommandArgument(argument)),
    'serve',
    '--transport',
    'stdio',
    '--config',
    quoteCommandArgument(configFile),
    '--state',
    quoteCommandArgument(stateDirectory),
  ].join(' ');
}

export function tunnelClientArguments(options: TunnelClientOptions): string[] {
  if (!PROFILE_PATTERN.test(options.profile)) {
    throw new ForgeBridgeError(
      'invalid_tunnel_profile',
      'Tunnel profile must use only letters, numbers, dot, underscore, or hyphen',
    );
  }
  if (options.operation === 'init') {
    if (!options.tunnelId || !TUNNEL_ID_PATTERN.test(options.tunnelId)) {
      throw new ForgeBridgeError(
        'invalid_tunnel_id',
        'Expected tunnel_ followed by exactly 32 lowercase hexadecimal characters',
      );
    }
    if (!options.mcpCommand) {
      throw new ForgeBridgeError('missing_mcp_command', 'A local MCP command is required');
    }
    return [
      'init',
      '--sample',
      'sample_mcp_stdio_local',
      '--profile',
      options.profile,
      '--tunnel-id',
      options.tunnelId,
      '--mcp-command',
      options.mcpCommand,
      '--health-listen-addr',
      '127.0.0.1:0',
      ...(options.profileDirectory ? ['--profile-dir', options.profileDirectory] : []),
    ];
  }
  return [
    options.operation,
    '--profile',
    options.profile,
    ...(options.profileDirectory ? ['--profile-dir', options.profileDirectory] : []),
    ...(options.operation === 'doctor' && options.explain ? ['--explain'] : []),
  ];
}

export async function runTunnelClient(
  executable: string,
  argumentsValue: readonly string[],
): Promise<number> {
  const runtimeKey = process.env['CONTROL_PLANE_API_KEY'];
  if (!runtimeKey && argumentsValue[0] !== 'init') {
    throw new ForgeBridgeError(
      'missing_tunnel_runtime_key',
      'Set CONTROL_PLANE_API_KEY to an OpenAI tunnel runtime key with Tunnels Read + Use',
    );
  }
  return new Promise<number>((resolve, reject) => {
    const child = spawn(executable, [...argumentsValue], {
      cwd: os.tmpdir(),
      env: {
        ...filteredEnvironment(),
        ...(runtimeKey ? { CONTROL_PLANE_API_KEY: runtimeKey } : {}),
      },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      reject(
        new ForgeBridgeError(
          code === 'ENOENT' ? 'tunnel_client_not_found' : 'tunnel_client_failed',
          code === 'ENOENT'
            ? `Could not find ${executable}; install the official OpenAI tunnel-client first`
            : error.message,
        ),
      );
    });
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1)));
  });
}
