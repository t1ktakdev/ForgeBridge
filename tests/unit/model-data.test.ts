import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/core/redactor.js';
import { shellContract } from '../../src/terminal/host.js';

describe('model-readable host and shared data', () => {
  it('preserves shared references while redacting every occurrence', () => {
    const scope = { kind: 'path', value: 'project/file.txt', ['password']: 'fixture-only' };
    const value = new Redactor().redact({ scope, approval: { scope }, scopes: [scope] }).value;
    expect(value.scope).toEqual({
      kind: 'path',
      value: 'project/file.txt',
      ['password']: '[REDACTED]',
    });
    expect(value.approval.scope).toEqual(value.scope);
    expect(value.scopes[0]).toEqual(value.scope);
  });
  it('continues to bound cycles and preserve inert special JSON property names', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(new Redactor().redact(cycle).value['self']).toBe('[CIRCULAR]');
    const input: unknown = JSON.parse('{"__proto__":{"polluted":true},"safe":42}');
    const value = new Redactor().redact(input).value as Record<string, unknown>;
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });
  it('states PowerShell and Bash syntax without assuming Windows supports &&', () => {
    expect(shellContract('win32')).toMatchObject({
      default: 'powershell',
      supportsAndAnd: false,
      workingDirectoryArgument: 'workingDirectory',
    });
    expect(shellContract('linux')).toMatchObject({ default: 'bash', supportsAndAnd: true });
  });
});
