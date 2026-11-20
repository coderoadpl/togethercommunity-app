import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONFIG_GROUP_POLICY,
  CONFIG_GROUPS,
  ok,
  organizationSecretKeySchema,
  tenantSecretKeySchema,
  type ConfigGroup,
  type TenantSecretKey,
} from '#core/domain/index.js';

import { createEffectiveTenantSecretResolver } from '../crypto/effective-tenant-secret-resolver.js';
import { createSecretCrypto } from '../crypto/secret-crypto.js';
import { createTenantSecretResolver } from '../crypto/tenant-secret-resolver.js';
import { createEffectiveTenantConfigReader } from './organizations.js';
import { createTenantSecretRepository } from './repositories.js';
import { organizationSecrets, organizations, tenantConfigSources, tenantSecrets, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const at = '2026-11-15T10:00:00.000Z';
const crypto = createSecretCrypto(Buffer.alloc(32, 7).toString('base64'));

const plaintext = (owner: string, key: string): string => key === 's3.configuration'
  ? JSON.stringify({
    provider: 'minio', endpoint: 'https://storage.example.test', region: 'us-east-1', bucket: `bucket-${owner}`,
    accessKeyId: `${owner}-s3-access`, secretAccessKey: `${owner}-s3-secret`,
  })
  : `${owner}:${key}`;

const tenantSecretRows = (tenantId: string, keys: readonly TenantSecretKey[]) => keys.map((key) => ({
  id: `tenant-secret-${tenantId}-${key}`, tenantId, key, ...crypto.encrypt(plaintext(tenantId, key)), maskedPreview: '***', updatedAt: at,
}));

const organizationSecretRows = (organizationId: string, keys: readonly string[]) => keys.map((key) => ({
  id: `org-secret-${organizationId}-${key}`, organizationId, key, ...crypto.encrypt(plaintext(organizationId, key)), maskedPreview: '***', updatedAt: at,
}));

const sourceRows = (tenantId: string, groups: readonly ConfigGroup[]) => groups.map((group) => ({
  tenantId, configGroup: group, source: 'organization' as const, updatedAt: at, updatedByUserId: 'user-owner',
}));

const legacyKeys = tenantSecretKeySchema.options.filter((key) => key !== 's3.configuration');

describe('effective tenant secret resolver over the database', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let legacy: ReturnType<typeof createTenantSecretResolver>;
  let effective: ReturnType<typeof createEffectiveTenantSecretResolver>;

  beforeAll(async () => {
    database = await createTestDatabase('together_effective_config_test', databaseUrl);
    await database.db.insert(organizations).values([
      { id: 'org-full', slug: 'holding-full', name: 'Holding full', createdAt: at, updatedAt: at },
      { id: 'org-partial', slug: 'holding-partial', name: 'Holding partial', createdAt: at, updatedAt: at },
      { id: 'org-other', slug: 'holding-other', name: 'Holding other', createdAt: at, updatedAt: at },
    ]);
    await database.db.insert(tenants).values([
      { id: 'acme', slug: 'acme', name: 'Acme', createdAt: at },
      { id: 'studio', slug: 'studio', name: 'Studio', createdAt: at },
      { id: 'akademia', slug: 'akademia', name: 'Akademia', createdAt: at, organizationId: 'org-full' },
      { id: 'linked-partial', slug: 'linked-partial', name: 'Linked partial', createdAt: at, organizationId: 'org-partial' },
      { id: 'linked-idle', slug: 'linked-idle', name: 'Linked idle', createdAt: at, organizationId: 'org-full' },
      { id: 'legacy-storage', slug: 'legacy-storage', name: 'Legacy storage', createdAt: at },
    ]);
    await database.db.insert(tenantSecrets).values([
      ...tenantSecretRows('acme', tenantSecretKeySchema.options),
      ...tenantSecretRows('akademia', tenantSecretKeySchema.options),
      ...tenantSecretRows('linked-partial', tenantSecretKeySchema.options),
      ...tenantSecretRows('linked-idle', tenantSecretKeySchema.options),
      ...tenantSecretRows('legacy-storage', legacyKeys),
    ]);
    await database.db.insert(organizationSecrets).values([
      ...organizationSecretRows('org-full', organizationSecretKeySchema.options),
      ...organizationSecretRows('org-other', organizationSecretKeySchema.options),
      ...organizationSecretRows('org-partial', ['stripe.restrictedKey', 'stripe.testRestrictedKey', 'ifirma.username', 'smtp.host', 'stripe.webhookSecret']),
    ]);
    await database.db.insert(tenantConfigSources).values([
      ...sourceRows('akademia', CONFIG_GROUPS),
      ...sourceRows('linked-partial', ['payments_live', 'invoicing']),
    ]);
    legacy = createTenantSecretResolver(createTenantSecretRepository(database.db), crypto);
    effective = createEffectiveTenantSecretResolver(legacy, createEffectiveTenantConfigReader(database.db), crypto);
  });

  afterAll(async () => { await database?.close(); });

  it.each(['acme', 'studio', 'linked-idle', 'legacy-storage'])(
    'resolves every key of %s, which has no source row, exactly like the workspace resolver',
    async (tenantId) => {
      for (const key of tenantSecretKeySchema.options) {
        expect({ key, result: await effective.resolve(tenantId, key) }).toEqual({ key, result: await legacy.resolve(tenantId, key) });
      }
    },
  );

  it('keeps an unlinked workspace on its own values while other organizations hold every key', async () => {
    expect(await effective.resolve('acme', 'stripe.restrictedKey')).toEqual(ok('acme:stripe.restrictedKey'));
    expect(await effective.resolve('acme', 's3.accessKeyId')).toEqual(ok('acme-s3-access'));
    expect(await effective.resolve('legacy-storage', 's3.accessKeyId')).toEqual(ok('legacy-storage:s3.accessKeyId'));
    expect(await effective.resolve('studio', 'smtp.host')).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('takes every inheritable key from the organization and every never-inherit key from the workspace', async () => {
    for (const key of tenantSecretKeySchema.options) {
      const expected = CONFIG_GROUP_POLICY[key] === 'workspace'
        ? await legacy.resolve('akademia', key)
        : ok(plaintext('org-full', key));
      expect({ key, result: await effective.resolve('akademia', key) }).toEqual({ key, result: expected });
    }
    expect(await effective.resolve('akademia', 'stripe.webhookSecret')).toEqual(ok('akademia:stripe.webhookSecret'));
  });

  it('switches only the groups with a source row and never falls back to the workspace row', async () => {
    expect(await effective.resolve('linked-partial', 'stripe.restrictedKey')).toEqual(ok('org-partial:stripe.restrictedKey'));
    expect(await effective.resolve('linked-partial', 'stripe.webhookSecret')).toEqual(ok('linked-partial:stripe.webhookSecret'));
    expect(await effective.resolve('linked-partial', 'stripe.webhookEndpointId')).toEqual(ok('linked-partial:stripe.webhookEndpointId'));
    expect(await effective.resolve('linked-partial', 'stripe.testRestrictedKey')).toEqual(ok('linked-partial:stripe.testRestrictedKey'));
    expect(await effective.resolve('linked-partial', 'smtp.host')).toEqual(ok('linked-partial:smtp.host'));
    expect(await effective.resolve('linked-partial', 'ifirma.username')).toEqual(ok('org-partial:ifirma.username'));
    expect(await effective.resolve('linked-partial', 'ifirma.invoiceApiKey')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await effective.resolve('linked-partial', 'ksef.token')).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('reads the inherited organization settings only for a switched group', async () => {
    const reader = createEffectiveTenantConfigReader(database.db);
    expect(await reader.findInheritedSettings('linked-partial', 'invoicing')).toEqual({
      source: 'organization',
      value: {
        legalName: null, legalAddress: null, invoicingProvider: null, ksefSubmissionMode: 'automatic',
        shipxEnvironment: 'sandbox', shipxSender: null,
      },
    });
    expect(await reader.findInheritedSettings('linked-partial', 'shipping_carrier')).toEqual({ source: 'workspace' });
    expect(await reader.findInheritedSettings('linked-idle', 'invoicing')).toEqual({ source: 'workspace' });
    expect(await reader.findInheritedSettings('acme', 'invoicing')).toEqual({ source: 'workspace' });
  });
});
