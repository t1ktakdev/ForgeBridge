import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Redactor } from '../../src/core/redactor.js';
import { JobManager } from '../../src/jobs/manager.js';
import { defaultConfig } from '../../src/core/config.js';
import { ExecutionPolicy, ResourceGovernor } from '../../src/execution/policy.js';

const managers: JobManager[] = [];

async function eventually(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map(async (manager) => manager.close(true)));
});

describe('JobManager', () => {
  it('keeps a job addressable after the creating call returns', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-jobs-'));
    const manager = new JobManager(state, 64 * 1024, new Redactor());
    managers.push(manager);
    await manager.initialize();
    const command =
      process.platform === 'win32'
        ? "Write-Output 'ready'; Start-Sleep -Milliseconds 250; Write-Output 'done'"
        : "printf 'ready\\n'; sleep 0.25; printf 'done\\n'";
    const job = await manager.start({ command, workingDirectory: state });
    expect(job.status).toBe('running');
    await eventually(() => manager.status(job.id).status !== 'running');
    expect(manager.status(job.id).status).toBe('succeeded');
    const logs = await manager.logs(job.id);
    expect(logs.data).toContain('ready');
    expect(logs.data).toContain('done');
    expect(logs.eof).toBe(true);
  });

  it('cancels an owned long-running process', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-jobs-'));
    const manager = new JobManager(state, 64 * 1024, new Redactor());
    managers.push(manager);
    await manager.initialize();
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20';
    const job = await manager.start({ command, workingDirectory: state });
    const cancelled = await manager.cancel(job.id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('redacts stored commands and log output', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-jobs-'));
    const manager = new JobManager(state, 64 * 1024, new Redactor(['do-not-log-this']));
    managers.push(manager);
    await manager.initialize();
    const command =
      process.platform === 'win32'
        ? "Write-Output 'do-not-log-this'"
        : "printf 'do-not-log-this\\n'";
    const job = await manager.start({ command, workingDirectory: state });
    await eventually(() => manager.status(job.id).status !== 'running');
    expect(manager.status(job.id).command).not.toContain('do-not-log-this');
    expect((await manager.logs(job.id)).data).not.toContain('do-not-log-this');
  });

  it('enforces the gaming profile parallel-job limit', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-jobs-'));
    const config = defaultConfig(state);
    const policy = new ExecutionPolicy(config.execution);
    policy.setProfile('gaming');
    const manager = new JobManager(
      state,
      64 * 1024,
      new Redactor(),
      policy,
      new ResourceGovernor(policy),
    );
    managers.push(manager);
    await manager.initialize();
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20';
    const first = await manager.start({ command, workingDirectory: state });
    await expect(manager.start({ command, workingDirectory: state })).rejects.toMatchObject({
      code: 'resource_limit',
    });
    await manager.cancel(first.id);
  });

  it('rejects a persisted job record that points logs outside agent state', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-jobs-'));
    await mkdir(path.join(state, 'state'));
    await writeFile(
      path.join(state, 'state', 'jobs.json'),
      `${JSON.stringify([
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'command',
          createdAt: new Date().toISOString(),
          status: 'succeeded',
          workingDirectory: state,
          command: 'safe',
          shell: 'powershell',
          logFile: path.join(state, '..', 'outside.log'),
          logTruncated: false,
          metadata: {},
        },
      ])}\n`,
    );
    const manager = new JobManager(state, 64 * 1024, new Redactor());
    await expect(manager.initialize()).rejects.toMatchObject({ code: 'invalid_job_state' });
  });

  it('reports malformed partial state with a stable error code', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-jobs-'));
    await mkdir(path.join(state, 'state'));
    await writeFile(
      path.join(state, 'state', 'jobs.json'),
      '[{"id":"00000000-0000-4000-8000-000000000001","status":"running"}]\n',
    );
    const manager = new JobManager(state, 64 * 1024, new Redactor());
    await expect(manager.initialize()).rejects.toMatchObject({
      code: 'invalid_job_state',
      message: 'Persisted job state is malformed',
    });
  });

  it('recovers its resource slot after a child exits unsuccessfully', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-jobs-'));
    const config = defaultConfig(state);
    config.execution.maxCpuConcurrency = 1;
    const policy = new ExecutionPolicy(config.execution);
    const resources = new ResourceGovernor(policy);
    const manager = new JobManager(state, 64 * 1024, new Redactor(), policy, resources);
    managers.push(manager);
    await manager.initialize();
    const failing = await manager.start({ command: 'exit 23', workingDirectory: state });
    await eventually(() => manager.status(failing.id).status !== 'running');
    expect(manager.status(failing.id)).toMatchObject({ status: 'failed', exitCode: 23 });
    expect(resources.status().activeCpuTasks).toBe(0);
    const succeeding = await manager.start({ command: 'exit 0', workingDirectory: state });
    await eventually(() => manager.status(succeeding.id).status !== 'running');
    expect(manager.status(succeeding.id).status).toBe('succeeded');
  });
});
