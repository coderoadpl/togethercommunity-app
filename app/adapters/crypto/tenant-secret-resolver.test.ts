import { describe, expect, it } from 'vitest';

import {
  err,
  internal,
  ok,
  type AppError,
  type Result,
  type TenantSecret,
  type TenantSecretKey,
} from '@core/domain/index.js';
import type { SecretCrypto, TenantSecretRepository } from '@core/server/index.js';

import { createTenantSecretResolver } from './tenant-secret-resolver.js';

const secretRow = (tenantId: string, key: TenantSecretKey): TenantSecret => ({
  id: `sec-${tenantId}-${key}`,
  tenantId,
  key,
  ciphertext: `ct-${tenantId}`,
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
});
