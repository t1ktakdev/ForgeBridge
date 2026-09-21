import { describe, expect, it } from 'vitest';
import { runDeviceCommand } from '../../src/device/command.js';

describe('device CLI command', () => {
  it('lists, pings, renames, and revokes through the control plane', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const calls: { pathname: string; init?: RequestInit }[] = [];
    const device: Record<string, unknown> = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Workstation',
      health: 'ready',
      transport: 'stdio',
    };

    const requestBody = (init?: RequestInit): string =>
      typeof init?.body === 'string' ? init.body : '{}';

    const request = (pathname: string, init?: RequestInit): Promise<unknown> => {
      calls.push({ pathname, ...(init ? { init } : {}) });
      if (pathname === '/control/status')
        return Promise.resolve({ ok: true, status: { device: { ...device } } });
      const body = JSON.parse(requestBody(init)) as { action?: string; name?: string };
      if (body.action === 'rename_device') device['name'] = body.name;
      if (body.action === 'revoke') device['health'] = 'paused';
      return Promise.resolve({ ok: true, status: { device: { ...device } } });
    };
    const io = {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    };

    expect(await runDeviceCommand(['device', 'list'], io, request)).toBe(0);
    expect(JSON.parse(stdout.pop() ?? '[]')).toEqual([{ ...device }]);

    expect(await runDeviceCommand(['device', 'status'], io, request)).toBe(0);
    expect(JSON.parse(stdout.pop() ?? '{}')).toMatchObject({ name: 'Workstation' });

    expect(await runDeviceCommand(['device', 'ping'], io, request)).toBe(0);
    expect(JSON.parse(stdout.pop() ?? '{}')).toMatchObject({
      ok: true,
      device: { name: 'Workstation' },
    });

    expect(await runDeviceCommand(['device', 'rename', 'Desk Agent'], io, request)).toBe(0);
    expect(JSON.parse(stdout.pop() ?? '{}')).toMatchObject({ name: 'Desk Agent' });
    expect(JSON.parse(requestBody(calls.at(-1)?.init))).toEqual({
      action: 'rename_device',
      name: 'Desk Agent',
    });

    expect(await runDeviceCommand(['device', 'revoke'], io, request)).toBe(0);
    expect(JSON.parse(stdout.pop() ?? '{}')).toMatchObject({ health: 'paused' });
    expect(JSON.parse(requestBody(calls.at(-1)?.init))).toEqual({ action: 'revoke' });

    expect(await runDeviceCommand(['device', 'unknown'], io, request)).toBe(2);
    expect(stderr.at(-1)).toContain('device requires one of');
  });
});
