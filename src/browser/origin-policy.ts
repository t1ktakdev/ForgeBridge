import { isIP } from 'node:net';
import { ForgeBridgeError } from '../core/errors.js';

function hostMatches(pattern: string, actual: string): boolean {
  const expected = pattern.toLocaleLowerCase('en-US');
  const host = actual.toLocaleLowerCase('en-US');
  if (expected.startsWith('*.')) {
    const suffix = expected.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return expected === host;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase('en-US');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host) === 4) {
    const parts = host.split('.').map(Number);
    const first = parts[0] ?? -1;
    const second = parts[1] ?? -1;
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return (
    host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')
  );
}

export class BrowserOriginPolicy {
  readonly #patterns: readonly string[];

  constructor(patterns: readonly string[]) {
    this.#patterns = patterns;
  }

  allows(value: string): boolean {
    let actual: URL;
    try {
      actual = new URL(value);
    } catch {
      return false;
    }
    if (['about:', 'data:', 'blob:'].includes(actual.protocol)) return true;
    return this.#patterns.some((pattern) => {
      try {
        const wildcardPort = pattern.endsWith(':*');
        const expected = new URL(wildcardPort ? pattern.slice(0, -2) : pattern);
        return (
          actual.protocol === expected.protocol &&
          hostMatches(expected.hostname, actual.hostname) &&
          (wildcardPort || expected.port === actual.port)
        );
      } catch {
        return false;
      }
    });
  }

  assertAllowed(value: string): void {
    if (!this.allows(value)) {
      throw new ForgeBridgeError('origin_denied', 'Browser origin is not allowed by policy', {
        origin: this.safeOrigin(value),
        privateNetwork: this.isPrivate(value),
      });
    }
  }

  safeOrigin(value: string): string {
    try {
      return new URL(value).origin;
    } catch {
      return '[invalid URL]';
    }
  }

  isPrivate(value: string): boolean {
    try {
      return isPrivateHost(new URL(value).hostname);
    } catch {
      return false;
    }
  }
}
