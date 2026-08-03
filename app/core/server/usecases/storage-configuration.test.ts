import { describe, expect, it } from 'vitest';

import {
  err,
  integrationAuth,
  ok,
  type Identity,
  type StorageConfiguration,
  type TenantSecret,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { StorageProvider, TenantSecretRepository } from '../ports.js';
import {
  configureStorageConnection,
  probeStorageConnection,
  type StorageConfigurationDeps,
} from './storage-configuration.js';

const NOW = '2026-08-03T12:00:00.000Z';

const configuration: StorageConfiguration = {
  provider: 'minio',
  endpoint: 'http://127.0.0.1:19000',
  region: 'us-east-1',
  bucket: 'together-test',
  accessKeyId: 'together-access',
  secretAccessKey: 'together-secret',
};

const ctx = (role: 'owner' | 'admin'): Ctx => ({
  identity: {
    userId: 'user-1',
    email: 'owner@together.dev',
    name: 'Owner',
    tenantId: 'tenant-1',
    tenantSlug: 'acme',
    tenantName: 'Acme',
    staffRole: role,
    memberId: null,
    memberBannedAt: null,
  } satisfies Identity,
});

const harness = (probeFails = false) => {
  const rows: TenantSecret[] = [];
  const probes: StorageConfiguration[] = [];
  const tenantSecrets: TenantSecretRepository = {
    listByTenant: async () => rows,
    findByKey: async (_tenantId, key) => rows.find((row) => row.key === key) ?? null,
    upsert: async (_tenantId, secret) => {
      rows.push(secret);
      return secret;
    },
    delete: async () => false,
  };
  const storage: StorageProvider = {
    objectUrl: (input, key) => new URL(`${input.endpoint}/${input.bucket}/${key}`),
    probe: async (input) => {
      probes.push(input);
      return probeFails
        ? err(integrationAuth('rejected', { providerCode: 'storage.credentials' }))
        : ok({ code: 'storage.available', message: 'probe complete' });
    },
    presignPut: (input) => ok(input.url),
    presignGet: (input) => ok(input.url),
    delete: async () => ok({ deleted: true }),
    head: async () => ok({ sizeBytes: 1 }),
    healthcheck: async () => ok({ healthy: true }),
    test: async () => ok({ code: 'storage.available', message: 'probe complete' }),
  };
  const deps: StorageConfigurationDeps = {
    storage,
    tenantSecrets,
    secretCrypto: {
      encrypt: (plaintext) => ({ ciphertext: `cipher:${plaintext}`, iv: 'iv', authTag: 'tag' }),
      decrypt: () => err(integrationAuth('unused')),
    },
    ids: { nextId: () => 'secret-storage' },
    clock: { nowIso: () => NOW },
  };
  return { deps, probes, rows };
};

describe('storage configuration', () => {
  it('runs a live probe without persisting the submitted credentials', async () => {
    const h = harness();

    await expect(probeStorageConnection(ctx('owner'), configuration, h.deps)).resolves.toEqual({
      ok: true,
      value: { diagnostic: { code: 'storage.available', message: 'probe complete' } },
    });
    expect(h.probes).toEqual([configuration]);
    expect(h.rows).toEqual([]);
  });

  it('re-probes and saves the complete configuration as one encrypted tenant secret', async () => {
    const h = harness();
    const result = await configureStorageConnection(ctx('owner'), configuration, h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        diagnostic: { code: 'storage.available' },
        secret: { key: 's3.configuration', maskedPreview: '••••', updatedAt: NOW },
      },
    });
    expect(h.probes).toEqual([configuration]);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]?.ciphertext).toBe(`cipher:${JSON.stringify(configuration)}`);
    expect(JSON.stringify(result)).not.toContain(configuration.accessKeyId);
    expect(JSON.stringify(result)).not.toContain(configuration.secretAccessKey);
  });

  it('does not persist a configuration rejected by the provider', async () => {
    const h = harness(true);

    await expect(configureStorageConnection(ctx('owner'), configuration, h.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_auth', details: { providerCode: 'storage.credentials' } },
    });
    expect(h.rows).toEqual([]);
  });

  it('rejects bucket names that could control the probe path', async () => {
    const h = harness();

    await expect(
      probeStorageConnection(ctx('owner'), { ...configuration, bucket: 'valid/../../internal' }, h.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.probes).toEqual([]);
  });

  it('requires owner-only permissions for probing and saving', async () => {
    const h = harness();

    await expect(probeStorageConnection(ctx('admin'), configuration, h.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(configureStorageConnection(ctx('admin'), configuration, h.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(h.probes).toEqual([]);
  });
});
