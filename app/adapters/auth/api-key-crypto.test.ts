import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { shopManagementKeyHash } from '#core/server/index.js';

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

  it('keeps the stored hash of a direct-mode shop key and puts a propose-mode key in its own hash domain', () => {
    const secret = 'together_sk_example';
    expect(crypto.hash(secret)).toBe('7aa97b740e6745ad23c94b16a86f43285c7fa54e6d1789d4559129f1fd12424a');
    expect(shopManagementKeyHash(crypto, secret, 'direct')).toBe('7aa97b740e6745ad23c94b16a86f43285c7fa54e6d1789d4559129f1fd12424a');
    expect(shopManagementKeyHash(crypto, secret, 'propose')).toBe('63de2325f5baacb9711bf987aadeced0dae21b093e73a1e948e47f7caab39286');
  });
});
