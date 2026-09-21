import { describe, expect, it } from 'vitest';
import { sanitizeCredentialHelpers } from '../../src/git/service.js';

describe('Git credential helper hardening', () => {
  it('keeps simple system/global helpers and supported arguments', () => {
    expect(
      sanitizeCredentialHelpers(['manager', 'osxkeychain', 'cache --timeout=3600', 'manager']),
    ).toEqual(['manager', 'osxkeychain', 'cache --timeout=3600']);
  });

  it('honors an empty helper as a reset boundary', () => {
    expect(sanitizeCredentialHelpers(['manager', '', 'osxkeychain'])).toEqual(['osxkeychain']);
  });

  it('rejects shell helpers and unsafe helper syntax', () => {
    expect(
      sanitizeCredentialHelpers([
        '!node malicious.mjs',
        '-bad',
        '../evil',
        'manager && calc',
        'manager;calc',
        'safe helper=$(evil)',
      ]),
    ).toEqual([]);
  });
});
