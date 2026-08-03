import { describe, expect, it } from 'vitest';

import {
  err,
  internal,
  ok,
  type AppError,
  type Result,
  type TenantSecret,
  type TenantSecretKey,
} from '#core/domain/index.js';
import type { SecretCrypto, TenantSecretRepository } from '#core/server/index.js';

import { createTenantSecretResolver } from './tenant-secret-resolver.js';

const secretRow = (tenantId: string, key: TenantSecretKey): TenantSecret => ({
  id: `sec-${tenantId}-${key}`,
  tenantId,
  key,
  ciphertext: `ct-${tenantId}-${key}`,
  iv: 'iv',
  authTag: 'tag',
  maskedPreview: 'rk_***',
  updatedAt: '2026-07-14T10:00:00.000Z',
});

const repoWith = (rows: TenantSecret[]): TenantSecretRepository => ({
  listByTenant: async (tenantId) => rows.filter((r) => r.tenantId === tenantId),
  findByKey: async (tenantId, key) => rows.find((r) => r.tenantId === tenantId && r.key === key) ?? null,
  upsert: async (_t, secret) => secret,
  delete: async () => true,
});

const cryptoReturning = (result: Result<string, AppError>): SecretCrypto => ({
  encrypt: () => ({ ciphertext: 'x', iv: 'y', authTag: 'z' }),
  decrypt: () => result,
});

describe('createTenantSecretResolver', () => {
  it('decrypts the stored secret for the requesting tenant', async () => {
    const resolver = createTenantSecretResolver(
      repoWith([secretRow('tenant-a', 'stripe.restrictedKey')]),
      cryptoReturning(ok('rk_live_decrypted')),
    );
    expect(await resolver.resolve('tenant-a', 'stripe.restrictedKey')).toEqual({ ok: true, value: 'rk_live_decrypted' });
  });

  it('does not leak another tenant\'s secret (per-tenant lookup)', async () => {
    const resolver = createTenantSecretResolver(
      repoWith([secretRow('tenant-a', 'stripe.restrictedKey')]),
      cryptoReturning(ok('rk_live_decrypted')),
    );
    const result = await resolver.resolve('tenant-b', 'stripe.restrictedKey');
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('returns not_found when the key is not configured for the tenant', async () => {
    const resolver = createTenantSecretResolver(repoWith([]), cryptoReturning(ok('unused')));
    const result = await resolver.resolve('tenant-a', 'bunny.apiKey');
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('propagates a decryption failure instead of masking it as success', async () => {
    const resolver = createTenantSecretResolver(
      repoWith([secretRow('tenant-a', 'stripe.webhookSecret')]),
      cryptoReturning(err(internal('bad key'))),
    );
    const result = await resolver.resolve('tenant-a', 'stripe.webhookSecret');
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('resolves legacy credential keys from the encrypted S3 configuration', async () => {
    const configuration = JSON.stringify({
      provider: 'minio',
      endpoint: 'http://127.0.0.1:19000',
      region: 'us-east-1',
      bucket: 'together-test',
      accessKeyId: 'configured-access',
      secretAccessKey: 'configured-secret',
    });
    const resolver = createTenantSecretResolver(
      repoWith([secretRow('tenant-a', 's3.configuration')]),
      cryptoReturning(ok(configuration)),
    );

    await expect(resolver.resolve('tenant-a', 's3.accessKeyId')).resolves.toEqual({
      ok: true,
      value: 'configured-access',
    });
    await expect(resolver.resolve('tenant-a', 's3.secretAccessKey')).resolves.toEqual({
      ok: true,
      value: 'configured-secret',
    });
  });

  it('prefers the encrypted S3 configuration over stale legacy credential rows', async () => {
    const configuration = JSON.stringify({
      provider: 'cloudflare_r2',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'together-test',
      accessKeyId: 'current-access',
      secretAccessKey: 'current-secret',
    });
    const resolver = createTenantSecretResolver(
      repoWith([
        secretRow('tenant-a', 's3.accessKeyId'),
        secretRow('tenant-a', 's3.secretAccessKey'),
        secretRow('tenant-a', 's3.configuration'),
      ]),
      {
        encrypt: () => ({ ciphertext: 'x', iv: 'y', authTag: 'z' }),
        decrypt: ({ ciphertext }) =>
          ok(ciphertext.endsWith('s3.configuration') ? configuration : 'stale-legacy-credential'),
      },
    );

    await expect(resolver.resolve('tenant-a', 's3.accessKeyId')).resolves.toEqual({
      ok: true,
      value: 'current-access',
    });
    await expect(resolver.resolve('tenant-a', 's3.secretAccessKey')).resolves.toEqual({
      ok: true,
      value: 'current-secret',
    });
  });
});
