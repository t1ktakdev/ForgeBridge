import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config.js';
import { Redactor } from '../../src/core/redactor.js';
import { ApprovalStore } from '../../src/policy/approvals.js';
import { PermissionEngine } from '../../src/policy/engine.js';
import type { AuthorizationRequest } from '../../src/policy/types.js';

describe('PermissionEngine', () => {
  let root: string;
  let store: ApprovalStore;
  let request: AuthorizationRequest;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-policy-'));
    store = new ApprovalStore(root, 60_000);
    await store.initialize();
    request = {
      actorId: 'actor',
      sessionId: 'session',
      capability: 'filesystem.delete',
      operation: 'delete',
      scope: { kind: 'path', value: path.join(root, 'file.txt') },
      arguments: { path: path.join(root, 'file.txt') },
    };
  });

  it('allows reads, allows ordinary writes, and asks for deletes in balanced mode', async () => {
    const engine = new PermissionEngine(defaultConfig(root), store, new Redactor());
    const read = await engine.authorize({
      ...request,
      capability: 'filesystem.read',
      operation: 'read',
    });
    const write = await engine.authorize({
      ...request,
      capability: 'filesystem.write',
      operation: 'patch',
    });
    const remove = await engine.authorize(request);
    const windowsRead = await engine.authorize({
      ...request,
      capability: 'windows.read',
      operation: 'snapshot',
      scope: { kind: 'device', value: 'device' },
    });
    const windowsInteract = await engine.authorize({
      ...request,
      capability: 'windows.interact',
      operation: 'invoke',
      scope: { kind: 'device', value: 'device' },
    });
    expect(read.outcome).toBe('allow');
    expect(write.outcome).toBe('allow');
    expect(remove.outcome).toBe('approval_required');
    expect(windowsRead.outcome).toBe('allow');
    expect(windowsInteract.outcome).toBe('approval_required');
  });

  it('implements ASK and FULL defaults without bypassing consequential actions', async () => {
    const askConfig = defaultConfig(root);
    askConfig.mode = 'ask';
    const askEngine = new PermissionEngine(askConfig, store, new Redactor());
    expect(
      (
        await askEngine.authorize({
          ...request,
          capability: 'filesystem.write',
          operation: 'write',
        })
      ).outcome,
    ).toBe('approval_required');

    const fullConfig = defaultConfig(root);
    fullConfig.mode = 'full';
    const fullEngine = new PermissionEngine(fullConfig, store, new Redactor());
    expect((await fullEngine.authorize(request)).outcome).toBe('allow');
    const submit = await fullEngine.authorize({
      ...request,
      capability: 'browser.submit',
      scope: { kind: 'origin', value: 'https://example.test' },
    });
    expect(submit.outcome).toBe('approval_required');
    if (submit.outcome !== 'approval_required') throw new Error('Expected approval');
    expect(submit.approval.allowedResponses).toEqual(['deny', 'once']);
    await expect(store.respond(submit.approval.id, 'session')).rejects.toThrow(
      'is not allowed for this action',
    );
    const windowsInteract = await fullEngine.authorize({
      ...request,
      capability: 'windows.interact',
      operation: 'invoke',
      scope: { kind: 'device', value: 'device' },
    });
    const windowsSubmit = await fullEngine.authorize({
      ...request,
      capability: 'windows.submit',
      operation: 'invoke',
      scope: { kind: 'device', value: 'device' },
    });
    expect(windowsInteract.outcome).toBe('allow');
    expect(windowsSubmit.outcome).toBe('approval_required');
    if (windowsSubmit.outcome !== 'approval_required') throw new Error('Expected approval');
    expect(windowsSubmit.approval.allowedResponses).toEqual(['deny', 'once']);
  });

  it('allows reviewed repository code only in an explicitly trusted-local project', async () => {
    const config = defaultConfig(root);
    config.mode = 'full';
    const engine = new PermissionEngine(config, store, new Redactor());
    const repositoryCode: AuthorizationRequest = {
      ...request,
      capability: 'terminal.execute',
      operation: 'check',
      scope: { kind: 'path', value: root },
      arguments: { command: 'pnpm test' },
      flags: ['repository-code'],
    };

    expect((await engine.authorize(repositoryCode)).outcome).toBe('approval_required');

    config.projectProfiles.push({
      root,
      mode: 'full',
      autonomy: 'trusted-local',
      rules: [],
    });
    const trusted = new PermissionEngine(config, store, new Redactor());
    expect((await trusted.authorize(repositoryCode)).outcome).toBe('allow');
    expect(trusted.effectivePolicy(repositoryCode.scope)).toMatchObject({
      effectiveMode: 'full',
      autonomy: 'trusted-local',
      profileRoot: root,
    });

    const destructive = await trusted.authorize({
      ...repositoryCode,
      operation: 'destructive-check',
      flags: ['repository-code', 'destructive'],
    });
    expect(destructive.outcome).toBe('approval_required');
  });
  it('allows git push only through an exact or temporary approval', async () => {
    const config = defaultConfig(root);
    config.mode = 'full';
    config.roots[0]?.capabilities.push('git.push');
    const engine = new PermissionEngine(config, store, new Redactor());
    const pushRequest: AuthorizationRequest = {
      ...request,
      capability: 'git.push',
      operation: 'push',
      scope: { kind: 'repository', value: root },
    };
    const first = await engine.authorize(pushRequest);
    if (first.outcome !== 'approval_required') throw new Error('Expected approval');
    expect(first.approval.allowedResponses).toEqual(['deny', 'once', 'temporary']);
    await store.respond(first.approval.id, 'temporary', 60_000, 2);
    expect((await engine.authorize(pushRequest, first.approval.id)).outcome).toBe('allow');
    expect((await engine.authorize({ ...pushRequest, operation: 'push-again' })).outcome).toBe(
      'allow',
    );
  });

  it('uses the most specific persisted project mode and project denies', async () => {
    const nested = path.join(root, 'nested');
    const config = defaultConfig(root);
    config.mode = 'full';
    config.projectProfiles.push({
      root: nested,
      mode: 'ask',
      rules: [
        {
          id: 'project-no-write',
          capability: 'filesystem.write',
          effect: 'deny',
        },
      ],
    });
    const engine = new PermissionEngine(config, store, new Redactor());
    const nestedRequest = {
      ...request,
      scope: { kind: 'path' as const, value: path.join(nested, 'file.txt') },
    };
    const denied = await engine.authorize({
      ...nestedRequest,
      capability: 'filesystem.write',
    });
    expect(denied.outcome).toBe('deny');
    expect(denied.decision.ruleId).toBe('project-no-write');
    const asks = await engine.authorize(nestedRequest);
    expect(asks.outcome).toBe('approval_required');
    expect(asks.decision.ruleId).toContain('project:');
    expect((await engine.authorize(request)).outcome).toBe('allow');
  });

  it('never lets explicit allow override a hard deny', async () => {
    const config = defaultConfig(root);
    config.roots[0]?.capabilities.push('secrets.read');
    config.rules.push({ id: 'unsafe-test', capability: 'secrets.read', effect: 'allow' });
    const engine = new PermissionEngine(config, store, new Redactor());
    const result = await engine.authorize({ ...request, capability: 'secrets.read' });
    expect(result.outcome).toBe('deny');
    expect(result.decision.ruleId).toBe('hard-deny');
  });

  it('binds a one-time approval to the exact action and caller', async () => {
    const engine = new PermissionEngine(defaultConfig(root), store, new Redactor());
    const first = await engine.authorize(request);
    expect(first.outcome).toBe('approval_required');
    if (first.outcome !== 'approval_required') throw new Error('Expected approval');
    await store.respond(first.approval.id, 'once');

    const changed = await engine.authorize(
      { ...request, arguments: { path: path.join(root, 'other.txt') } },
      first.approval.id,
    );
    expect(changed.outcome).toBe('approval_required');

    const approved = await engine.authorize(request, first.approval.id);
    expect(approved.outcome).toBe('allow');
    const replayed = await engine.authorize(request, first.approval.id);
    expect(replayed.outcome).toBe('approval_required');
  });

  it('limits session grants to the approving session', async () => {
    const engine = new PermissionEngine(defaultConfig(root), store, new Redactor());
    const first = await engine.authorize(request);
    if (first.outcome !== 'approval_required') throw new Error('Expected approval');
    await store.respond(first.approval.id, 'session');
    expect((await engine.authorize(request, first.approval.id)).outcome).toBe('allow');

    const changedAction = { ...request, operation: 'delete-after-review' };
    const sameSession = await engine.authorize(changedAction);
    expect(sameSession.outcome).toBe('allow');
    const otherSession = await engine.authorize({ ...changedAction, sessionId: 'other-session' });
    expect(otherSession.outcome).toBe('approval_required');

    engine.clearSession(request.sessionId);
    expect((await engine.authorize(changedAction)).outcome).toBe('approval_required');
  });

  it('restores unexpired temporary grants and persists their revocation', async () => {
    const config = defaultConfig(root);
    const engine = new PermissionEngine(config, store, new Redactor());
    const first = await engine.authorize(request);
    if (first.outcome !== 'approval_required') throw new Error('Expected approval');
    await store.respond(first.approval.id, 'temporary', 60_000);
    expect((await engine.authorize(request, first.approval.id)).outcome).toBe('allow');

    const reloadedStore = new ApprovalStore(root, 60_000);
    await reloadedStore.initialize();
    const restored = new PermissionEngine(config, reloadedStore, new Redactor());
    expect(
      (await restored.authorize({ ...request, operation: 'delete-after-restart' })).outcome,
    ).toBe('allow');
    expect(restored.listGrants()).toHaveLength(1);

    expect(await restored.revokeGrant(first.approval.id)).toBe(true);
    const finalStore = new ApprovalStore(root, 60_000);
    await finalStore.initialize();
    const afterRevoke = new PermissionEngine(config, finalStore, new Redactor());
    expect(afterRevoke.listGrants()).toHaveLength(0);
    expect(
      (await afterRevoke.authorize({ ...request, operation: 'delete-after-revoke' })).outcome,
    ).toBe('approval_required');
  });

  it('expires a grant after its persisted maximum use count', async () => {
    const config = defaultConfig(root);
    const engine = new PermissionEngine(config, store, new Redactor());
    const first = await engine.authorize(request);
    if (first.outcome !== 'approval_required') throw new Error('Expected approval');
    await store.respond(first.approval.id, 'temporary', 60_000, 1);
    expect((await engine.authorize(request, first.approval.id)).outcome).toBe('allow');
    expect((await engine.authorize({ ...request, operation: 'only-granted-use' })).outcome).toBe(
      'allow',
    );
    expect((await engine.authorize({ ...request, operation: 'after-use-limit' })).outcome).toBe(
      'approval_required',
    );

    const reloadedStore = new ApprovalStore(root, 60_000);
    await reloadedStore.initialize();
    expect(new PermissionEngine(config, reloadedStore, new Redactor()).listGrants()).toHaveLength(
      0,
    );
  });

  it('applies explicit deny before explicit allow', async () => {
    const config = defaultConfig(root);
    config.rules.push(
      { id: 'allow-delete', capability: 'filesystem.delete', effect: 'allow' },
      {
        id: 'deny-project-delete',
        capability: 'filesystem.delete',
        effect: 'deny',
        scope: { kind: 'path', value: root },
      },
    );
    const engine = new PermissionEngine(config, store, new Redactor());
    const result = await engine.authorize(request);
    expect(result.outcome).toBe('deny');
    expect(result.decision.ruleId).toBe('deny-project-delete');
  });

  it('denies a scoped capability outside configured roots', async () => {
    const engine = new PermissionEngine(defaultConfig(root), store, new Redactor());
    const result = await engine.authorize({
      ...request,
      capability: 'filesystem.read',
      scope: { kind: 'path', value: path.resolve(root, '..', 'outside.txt') },
    });
    expect(result.outcome).toBe('deny');
    expect(result.decision.ruleId).toBe('scope-deny');
  });
});
