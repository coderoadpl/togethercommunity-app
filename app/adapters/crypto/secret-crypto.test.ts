import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createSecretCrypto } from './secret-crypto.js';

const masterKey = randomBytes(32).toString('base64');

describe('secret crypto', () => {
  it('round-trips a secret through encrypt and decrypt', () => {
    const crypto = createSecretCrypto(masterKey);
    const encrypted = crypto.encrypt('rk_test_super_secret');
    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toEqual({ ok: true, value: 'rk_test_super_secret' });
  });

  it('produces a distinct IV and ciphertext for identical plaintext', () => {
    const crypto = createSecretCrypto(masterKey);
    const a = crypto.encrypt('same');
    const b = crypto.encrypt('same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails closed when the ciphertext is tampered with', () => {
    const crypto = createSecretCrypto(masterKey);
    const encrypted = crypto.encrypt('rk_test_super_secret');
    const tamperedByte = Buffer.from(encrypted.ciphertext, 'base64');
    tamperedByte[0] = tamperedByte[0] === undefined ? 0 : tamperedByte[0] ^ 0xff;
    const result = crypto.decrypt({ ...encrypted, ciphertext: tamperedByte.toString('base64') });
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('fails closed when the auth tag is tampered with', () => {
    const crypto = createSecretCrypto(masterKey);
    const encrypted = crypto.encrypt('rk_test_super_secret');
    const tamperedTag = Buffer.from(encrypted.authTag, 'base64');
    tamperedTag[0] = tamperedTag[0] === undefined ? 0 : tamperedTag[0] ^ 0xff;
    const result = crypto.decrypt({ ...encrypted, authTag: tamperedTag.toString('base64') });
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('cannot decrypt with a different master key', () => {
    const encrypted = createSecretCrypto(masterKey).encrypt('rk_test_super_secret');
    const other = createSecretCrypto(randomBytes(32).toString('base64'));
    expect(other.decrypt(encrypted)).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => createSecretCrypto(randomBytes(16).toString('base64'))).toThrow();
  });
});
