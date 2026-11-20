import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { organizationMembers, organizations, products, tenantAdmins, tenantAuditEvents, tenants } from '#adapters/db/schema.js';
import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import type { Identity } from '#core/domain/index.js';
import {
  buildTenantSecret,
  getPaymentConfig,
  getTenantSecretsMasked,
  getTenantSettings,
  linkOrganizationWorkspace,
  organizationContext,
  startCheckoutSession,
  unlinkOrganizationWorkspace,
  validateCheckoutSelection,
  type PaymentProvider,
} from '#core/server/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const at = '2026-11-15T12:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;

const ownerIdentity: Identity = {
  userId: 'owner-1', email: 'owner-1@example.test', name: 'Owner', emailVerified: true, image: null,
  tenantAccess: 'staff', tenantId: 'acme', tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
};

beforeAll(async () => {
  database = await createTestDatabase('together_organization_link_golden_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost', PAYMENT_PROVIDER: 'fake',
    BETTER_AUTH_SECRET: 'organization-link-golden-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => at } });
  app = buildApp(deps);
  await database.db.insert(tenants).values({
    id: 'acme', slug: 'acme', name: 'Acme', createdAt: at, invoiceSellerName: 'Acme Ltd', invoiceSellerAddress: 'Main Street 1',
    analyticsTagId: 'G-ACME123', shippingRates: [], supportEmail: 'support@example.test',
  });
  await database.db.insert(tenantAdmins).values({ id: 'grant-owner', tenantId: 'acme', userId: 'owner-1', role: 'owner' });
  await database.db.insert(organizations).values({ id: 'org-1', slug: 'holding', name: 'Holding', maxWorkspaces: 3, createdAt: at, updatedAt: at });
  await database.db.insert(organizationMembers).values({
    id: 'member-owner', organizationId: 'org-1', userId: 'owner-1', role: 'owner', createdAt: at, createdByUserId: 'operator',
  });
  await database.db.insert(products).values({
    id: 'product-1', tenantId: 'acme', type: 'digital_download', description: '', slug: 'guide', title: 'Guide',
    priceCents: 4900, currency: 'PLN', published: true, accessItems: [], vatRate: 23, createdAt: at,
  });
  let next = 0;
  const secretDeps = { secretCrypto: deps.secretCrypto, ids: { nextId: () => `secret-${++next}` }, clock: deps.clock };
  await deps.tenantSecrets.upsertMany('acme', [
    buildTenantSecret('acme', 'stripe.restrictedKey', 'rk_live_goldenlivekey0001', secretDeps),
    buildTenantSecret('acme', 'stripe.webhookSecret', 'whsec_goldenlivesecret0001', secretDeps),
    buildTenantSecret('acme', 'stripe.webhookEndpointId', 'we_golden0001', secretDeps),
    buildTenantSecret('acme', 'stripe.testRestrictedKey', 'rk_test_goldentestkey0001', secretDeps),
    buildTenantSecret('acme', 'stripe.testWebhookSecret', 'whsec_goldentestsecret0001', secretDeps),
  ]);
}, 120_000);
afterAll(async () => { await database?.close(); });

const checkoutRun = async (run: string) => {
  const requests: Array<Parameters<PaymentProvider['createCheckoutSession']>[0]> = [];
  let next = 0;
  const checkoutDeps = {
    ...deps,
    ids: { nextId: () => `${run}-${++next}` },
    payment: {
      ...deps.payment,
      createCheckoutSession: async (input: Parameters<PaymentProvider['createCheckoutSession']>[0]) => {
        requests.push(input);
        return deps.payment.createCheckoutSession(input);
      },
    },
  };
  const input = { productId: 'product-1', email: 'buyer@example.test', language: 'en' as const, attribution: { utmSource: 'newsletter' } };
  const selection = await validateCheckoutSelection('acme', input, checkoutDeps);
  if (!selection.ok) throw new Error(selection.error.message);
  const tenant = await deps.tenants.findById('acme');
  if (tenant === null) throw new Error('Tenant fixture missing');
  const session = await startCheckoutSession(tenant, `${baseUrl}/acme`, input, selection.value, checkoutDeps, `${run}-consent`);
  const normalize = (value: unknown) => JSON.stringify(value).replaceAll(run, 'RUN').replaceAll(/cs_fake_[0-9a-f-]+/g, 'cs_fake_SESSION');
  return { requests: normalize(requests), session: normalize(session) };
};

const snapshot = async (run: string) => {
  const ctx = { identity: ownerIdentity };
  const payment = await app.request(new URL(API_PATHS.publicPaymentConfig, baseUrl).toString(), { headers: { [TENANT_HEADER]: 'acme' } });
  return JSON.stringify({
    tenant: await deps.tenants.findById('acme'),
    rawSettings: await deps.tenants.findSettings('acme'),
    settings: await getTenantSettings(ctx, deps),
    maskedSecrets: await getTenantSecretsMasked(ctx, deps),
    paymentConfig: { live: await getPaymentConfig('acme', deps), test: await getPaymentConfig('acme', deps, 'test') },
    publicPaymentConfig: { status: payment.status, body: await payment.text() },
    checkout: await checkoutRun(run),
  });
};

describe('linking a workspace to an organization', () => {
  it('leaves settings, masked secrets, payment configuration and checkout byte-identical', async () => {
    const before = await snapshot('before');
    expect(before).toContain('"stripeConfigured":true');
    expect(before).toContain('cs_fake_SESSION');

    const octx = await organizationContext({ identity: ownerIdentity }, 'org-1', deps);
    if (!octx.ok) throw new Error(octx.error.message);
    expect(await linkOrganizationWorkspace(octx.value, { organizationId: 'org-1', tenantId: 'acme' }, deps))
      .toMatchObject({ ok: true, value: { changed: true } });
    expect((await database.db.select({ organizationId: tenants.organizationId }).from(tenants))[0]?.organizationId).toBe('org-1');

    expect(await snapshot('after')).toBe(before);

    expect(await unlinkOrganizationWorkspace(octx.value, { organizationId: 'org-1', tenantId: 'acme' }, deps))
      .toMatchObject({ ok: true, value: { changed: true } });
    expect((await database.db.select().from(tenantAuditEvents)).map(({ kind, reason }) => [kind, reason]))
      .toEqual([['organization.linked', 'org-1'], ['organization.unlinked', 'org-1']]);
    expect(await snapshot('unlinked')).toBe(before);
  });
});
