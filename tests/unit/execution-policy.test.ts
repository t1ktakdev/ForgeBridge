import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config.js';
import { ForegroundActionQueue } from '../../src/execution/foreground-queue.js';
import { ExecutionPolicy, ResourceGovernor } from '../../src/execution/policy.js';
import { WindowsUiAutomation } from '../../src/windows/uia.js';

describe('background execution policy', () => {
  it('defaults to background-safe behavior and applies conservative gaming limits', () => {
    const config = defaultConfig(process.cwd());
    const policy = new ExecutionPolicy(config.execution);

    expect(policy.current()).toMatchObject({
      profile: 'background',
      backgroundMode: true,
      foregroundAllowed: false,
      forceHeadlessBrowser: true,
      maxParallelJobs: 4,
    });

    policy.setProfile('gaming');
    expect(policy.current()).toMatchObject({
      profile: 'gaming',
      backgroundMode: true,
      foregroundAllowed: false,
      forceHeadlessBrowser: true,
      maxParallelJobs: 1,
      maxBrowserInstances: 1,
      processPriority: 'below_normal',
    });

    policy.setBackgroundMode(false);
    expect(policy.current()).toMatchObject({
      profile: 'normal',
      backgroundMode: false,
      foregroundAllowed: true,
    });
  });

  it('enforces the current CPU concurrency limit without leaking slots', () => {
    const config = defaultConfig(process.cwd());
    config.execution.maxCpuConcurrency = 1;
    const governor = new ResourceGovernor(new ExecutionPolicy(config.execution));
    const release = governor.acquireCpuSlot();
    expect(() => governor.acquireCpuSlot()).toThrow('at most 1 concurrent process tasks');
    release();
    expect(() => governor.acquireCpuSlot()).not.toThrow();
  });

  it('persists foreground actions and defers focus before invoking Windows UIA', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-foreground-'));
    const config = defaultConfig(state);
    const policy = new ExecutionPolicy(config.execution);
    const queue = new ForegroundActionQueue(state);
    await queue.initialize();
    const automation = new WindowsUiAutomation({
      enabled: true,
      executionPolicy: policy,
      foregroundQueue: queue,
    });

    await expect(
      automation.act(
        { windowTitle: 'Harmless fixture' },
        { by: 'automationId', value: 'editor' },
        'focus',
      ),
    ).rejects.toMatchObject({ code: 'foreground_required' });

    const [pending] = queue.list(['pending']);
    expect(pending).toMatchObject({
      kind: 'windows_uia',
      application: 'Harmless fixture',
      requestedAction: 'focus',
      requiredPermission: 'local_foreground_approval',
    });

    const restored = new ForegroundActionQueue(state);
    await restored.initialize();
    expect(restored.list(['pending'])).toEqual([pending]);
    if (!pending) throw new Error('Expected queued action');
    await restored.respond(pending.id, 'defer');
    expect(restored.get(pending.id).status).toBe('deferred');
    await restored.respond(pending.id, 'cancel');
    expect(restored.get(pending.id).status).toBe('cancelled');
  });
});
