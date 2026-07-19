import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createApiKeyCrypto } from './api-key-crypto.js';

describe('createApiKeyCrypto', () => {
  const crypto = createApiKeyCrypto();

  it('generates a URL-safe secret with no padding or unsafe characters', () => {
    const secret = crypto.generateSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(40);
  });

  it('generates a distinct secret each call', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => crypto.generateSecret()));
    expect(secrets.size).toBe(100);
  });

  it('hashes deterministically with SHA-256 hex so lookups by hash are stable', () => {
    const secret = 'together_sk_example';
    const expected = createHash('sha256').update(secret).digest('hex');
    expect(crypto.hash(secret)).toBe(expected);
    expect(crypto.hash(secret)).toBe(crypto.hash(secret));
    expect(crypto.hash(secret)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different secrets', () => {
    expect(crypto.hash('a')).not.toBe(crypto.hash('b'));
  });
});
