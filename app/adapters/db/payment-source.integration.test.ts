import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { stripeModeFromKey, type StripeMode } from '#core/domain/index.js';
import type { OrganizationPaymentConfig } from '#core/server/index.js';

import { createEffectiveTenantSecretResolver } from '../crypto/effective-tenant-secret-resolver.js';
import { createSecretCrypto } from '../crypto/secret-crypto.js';
import { createTenantSecretResolver } from '../crypto/tenant-secret-resolver.js';
import { createEffectiveTenantConfigReader } from './organizations.js';
import { createPaymentSourceReader } from './payment-source.js';
import { createTenantSecretRepository } from './repositories.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const at = '2026-11-25T10:00:00.000Z';
const crypto = createSecretCrypto(Buffer.alloc(32, 9).toString('base64'));

const WORKSPACE_STRIPE_ROWS = {
  'stripe.restrictedKey': 'rk_live_workspaceownkey',
  'stripe.webhookSecret': 'whsec_workspacelive',
  'stripe.webhookEndpointId': 'we_workspacelive',
  'stripe.testRestrictedKey': 'rk_test_workspaceownkey',
  'stripe.testWebhookSecret': 'whsec_workspacetest',
  'stripe.testWebhookEndpointId': 'we_workspacetest',
} as const;

const inherited = (keyPresent: boolean, keyMode: StripeMode | null): OrganizationPaymentConfig =>
  ({ source: 'organization', keyPresent, webhookReady: false, keyMode });

const WORKSPACES = ['acme', 'studio', 'akademia', 'linked-idle', 'linked-bare', 'orphan', 'wrong-mode', 'suspended-inheriting', 'suspended-own'] as const;

describe('payment source over the database', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let reader: ReturnType<typeof createPaymentSourceReader>;

  const insertTenantSecrets = async (tenantId: string, values: Readonly<Record<string, string>>) => {
    for (const [key, value] of Object.entries(values)) {
      const encrypted = crypto.encrypt(value);
      await database.db.execute(sql`INSERT INTO tenant_secrets (id, tenant_id, key, ciphertext, iv, auth_tag, masked_preview, updated_at)
        VALUES (${`secret-${tenantId}-${key}`}, ${tenantId}, ${key}, ${encrypted.ciphertext}, ${encrypted.iv}, ${encrypted.authTag}, '***', ${at})`);
    }
  };

  const insertOrganizationSecret = async (organizationId: string, key: string, value: string) => {
    const encrypted = crypto.encrypt(value);
    await database.db.execute(sql`INSERT INTO organization_secrets (id, organization_id, key, ciphertext, iv, auth_tag, masked_preview, updated_at)
      VALUES (${`org-secret-${organizationId}-${key}`}, ${organizationId}, ${key}, ${encrypted.ciphertext}, ${encrypted.iv}, ${encrypted.authTag}, '***', ${at})`);
  };

  const inherit = async (tenantId: string, group: 'payments_live' | 'payments_test') => {
    await database.db.execute(sql`INSERT INTO tenant_config_sources (tenant_id, config_group, source, updated_at, updated_by_user_id)
      VALUES (${tenantId}, ${group}, 'organization', ${at}, 'user-owner')`);
  };

  beforeAll(async () => {
    database = await createTestDatabase('together_payment_source_test', databaseUrl);
    await database.db.execute(sql`INSERT INTO organizations (id, slug, name, status, created_at, updated_at) VALUES
      ('org-active', 'holding-active', 'Holding active', 'active', ${at}, ${at}),
      ('org-wrong-mode', 'holding-wrong-mode', 'Holding wrong mode', 'active', ${at}, ${at}),
      ('org-suspended', 'holding-suspended', 'Holding suspended', 'suspended', ${at}, ${at})`);
    await database.db.execute(sql`INSERT INTO tenants (id, slug, name, created_at, organization_id) VALUES
      ('acme', 'acme', 'Acme', ${at}, NULL),
      ('studio', 'studio', 'Studio', ${at}, 'org-active'),
      ('akademia', 'akademia', 'Akademia', ${at}, 'org-active'),
      ('linked-idle', 'linked-idle', 'Linked idle', ${at}, 'org-active'),
      ('linked-bare', 'linked-bare', 'Linked bare', ${at}, 'org-active'),
      ('orphan', 'orphan', 'Orphan', ${at}, NULL),
      ('wrong-mode', 'wrong-mode', 'Wrong mode', ${at}, 'org-wrong-mode'),
      ('suspended-inheriting', 'suspended-inheriting', 'Suspended inheriting', ${at}, 'org-suspended'),
      ('suspended-own', 'suspended-own', 'Suspended own', ${at}, 'org-suspended')`);
    for (const tenantId of ['acme', 'studio', 'akademia', 'linked-idle', 'orphan', 'wrong-mode', 'suspended-inheriting', 'suspended-own']) {
      await insertTenantSecrets(tenantId, WORKSPACE_STRIPE_ROWS);
    }
    await insertOrganizationSecret('org-active', 'stripe.restrictedKey', 'rk_live_organizationkey');
    await insertOrganizationSecret('org-wrong-mode', 'stripe.restrictedKey', 'rk_test_inlivegroupkey');
    await insertOrganizationSecret('org-suspended', 'stripe.restrictedKey', 'rk_live_suspendedkey');
    await insertOrganizationSecret('org-suspended', 'stripe.testRestrictedKey', 'rk_test_suspendedkey');
    await inherit('studio', 'payments_live');
    await inherit('akademia', 'payments_test');
    await inherit('linked-bare', 'payments_live');
    await inherit('orphan', 'payments_live');
    await inherit('wrong-mode', 'payments_live');
    await inherit('suspended-inheriting', 'payments_live');
    await inherit('suspended-inheriting', 'payments_test');
    reader = createPaymentSourceReader(database.db, crypto);
  });

  afterAll(async () => { await database?.close(); });

  it.each(['acme', 'linked-idle', 'suspended-own', 'unknown-workspace'])('answers the workspace source for %s, which has no source row', async (tenantId) => {
    expect([await reader.read(tenantId, 'live'), await reader.read(tenantId, 'test')]).toEqual([{ source: 'workspace' }, { source: 'workspace' }]);
  });

  it('answers an inherited live group from the organization key and leaves test on the workspace', async () => {
    expect(await reader.read('studio', 'live')).toEqual(inherited(true, 'live'));
    expect(await reader.read('studio', 'test')).toEqual({ source: 'workspace' });
  });

  it('answers an inherited test group without an organization test key as absent, while live stays on the workspace', async () => {
    expect(await reader.read('akademia', 'test')).toEqual(inherited(false, null));
    expect(await reader.read('akademia', 'live')).toEqual({ source: 'workspace' });
  });

  it('answers an inherited group for a workspace without rows of its own', async () => {
    expect(await reader.read('linked-bare', 'live')).toEqual(inherited(true, 'live'));
    expect(await reader.read('linked-bare', 'test')).toEqual({ source: 'workspace' });
  });

  it('answers a source row of a workspace without an organization as an absent organization key', async () => {
    expect(await reader.read('orphan', 'live')).toEqual(inherited(false, null));
  });

  it('reports the mode of the organization key, not of the retained workspace key', async () => {
    expect(await reader.read('wrong-mode', 'live')).toEqual(inherited(true, 'test'));
    expect(await reader.read('suspended-inheriting', 'live')).toEqual(inherited(true, 'live'));
    expect(await reader.read('suspended-inheriting', 'test')).toEqual(inherited(true, 'test'));
  });

  it('agrees with the effective secret resolver that the payment provider uses', async () => {
    const workspaceResolver = createTenantSecretResolver(createTenantSecretRepository(database.db), crypto);
    const resolver = createEffectiveTenantSecretResolver(workspaceResolver, createEffectiveTenantConfigReader(database.db), crypto);
    for (const tenantId of WORKSPACES) {
      for (const mode of ['live', 'test'] as const) {
        const slot = mode === 'live' ? 'stripe.restrictedKey' : 'stripe.testRestrictedKey';
        const answer = await reader.read(tenantId, mode);
        const key = await resolver.resolve(tenantId, slot);
        expect({ tenantId, mode, answer: answer.source === 'workspace' ? answer : { keyPresent: answer.keyPresent, keyMode: answer.keyMode } }).toEqual({
          tenantId, mode,
          answer: answer.source === 'workspace' && JSON.stringify(key) === JSON.stringify(await workspaceResolver.resolve(tenantId, slot))
            ? { source: 'workspace' }
            : { keyPresent: key.ok, keyMode: key.ok ? stripeModeFromKey(key.value) : null },
        });
      }
    }
  });

  it('reports an unreadable inherited key as present without a mode', async () => {
    await database.db.execute(sql`UPDATE organization_secrets SET ciphertext = 'tampered' WHERE organization_id = 'org-active' AND key = 'stripe.restrictedKey'`);
    expect(await reader.read('studio', 'live')).toEqual(inherited(true, null));
  });
});
