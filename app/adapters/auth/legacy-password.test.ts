import { pbkdf2 } from 'node:crypto';

import { hashPassword } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';

import { toLegacyPasswordHash, verifyPasswordWithLegacyFallback } from './legacy-password.js';

const legacyReferenceHash = (password: string, salt: string): Promise<string> =>
  new Promise((resolve, reject) => {
    pbkdf2(password, salt, 25000, 512, 'sha256', (error, derived) => {
      if (error) reject(error);
      else resolve(derived.toString('hex'));
    });
  });

describe('verifyPasswordWithLegacyFallback', () => {
  const salt = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

  it('verifies a Payload PBKDF2 credential stored in the legacy marker format', async () => {
    const stored = toLegacyPasswordHash({ salt, hash: await legacyReferenceHash('demo1234', salt) });
    expect(await verifyPasswordWithLegacyFallback({ hash: stored, password: 'demo1234' })).toBe(true);
  });

  it('rejects a wrong password against a legacy credential', async () => {
    const stored = toLegacyPasswordHash({ salt, hash: await legacyReferenceHash('demo1234', salt) });
    expect(await verifyPasswordWithLegacyFallback({ hash: stored, password: 'nope' })).toBe(false);
  });

  it('rejects malformed legacy markers without passing them to the native verifier', async () => {
    await expect(
      verifyPasswordWithLegacyFallback({
        hash: `pbkdf2$25000$${salt}$not-a-payload-hash`,
        password: 'demo1234',
      }),
    ).resolves.toBe(false);
    await expect(
      verifyPasswordWithLegacyFallback({
        hash: `pbkdf2$999999999$${salt}$${'00'.repeat(512)}`,
        password: 'demo1234',
      }),
    ).resolves.toBe(false);
  });

  it('falls through to the default scheme for non-marker hashes', async () => {
    const modern = await hashPassword('modern-pass');
    expect(await verifyPasswordWithLegacyFallback({ hash: modern, password: 'modern-pass' })).toBe(true);
    expect(await verifyPasswordWithLegacyFallback({ hash: modern, password: 'wrong' })).toBe(false);
  });
});
