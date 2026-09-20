import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  forgeBridgeLauncher,
  forgeBridgeStdioCommand,
  quoteCommandArgument,
  runTunnelClient,
  tunnelClientArguments,
} from '../../src/tunnel/client.js';

// Independent transcription of the official client grammar (pkg/runtimeconfig/config.go,
// parseCommandArgv, checked 2026-09-14). This is not the Windows CRT/shell grammar.
// Empty quoted arguments are dropped upstream, so the encoder rejects them.
function parseTunnelCommand(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const ch of input.trim()) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = '';
      else current += ch;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = '';
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (' \t\r\n'.includes(ch)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else current += ch;
  }
  if (quote || escaped) throw new Error('Unterminated tunnel command');
  if (current) args.push(current);
  return args;
}

describe('tunnel client integration', () => {
  it.each([
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Forge Bridge\\state\\',
    'C:\\no-spaces\\config.json',
    'C:/Forge Bridge/проект/config.json',
    'a"quote',
    "user's project",
    'back\\slash"quote',
  ])('round trips argument %s through the upstream grammar', (value) => {
    expect(parseTunnelCommand(quoteCommandArgument(value, 'win32'))).toEqual([value]);
    expect(parseTunnelCommand(quoteCommandArgument(value, 'linux'))).toEqual([value]);
  });

  it.each(['', 'line\nfeed', 'carriage\rreturn', 'nul\0byte'])(
    'rejects unrepresentable argument %j',
    (value) => {
      expect(() => quoteCommandArgument(value)).toThrow('single-line');
    },
  );

  it.each(['packaged', 'development'])(
    'preserves the %s CLI argv including spaced paths',
    (mode) => {
      const cli =
        mode === 'packaged' ? 'C:\\Forge Bridge\\dist\\cli.js' : 'C:\\Forge Bridge\\src\\cli.ts';
      const launcher = forgeBridgeLauncher(
        cli,
        'C:\\Program Files\\nodejs\\node.exe',
        mode === 'development' ? 'C:\\Forge Bridge\\node_modules\\tsx\\dist\\cli.mjs' : undefined,
      );
      const config = 'C:\\Forge Bridge\\config.json';
      const state = "C:\\user's project\\state";
      expect(parseTunnelCommand(forgeBridgeStdioCommand(config, state, launcher))).toEqual([
        ...launcher,
        'serve',
        '--transport',
        'stdio',
        '--config',
        config,
        '--state',
        state,
      ]);
      expect(launcher[0]).toBe('C:\\Program Files\\nodejs\\node.exe');
    },
  );

  it('delivers parsed arguments to a real native Node process without a shell', async () => {
    const values = ['C:\\space directory\\config.json', "C:\\user's project\\state", 'a"b\\c'];
    const command = [
      process.execPath,
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      ...values,
    ]
      .map((value) => quoteCommandArgument(value))
      .join(' ');
    const [executable, ...args] = parseTunnelCommand(command);
    if (!executable) throw new Error('Missing executable');
    const result = await promisify(execFile)(executable, args, { windowsHide: true });
    expect(JSON.parse(result.stdout)).toEqual(values);
  });

  it('generates an isolated profile with ephemeral loopback health binding', () => {
    const args = tunnelClientArguments({
      operation: 'init',
      profile: 'safe',
      tunnelId: 'tunnel_00000000000000000000000000000000',
      mcpCommand: 'forgebridge serve --transport stdio',
      profileDirectory: 'C:\\space dir\\profiles',
    });
    expect(args).toContain('--health-listen-addr');
    expect(args[args.indexOf('--health-listen-addr') + 1]).toBe('127.0.0.1:0');
    expect(args.slice(-2)).toEqual(['--profile-dir', 'C:\\space dir\\profiles']);
    expect(args.join(' ')).not.toContain('CONTROL_PLANE_API_KEY');
    expect(tunnelClientArguments({ operation: 'doctor', profile: 'safe', explain: true })).toEqual([
      'doctor',
      '--profile',
      'safe',
      '--explain',
    ]);
    expect(() => tunnelClientArguments({ operation: 'run', profile: '../escape' })).toThrow(
      'Tunnel profile',
    );
    expect(() =>
      tunnelClientArguments({
        operation: 'init',
        profile: 'safe',
        tunnelId: 'bad',
        mcpCommand: 'node',
      }),
    ).toThrow('32 lowercase hexadecimal');
    expect(() =>
      tunnelClientArguments({
        operation: 'init',
        profile: 'safe',
        tunnelId: `tunnel_${'g'.repeat(32)}`,
        mcpCommand: 'node',
      }),
    ).toThrow('hexadecimal');
    expect(() => forgeBridgeLauncher('src/cli.ts', process.execPath)).toThrow('tsx');
  });

  it('requires the runtime key for run, but init can reach the client without credentials', async () => {
    const previous = process.env['CONTROL_PLANE_API_KEY'];
    delete process.env['CONTROL_PLANE_API_KEY'];
    try {
      await expect(runTunnelClient('missing-forgebridge-client', ['run'])).rejects.toMatchObject({
        code: 'missing_tunnel_runtime_key',
      });
      await expect(runTunnelClient('missing-forgebridge-client', ['init'])).rejects.toMatchObject({
        code: 'tunnel_client_not_found',
      });
    } finally {
      if (previous === undefined) delete process.env['CONTROL_PLANE_API_KEY'];
      else process.env['CONTROL_PLANE_API_KEY'] = previous;
    }
  });
});
