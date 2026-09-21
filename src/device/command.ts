type DeviceCliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

type ControlRequest = (pathname: string, init?: RequestInit) => Promise<unknown>;

type ControlStatusResponse = {
  ok?: boolean;
  status?: {
    device?: unknown;
  };
};

function deviceFrom(value: unknown): unknown {
  return (value as ControlStatusResponse | undefined)?.status?.device ?? null;
}

export async function runDeviceCommand(
  args: readonly string[],
  io: DeviceCliIo,
  request: ControlRequest,
): Promise<number> {
  const operation = args[1] ?? 'status';

  if (operation === 'list' || operation === 'status' || operation === 'ping') {
    const started = performance.now();
    const result = await request('/control/status');
    const device = deviceFrom(result);

    if (operation === 'list') io.stdout(JSON.stringify(device ? [device] : [], null, 2));
    else if (operation === 'ping') {
      io.stdout(
        JSON.stringify(
          {
            ok: true,
            latencyMs: Math.max(0, Math.round((performance.now() - started) * 100) / 100),
            device,
          },
          null,
          2,
        ),
      );
    } else io.stdout(JSON.stringify(device, null, 2));
    return 0;
  }

  if (operation === 'rename') {
    const name = args[2]?.trim();
    if (!name) throw new Error('device rename requires a non-empty device name');
    const result = await request('/control/action', {
      method: 'POST',
      body: JSON.stringify({ action: 'rename_device', name }),
    });
    io.stdout(JSON.stringify(deviceFrom(result), null, 2));
    return 0;
  }

  if (operation === 'revoke') {
    const result = await request('/control/action', {
      method: 'POST',
      body: JSON.stringify({ action: 'revoke' }),
    });
    io.stdout(JSON.stringify(deviceFrom(result), null, 2));
    return 0;
  }

  io.stderr('device requires one of: list, status, rename NAME, ping, revoke');
  return 2;
}
