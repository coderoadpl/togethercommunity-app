import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { secretFingerprint } from './secret-fingerprint.js';

describe('secretFingerprint', () => {
  it.each([
    ['BETTER_AUTH_SECRET', 'test-only-better-auth-secret', '55cfdafba1172c2d'],
    ['CRON_SECRET', 'test-only-better-auth-secret', 'a0f3a7ed0450a663'],
    ['OPERATOR_SECRET', ' test-only-padded-value\n', '9110a3a1bb01767b'],
    ['SECRETS_MASTER_KEY', 'test-only-zażółć-key', '7068dca716433ec6'],
  ])('matches the openssl HMAC-SHA256 vector for %s', (name, value, expected) => {
    expect(secretFingerprint(name, value)).toBe(expected);
  });

  it('keys the HMAC with the value and authenticates the versioned name', () => {
    const value = 'test-only-independent-check';
    const independent = createHmac('sha256', value)
      .update('together-secret-fingerprint-v1:EMAIL_DISPATCH_SECRET')
      .digest('hex')
      .slice(0, 16);
    expect(secretFingerprint('EMAIL_DISPATCH_SECRET', value)).toBe(independent);
  });

  it('separates equal values under different names and never trims the value', () => {
    const value = 'test-only-shared-value';
    expect(secretFingerprint('CRON_SECRET', value)).not.toBe(secretFingerprint('MARKETING_TICK_SECRET', value));
    expect(secretFingerprint('CRON_SECRET', `${value}\n`)).not.toBe(secretFingerprint('CRON_SECRET', value));
  });

  it('returns sixteen lowercase hex characters, also for an empty value', () => {
    expect(secretFingerprint('CRON_SECRET', 'test-only-value')).toMatch(/^[0-9a-f]{16}$/);
    expect(secretFingerprint('CRON_SECRET', '')).toMatch(/^[0-9a-f]{16}$/);
  });
});
