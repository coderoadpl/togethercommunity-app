import { describe, expect, it } from 'vitest';

import { err, notFound, ok } from '#core/domain/index.js';
import type { TenantSecretResolver } from '#core/server/index.js';

import { createKsefCredentialResolver } from './ksef-credential-resolver.js';

describe('KSeF tenant credentials', () => {
  it('resolves the encrypted token and checksum-valid context for one tenant', async () => {
    const secrets: TenantSecretResolver = {
      resolve: async (tenantId, key) =>
        ok(key === 'ksef.token' ? `token-${tenantId}` : '5555555555'),
    };

    expect(await createKsefCredentialResolver(secrets).resolve('tenant-1')).toEqual({
      ok: true,
      value: {
        tenantId: 'tenant-1',
        token: 'token-tenant-1',
        contextNip: '5555555555',
      },
    });
  });

  it('rejects an invalid context NIP before authentication', async () => {
    const secrets: TenantSecretResolver = {
      resolve: async (_tenantId, key) =>
        ok(key === 'ksef.token' ? 'token' : '1234567890'),
    };

    expect(await createKsefCredentialResolver(secrets).resolve('tenant-1')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('reports incomplete tenant configuration without exposing either secret', async () => {
    const secrets: TenantSecretResolver = {
      resolve: async (_tenantId, key) =>
        key === 'ksef.token' ? ok('secret-token') : err(notFound()),
    };

    const result = await createKsefCredentialResolver(secrets).resolve('tenant-1');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'integration_not_configured' },
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
});
