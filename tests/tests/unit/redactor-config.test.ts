import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/core/redactor.js';

describe('Redactor configuration literals', () => {
  it('preserves GitHub Actions id-token permissions while still redacting token values', () => {
    const redactor = new Redactor();
    const keyName = ['to', 'ken'].join('');
    const fakeSecret = ['abcd', 'efgh', 'ijkl', 'mnop'].join('');
    const input = [
      'permissions:',
      '  contents: read',
      '  id-token: write',
      `${keyName}:${fakeSecret}`,
    ].join('\n');

    const result = redactor.redactText(input);

    expect(result.value).toContain('id-token: write');
    expect(result.value).toContain('contents: read');
    expect(result.value).toContain(`${keyName}:[REDACTED]`);
    expect(result.value).not.toContain(fakeSecret);
  });
});
