import { describe, expect, it } from 'vitest';

import type { TenantSecret, TenantSecretKey } from '#core/domain/index.js';
import { createMarketingTickFailures, type SecretCrypto, type TenantSecretRepository } from '#core/server/index.js';

import { createSecretCrypto } from '../crypto/secret-crypto.js';
import { createTenantSecretResolver } from '../crypto/tenant-secret-resolver.js';

import { createMarketingSesCredentialResolver } from './marketing-credentials.js';

const masterKey = (fill: number): string => Buffer.alloc(32, fill).toString('base64');

const storedSecrets = (crypto: SecretCrypto, values: readonly (readonly [TenantSecretKey, string])[]): TenantSecretRepository => {
  const rows: TenantSecret[] = values.map(([key, value]) => ({
    id: `secret-${key}`,
    tenantId: 'tenant-1',
    key,
    ...crypto.encrypt(value),
    maskedPreview: '***',
    updatedAt: '2026-11-12T00:00:00.000Z',
  }));
  return {
    listByTenant: async (tenantId) => rows.filter((row) => row.tenantId === tenantId),
    findByKey: async (tenantId, key) => rows.find((row) => row.tenantId === tenantId && row.key === key) ?? null,
    upsert: async (_tenantId, secret) => secret,
    upsertMany: async (_tenantId, secrets) => [...secrets],
    delete: async () => true,
  };
};

const sesSecrets = [
  ['ses.accessKeyId', 'AKIAEXAMPLE'],
  ['ses.secretAccessKey', 'example-secret'],
  ['ses.region', 'eu-central-1'],
] as const;

describe('marketing SES credentials', () => {
  it('resolves all three stored secrets', async () => {
    const crypto = createSecretCrypto(masterKey(1));
    const credentials = createMarketingSesCredentialResolver(createTenantSecretResolver(storedSecrets(crypto, sesSecrets), crypto));

    expect(await credentials.resolve('tenant-1')).toEqual({
      ok: true,
      value: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'example-secret', region: 'eu-central-1' },
    });
  });

  it('reports a missing secret as the tenant configuration gap', async () => {
    const crypto = createSecretCrypto(masterKey(1));
    const withoutRegion = sesSecrets.filter(([key]) => key !== 'ses.region');
    const credentials = createMarketingSesCredentialResolver(createTenantSecretResolver(storedSecrets(crypto, withoutRegion), crypto));

    expect(await credentials.resolve('tenant-1')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'ses_not_configured', message: 'Tenant SES region is not configured' }),
    });
  });

  it('keeps a secret that fails integrity verification a platform failure the marketing tick logs and fails on', async () => {
    const stored = storedSecrets(createSecretCrypto(masterKey(1)), sesSecrets);
    const credentials = createMarketingSesCredentialResolver(createTenantSecretResolver(stored, createSecretCrypto(masterKey(2))));
    const errors: string[] = [];
    const warnings: string[] = [];
    const failures = createMarketingTickFailures({
      warn: (message) => { warnings.push(message); },
      error: (message) => { errors.push(message); },
    });

    const resolved = await credentials.resolve('tenant-1');
    expect(resolved).toEqual({ ok: false, error: expect.objectContaining({ code: 'internal' }) });
    if (!resolved.ok) failures.tenant('tenant-1', 'campaign', resolved.error);

    expect(failures.firstPlatformFailure()).toMatchObject({ code: 'internal' });
    expect(failures.tenantErrors()).toEqual([]);
    expect(warnings).toEqual([]);
    expect(errors).toEqual(['[marketing] tick failed tenant=tenant-1 step=campaign error=internal']);
  });
});
