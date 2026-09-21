import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import type { Capability } from '../../src/policy/types.js';

let agent: ForgeBridgeAgent | undefined;
let temporary: string | undefined;
afterEach(async () => {
  await agent?.close({ cancelJobs: true });
  agent = undefined;
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});
async function fixture() {
  temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'forgebridge-policy-alias-')));
  const root = path.join(temporary, 'root');
  const outside = path.join(temporary, 'outside');
  const alias = path.join(temporary, 'alias');
  await mkdir(root);
  await mkdir(outside);
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const config = defaultConfig(alias);
  config.mode = 'full';
  config.projectProfiles = [{ root: alias, mode: 'ask', rules: [] }];
  config.rules = [
    {
      id: 'blocked-write',
      capability: 'filesystem.write',
      effect: 'deny',
      scope: { kind: 'path', value: path.join(alias, 'blocked') },
    },
  ];
  agent = await ForgeBridgeAgent.create(config, path.join(temporary, 'state'));
  return { root, outside, alias, agent };
}
function request(value: string, capability: Capability = 'filesystem.write') {
  return {
    actorId: 'alias-test',
    sessionId: 'test',
    capability,
    operation: 'create',
    scope: { kind: 'path' as const, value },
    arguments: { path: value },
  };
}

describe('canonical policy scopes', () => {
  it('matches aliases consistently while retaining profile asks and explicit denies', async () => {
    const { agent, root, outside, alias } = await fixture();
    const resolved = await agent.files.guard.resolve(path.join(alias, 'new.txt'));
    expect(
      (await agent.permissions.authorize(request(resolved.canonical, 'filesystem.read'))).outcome,
    ).toBe('allow');
    expect((await agent.permissions.authorize(request(resolved.canonical))).outcome).toBe(
      'approval_required',
    );
    const denied = await agent.permissions.authorize(
      request(path.join(root, 'blocked', 'future.txt')),
    );
    expect(denied).toMatchObject({ outcome: 'deny', decision: { ruleId: 'blocked-write' } });
    expect(
      (await agent.permissions.authorize(request(path.join(outside, 'file.txt')))).outcome,
    ).toBe('deny');
    await agent.setProjectAutonomy(alias, 'trusted-local');
    await agent.setProjectMode(alias, 'balanced');
    expect(agent.config.projectProfiles).toEqual([
      { root, mode: 'balanced', autonomy: 'trusted-local', rules: [] },
    ]);
  });

  it('does not broaden roots when an alias is retargeted after initialization', async () => {
    const { agent, root, outside, alias } = await fixture();
    await rm(alias);
    await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(agent.files.guard.resolve(path.join(alias, 'new.txt'))).rejects.toMatchObject({
      code: 'path_outside_roots',
    });
    expect(
      (await agent.permissions.authorize(request(path.join(outside, 'new.txt'), 'filesystem.read')))
        .outcome,
    ).toBe('deny');
    expect(agent.config.roots[0]?.path).toBe(root);
  });
});
