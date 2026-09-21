import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { loadConfig } from '../../src/core/config.js';
import {
  buildStdioClientDefinition,
  claudeCodeCommand,
  commandLine,
  performSetup,
} from '../../src/setup/wizard.js';

const temporaryDirectories: string[] = [];

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-setup-'));
  temporaryDirectories.push(base);
  const root = path.join(base, 'Project With Spaces');
  const otherRoot = path.join(base, 'Other Project');
  const state = path.join(base, 'State With Spaces');
  await mkdir(root);
  await mkdir(otherRoot);
  return { base, root, otherRoot, state, config: path.join(state, 'config.json') };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('forgebridge setup wizard', () => {
  it('generates executable Windows PowerShell commands for paths with spaces', () => {
    const definition = buildStdioClientDefinition(
      ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\ForgeBridge\\dist\\cli.js'],
      'C:\\Users\\Test User\\AppData\\Local\\ForgeBridge\\config.json',
      'C:\\Users\\Test User\\AppData\\Local\\ForgeBridge',
    );

    const local = commandLine(definition.command, definition.args, 'win32');
    expect(local).toMatch(/^& 'C:\\Program Files\\nodejs\\node\.exe'/u);
    expect(local).toContain("'C:\\Program Files\\ForgeBridge\\dist\\cli.js'");
    expect(local).toContain("'--transport' 'stdio'");

    const claude = claudeCodeCommand(definition, 'win32');
    expect(claude).toMatch(/^& 'claude' 'mcp' 'add' '--transport' 'stdio'/u);
    expect(claude).toContain("'--' 'C:\\Program Files\\nodejs\\node.exe'");
  });

  it('creates a safe config and client plans without exposing a local token', async () => {
    const { root, state, config } = await fixture();
    const tunnelId = 'tunnel_0123456789abcdef0123456789abcdef';

    const result = await performSetup({
      root,
      state,
      configFile: config,
      launcher: ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Forge Bridge\\dist\\cli.js'],
      clients: ['local', 'cursor', 'claude', 'chatgpt'],
      mode: 'full',
      autonomy: 'trusted-local',
      tunnelId,
    });

    expect(result.ok).toBe(true);
    expect(result.reusedExistingConfig).toBe(false);
    expect(result.root).toBe(path.resolve(root));
    expect(result.policy).toEqual({ mode: 'full', autonomy: 'trusted-local' });
    expect(result.device.id).toBeTruthy();
    expect(result.device.fingerprint).toBeTruthy();
    expect(JSON.stringify(result)).not.toMatch(
      /localToken|bearer|CONTROL_PLANE_API_KEY.+(?:sk-|sess-)/iu,
    );

    expect(result.clients.cursor?.mcpJson?.mcpServers.forgebridge).toMatchObject({
      type: 'stdio',
      command: 'C:\\Program Files\\nodejs\\node.exe',
    });
    expect(result.clients.claude?.command).toContain('forgebridge');
    expect(result.clients.chatgpt).toMatchObject({ kind: 'tunnel', tunnelId });
    expect(result.clients.chatgpt?.tunnelInitCommand).toContain(tunnelId);

    const saved = await loadConfig(config);
    expect(saved.mode).toBe('full');
    expect(saved.projectProfiles).toContainEqual({
      root: path.resolve(root),
      mode: 'full',
      autonomy: 'trusted-local',
      rules: [],
    });
  });

  it('reuses an existing config without silently replacing its root or policy', async () => {
    const { root, otherRoot, state, config } = await fixture();

    const first = await performSetup({
      root,
      state,
      configFile: config,
      launcher: ['forgebridge'],
      clients: ['local'],
      mode: 'full',
      autonomy: 'trusted-local',
    });
    expect(first.ok).toBe(true);

    const second = await performSetup({
      root: otherRoot,
      state,
      configFile: config,
      launcher: ['forgebridge'],
      clients: ['cursor'],
      mode: 'ask',
      autonomy: 'standard',
    });

    expect(second.reusedExistingConfig).toBe(true);
    expect(second.root).toBe(path.resolve(root));
    expect(second.policy).toEqual({ mode: 'full', autonomy: 'trusted-local' });
    expect(second.clients.cursor?.mcpJson).toBeDefined();

    const saved = await loadConfig(config);
    expect(saved.mode).toBe('full');
    expect(saved.projectProfiles).toHaveLength(1);
    expect(saved.projectProfiles[0]).toMatchObject({
      root: path.resolve(root),
      mode: 'full',
      autonomy: 'trusted-local',
    });
  });

  it('supports a machine-readable non-interactive CLI setup', async () => {
    const { root, state } = await fixture();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(
      [
        'setup',
        '--non-interactive',
        '--root',
        root,
        '--state',
        state,
        '--cursor',
        '--claude',
        '--mode',
        'balanced',
        '--autonomy',
        'standard',
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const result = JSON.parse(stdout.at(-1) ?? '{}') as {
      ok?: boolean;
      clients?: Record<string, unknown>;
      policy?: { mode?: string; autonomy?: string };
    };
    expect(result).toMatchObject({
      ok: true,
      policy: { mode: 'balanced', autonomy: 'standard' },
    });
    expect(result.clients).toHaveProperty('cursor');
    expect(result.clients).toHaveProperty('claude');
  });
});
