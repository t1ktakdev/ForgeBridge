import { realpath, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig, loadConfig, saveConfig } from '../../src/core/config.js';
import type { AuthorizationRequest } from '../../src/policy/types.js';

async function eventually(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for restart fixture');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('agent restart', () => {
  let agent: ForgeBridgeAgent | undefined;

  afterEach(async () => {
    await agent?.close({ cancelJobs: true });
  });

  it('restores durable state and discards session-only grants', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'forgebridge-restart-root-')));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-restart-state-'));
    const configFile = path.join(state, 'config.json');
    const config = defaultConfig(root);
    config.mode = 'ask';
    config.roots[0]?.capabilities.push('git.push');
    agent = await ForgeBridgeAgent.create(config, state);
    const identity = agent.identity;

    const temporaryRequest: AuthorizationRequest = {
      actorId: 'restart-actor',
      sessionId: 'restart-session',
      capability: 'git.push',
      operation: 'push',
      scope: { kind: 'repository', value: root },
      arguments: { repository: root, remote: 'origin' },
    };
    const temporaryApproval = await agent.permissions.authorize(temporaryRequest);
    if (temporaryApproval.outcome !== 'approval_required') {
      throw new Error('Expected temporary approval request');
    }
    await agent.approvals.respond(temporaryApproval.approval.id, 'temporary', 60_000, 1);
    expect(
      (await agent.permissions.authorize(temporaryRequest, temporaryApproval.approval.id)).outcome,
    ).toBe('allow');

    const sessionRequest: AuthorizationRequest = {
      actorId: 'restart-actor',
      sessionId: 'restart-session',
      capability: 'terminal.execute',
      operation: 'run',
      scope: { kind: 'path', value: root },
      arguments: { command: 'node --version', workingDirectory: root },
    };
    const sessionApproval = await agent.permissions.authorize(sessionRequest);
    if (sessionApproval.outcome !== 'approval_required') {
      throw new Error('Expected session approval request');
    }
    await agent.approvals.respond(sessionApproval.approval.id, 'session', undefined, 10);
    expect(
      (await agent.permissions.authorize(sessionRequest, sessionApproval.approval.id)).outcome,
    ).toBe('allow');

    await agent.setProjectMode(root, 'balanced');
    agent.config.execution.profile = 'gaming';
    await saveConfig(configFile, agent.config);
    const job = await agent.jobs.start({
      command: 'node -e "console.log(\'restart-job-ok\')"',
      workingDirectory: root,
    });
    await eventually(() => agent?.jobs.status(job.id).status === 'succeeded');
    await agent.audit.append({
      correlationId: 'restart-correlation',
      actorId: 'restart-actor',
      sessionId: 'restart-session',
      tool: 'restart_fixture',
      operation: 'persist',
      capability: 'system.inspect',
      scope: { kind: 'device', value: identity.deviceId },
      decision: 'allow',
      ruleId: 'restart-test',
      result: 'succeeded',
    });

    await agent.close();
    agent = undefined;

    const restoredConfig = await loadConfig(configFile);
    agent = await ForgeBridgeAgent.create(restoredConfig, state);
    expect(agent.identity).toMatchObject({
      deviceId: identity.deviceId,
      fingerprint: identity.fingerprint,
    });
    expect(agent.status()).toMatchObject({
      mode: 'ask',
      execution: { profile: 'gaming' },
      projectProfiles: [{ root, mode: 'balanced', rules: [] }],
    });
    expect(agent.jobs.status(job.id).status).toBe('succeeded');
    expect((await agent.jobs.logs(job.id)).data).toContain('restart-job-ok');
    expect((await agent.audit.list()).entries).toEqual([
      expect.objectContaining({ correlationId: 'restart-correlation', sequence: 1 }),
    ]);
    expect(agent.permissions.listGrants()).toEqual([
      expect.objectContaining({ id: temporaryApproval.approval.id, kind: 'temporary', uses: 0 }),
    ]);
    expect(
      (
        await agent.permissions.authorize({
          ...temporaryRequest,
          operation: 'push-after-restart',
        })
      ).outcome,
    ).toBe('allow');
    expect(
      (
        await agent.permissions.authorize({
          ...temporaryRequest,
          operation: 'push-after-use-limit',
        })
      ).outcome,
    ).toBe('approval_required');
  });
});
