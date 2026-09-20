import { describe, expect, it } from 'vitest';
import { WindowsActInputSchema, WindowsReadInputSchema } from '../../src/mcp/schemas.js';
import { WindowsUiAutomation } from '../../src/windows/uia.js';

describe('WindowsUiAutomation', () => {
  it('reports disabled state without invoking a helper', async () => {
    const automation = new WindowsUiAutomation({ enabled: false });
    await expect(automation.status()).resolves.toMatchObject({
      enabled: false,
      supported: process.platform === 'win32',
      desktopAvailable: false,
    });
    await expect(automation.windows()).rejects.toMatchObject({ code: 'feature_disabled' });
  });

  it('accepts only bounded semantic targets, locators, and actions', () => {
    expect(
      WindowsReadInputSchema.safeParse({
        operation: 'snapshot',
        target: { windowHandle: 42 },
        depth: 8,
        maxElements: 500,
      }).success,
    ).toBe(true);
    expect(
      WindowsActInputSchema.safeParse({
        operation: 'invoke',
        target: { processId: 42 },
        locator: { by: 'automationId', value: 'saveButton' },
        purpose: 'submit',
      }).success,
    ).toBe(true);
    expect(
      WindowsActInputSchema.safeParse({
        operation: 'set_value',
        target: { windowTitle: 'Editor' },
        locator: { by: 'controlType', value: 'Edit' },
        value: 'safe text',
        purpose: 'interact',
        script: 'malicious()',
      }).success,
    ).toBe(false);
    expect(
      WindowsActInputSchema.safeParse({
        operation: 'invoke',
        target: { windowHandle: -1 },
        locator: { by: 'name', value: 'Run' },
        purpose: 'interact',
      }).success,
    ).toBe(false);
  });

  it('requires an absolute configured PowerShell helper path', () => {
    expect(
      () => new WindowsUiAutomation({ enabled: true, powershellPath: 'powershell.exe' }),
    ).toThrow(expect.objectContaining({ code: 'invalid_config' }));
  });
});
