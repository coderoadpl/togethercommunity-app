import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ok } from '#core/domain/index.js';
import type { TenantSecretResolver } from '#core/server/index.js';

import { createEffectiveTenantSecretResolver } from '../crypto/effective-tenant-secret-resolver.js';
import { createSecretCrypto } from '../crypto/secret-crypto.js';
import { createTenantSecretResolver } from '../crypto/tenant-secret-resolver.js';
import { createEffectiveTenantConfigReader } from '../db/organizations.js';
import { createTenantSecretRepository } from '../db/repositories.js';
import { organizationSecrets, organizations, tenantConfigSources, tenantSecrets, tenants } from '../db/schema.js';
import { createTestDatabase } from '../db/test-database-name.js';
import { createStripePaymentProvider, type StripePaymentProviderConfig } from './stripe.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const at = '2026-11-25T10:00:00.000Z';
const webhookSecret = 'whsec_studio_live';
const crypto = createSecretCrypto(Buffer.alloc(32, 5).toString('base64'));
const signer = new Stripe('sk_test_unused');

const renewalInvoice = JSON.stringify({
  id: 'evt_renewal', type: 'invoice.paid', api_version: '2025-09-30.clover', livemode: true,
  data: { object: {
    id: 'in_renewal', payments: { data: [] },
    parent: { subscription_details: { subscription: 'sub_1' } },
    amount_paid: 4900, amount_due: 4900, currency: 'pln',
    lines: { data: [{ period: { end: 916_387_200 } }] },
  } },
});

describe('invoice lookup while verifying an event delivered to a workspace endpoint', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  const authorizations: Array<string | null> = [];
  let workspaceResolver: TenantSecretResolver;
  let effectiveResolver: TenantSecretResolver;

  const encryptedRow = (owner: string, key: string, value: string) =>
    ({ id: `${owner}-${key}`, key, ...crypto.encrypt(value), maskedPreview: '***', updatedAt: at });

  beforeAll(async () => {
    database = await createTestDatabase('together_stripe_webhook_credentials_test', databaseUrl);
    await database.db.insert(organizations).values({ id: 'org-active', slug: 'holding', name: 'Holding', createdAt: at, updatedAt: at });
    await database.db.insert(tenants).values([
      { id: 'studio', slug: 'studio', name: 'Studio', createdAt: at, organizationId: 'org-active' },
      { id: 'acme', slug: 'acme', name: 'Acme', createdAt: at },
    ]);
    await database.db.insert(tenantSecrets).values(['studio', 'acme'].map((tenantId) =>
      ({ ...encryptedRow(tenantId, 'stripe.restrictedKey', `rk_live_${tenantId}own`), tenantId })));
    await database.db.insert(organizationSecrets).values({
      ...encryptedRow('org-active', 'stripe.restrictedKey', 'rk_live_organization'), organizationId: 'org-active',
    });
    await database.db.insert(tenantConfigSources).values({
      tenantId: 'studio', configGroup: 'payments_live', source: 'organization', updatedAt: at, updatedByUserId: 'user-owner',
    });
    workspaceResolver = createTenantSecretResolver(createTenantSecretRepository(database.db), crypto);
    effectiveResolver = createEffectiveTenantSecretResolver(workspaceResolver, createEffectiveTenantConfigReader(database.db), crypto);
  });

  afterAll(async () => { await database?.close(); });

  const providerWith = (config: Pick<StripePaymentProviderConfig, 'resolver' | 'workspaceResolver'>) => createStripePaymentProvider({
    ...config,
    clientFactory: (key) => new Stripe(key, {
      maxNetworkRetries: 0,
      httpClient: Stripe.createFetchHttpClient(async (input: string | URL | Request, init?: RequestInit) => {
        authorizations.push(new Request(input, init).headers.get('authorization'));
        return new Response(JSON.stringify({ id: 'in_renewal', payments: { data: [] } }), {
          status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_renewal' },
        });
      }),
    }),
  });

  const verify = (provider: ReturnType<typeof createStripePaymentProvider>, tenantId: string) => provider.verifyWebhookEvent({
    tenantId, mode: 'live', payloadRaw: renewalInvoice, webhookSecret,
    signatureHeader: signer.webhooks.generateTestHeaderString({ payload: renewalInvoice, secret: webhookSecret }),
  });

  it('looks the invoice up with the own key of an inheriting workspace, not the effective organization key', async () => {
    authorizations.length = 0;
    expect(await effectiveResolver.resolve('studio', 'stripe.restrictedKey')).toEqual(ok('rk_live_organization'));
    expect(await verify(providerWith({ resolver: effectiveResolver, workspaceResolver }), 'studio'))
      .toMatchObject({ ok: true, value: { objectId: 'in_renewal' } });
    expect(authorizations).toEqual(['Bearer rk_live_studioown']);
  });

  it('uses the same key as the previous wiring for a workspace without a source row', async () => {
    authorizations.length = 0;
    expect(await verify(providerWith({ resolver: effectiveResolver, workspaceResolver }), 'acme')).toMatchObject({ ok: true });
    expect(await verify(providerWith({ resolver: effectiveResolver }), 'acme')).toMatchObject({ ok: true });
    expect(authorizations).toEqual(['Bearer rk_live_acmeown', 'Bearer rk_live_acmeown']);
  });
});
