import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StripeMode } from '#core/domain/index.js';
import { createWorkspacePaymentConfigReader, type EffectivePaymentConfig } from '#core/server/index.js';

import { createSecretCrypto } from '../crypto/secret-crypto.js';
import { createEffectivePaymentConfigReader } from './effective-payment-config.js';
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

const notReady = (keyPresent: boolean, keyMode: StripeMode | null): EffectivePaymentConfig =>
  ({ source: 'organization', keyPresent, webhookReady: false, keyMode });

const workspaceReady = (keyMode: StripeMode): EffectivePaymentConfig =>
  ({ source: 'workspace', keyPresent: true, webhookReady: true, keyMode });

describe('effective payment configuration over the database', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let reader: ReturnType<typeof createEffectivePaymentConfigReader>;
  let workspaceRule: ReturnType<typeof createWorkspacePaymentConfigReader>;

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
    database = await createTestDatabase('together_effective_payment_config_test', databaseUrl);
    await database.db.execute(sql`INSERT INTO organizations (id, slug, name, status, created_at, updated_at) VALUES
      ('org-active', 'holding-active', 'Holding active', 'active', ${at}, ${at}),
      ('org-suspended', 'holding-suspended', 'Holding suspended', 'suspended', ${at}, ${at})`);
    await database.db.execute(sql`INSERT INTO tenants (id, slug, name, created_at, organization_id) VALUES
      ('acme', 'acme', 'Acme', ${at}, NULL),
      ('studio', 'studio', 'Studio', ${at}, 'org-active'),
      ('akademia', 'akademia', 'Akademia', ${at}, 'org-active'),
      ('linked-idle', 'linked-idle', 'Linked idle', ${at}, 'org-active'),
      ('linked-bare', 'linked-bare', 'Linked bare', ${at}, 'org-active'),
      ('suspended-inheriting', 'suspended-inheriting', 'Suspended inheriting', ${at}, 'org-suspended'),
      ('suspended-own', 'suspended-own', 'Suspended own', ${at}, 'org-suspended')`);
    for (const tenantId of ['acme', 'studio', 'akademia', 'linked-idle', 'suspended-inheriting', 'suspended-own']) {
      await insertTenantSecrets(tenantId, WORKSPACE_STRIPE_ROWS);
    }
    await insertOrganizationSecret('org-active', 'stripe.restrictedKey', 'rk_live_organizationkey');
    await insertOrganizationSecret('org-suspended', 'stripe.restrictedKey', 'rk_live_suspendedkey');
    await insertOrganizationSecret('org-suspended', 'stripe.testRestrictedKey', 'rk_test_suspendedkey');
    await inherit('studio', 'payments_live');
    await inherit('akademia', 'payments_test');
    await inherit('linked-bare', 'payments_live');
    await inherit('suspended-inheriting', 'payments_live');
    await inherit('suspended-inheriting', 'payments_test');
    reader = createEffectivePaymentConfigReader(database.db, crypto);
    workspaceRule = createWorkspacePaymentConfigReader(createTenantSecretRepository(database.db), crypto);
  });

  afterAll(async () => { await database?.close(); });

  it.each(['acme', 'linked-idle', 'suspended-own', 'unknown-workspace'])(
    'answers exactly the workspace rule for %s, which has no source row',
    async (tenantId) => {
      for (const mode of ['live', 'test'] as const) {
        expect({ mode, answer: await reader.read(tenantId, mode) }).toEqual({ mode, answer: await workspaceRule.read(tenantId, mode) });
      }
    },
  );

  it('reads the workspace key, signing secret and key mode per mode', async () => {
    expect(await reader.read('acme', 'live')).toEqual(workspaceReady('live'));
    expect(await reader.read('acme', 'test')).toEqual(workspaceReady('test'));
    expect(await reader.read('unknown-workspace', 'live'))
      .toEqual({ source: 'workspace', keyPresent: false, webhookReady: false, keyMode: null });
  });

  it('answers an inherited live group from the organization key and never from the retained workspace rows', async () => {
    expect(await reader.read('studio', 'live')).toEqual(notReady(true, 'live'));
    expect(await reader.read('studio', 'test')).toEqual(workspaceReady('test'));
  });

  it('answers an inherited test group without an organization test key as absent, while live stays on the workspace', async () => {
    expect(await reader.read('akademia', 'test')).toEqual(notReady(false, null));
    expect(await reader.read('akademia', 'live')).toEqual(workspaceReady('live'));
  });

  it('answers an inherited group for a workspace without rows of its own', async () => {
    expect(await reader.read('linked-bare', 'live')).toEqual(notReady(true, 'live'));
    expect(await reader.read('linked-bare', 'test'))
      .toEqual({ source: 'workspace', keyPresent: false, webhookReady: false, keyMode: null });
  });

  it('keeps a workspace of the same organization unaffected by another workspace source row', async () => {
    expect(await reader.read('linked-idle', 'live')).toEqual(workspaceReady('live'));
    expect(await reader.read('linked-idle', 'test')).toEqual(workspaceReady('test'));
  });

  it('answers an inheriting workspace of a suspended organization as not ready in both modes', async () => {
    expect(await reader.read('suspended-inheriting', 'live')).toEqual(notReady(true, 'live'));
    expect(await reader.read('suspended-inheriting', 'test')).toEqual(notReady(true, 'test'));
    expect(await reader.read('suspended-own', 'live')).toEqual(workspaceReady('live'));
  });

  it('reports an unreadable inherited key as present without a mode', async () => {
    await database.db.execute(sql`UPDATE organization_secrets SET ciphertext = 'tampered' WHERE organization_id = 'org-active' AND key = 'stripe.restrictedKey'`);
    expect(await reader.read('studio', 'live')).toEqual(notReady(true, null));
  });
});
