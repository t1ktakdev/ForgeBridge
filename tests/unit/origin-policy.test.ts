import { describe, expect, it } from 'vitest';
import { BrowserOriginPolicy } from '../../src/browser/origin-policy.js';

describe('BrowserOriginPolicy', () => {
  it('matches exact hosts and wildcard ports without matching lookalikes', () => {
    const policy = new BrowserOriginPolicy(['http://localhost:*', 'https://*.example.test']);
    expect(policy.allows('http://localhost:4173/page')).toBe(true);
    expect(policy.allows('https://app.example.test/path')).toBe(true);
    expect(policy.allows('https://example.test.evil.invalid')).toBe(false);
    expect(policy.allows('http://127.0.0.1:4173')).toBe(false);
  });

  it('classifies private network destinations', () => {
    const policy = new BrowserOriginPolicy([]);
    expect(policy.isPrivate('http://127.0.0.1')).toBe(true);
    expect(policy.isPrivate('http://192.168.1.2')).toBe(true);
    expect(policy.isPrivate('https://example.com')).toBe(false);
  });
});
