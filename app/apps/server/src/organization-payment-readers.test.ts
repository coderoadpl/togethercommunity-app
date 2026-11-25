import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  checkoutSnapshots, organizationSecrets, organizations, productPrices, products, productStock, salesLinks, stockReservations, tenantConfigSources, tenants,
} from '#adapters/db/schema.js';
import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import { err, validation, type Identity, type StripeMode } from '#core/domain/index.js';
import {
  buildTenantSecret,
  createDirectSalesLinkCheckout,
  getCreatorOnboarding,
  getOperatorTenantReadiness,
  getPaymentConfig,
  getTenantSecretsMasked,
  getTenantSetupReadiness,
  startCheckoutSession,
  validateCheckoutSelection,
  type PaymentProvider,
} from '#core/server/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';
import { operatorContext } from './marketing-worker-context.js';

const baseUrl = 'http://localhost:48730';
const at = '2026-11-25T12:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;

type Workspace = 'acme' | 'studio' | 'akademia' | 'linked-idle' | 'suspended-inheriting';

const inherit = async (tenantId: Workspace, group: 'payments_live' | 'payments_test') => {
  await database.db.insert(tenantConfigSources).values({ tenantId, configGroup: group, source: 'organization', updatedAt: at, updatedByUserId: 'user-owner' });
};

const insertOrganizationKey = async (organizationId: string, key: 'stripe.restrictedKey' | 'stripe.testRestrictedKey', value: string) => {
  await database.db.insert(organizationSecrets).values({
    id: `org-secret-${organizationId}-${key}`, organizationId, key, ...deps.secretCrypto.encrypt(value), maskedPreview: '***', updatedAt: at,
  });
};

const seedWorkspace = async (tenantId: Workspace, organizationId: string | null) => {
  await database.db.insert(tenants).values({
    id: tenantId, slug: tenantId, name: tenantId, createdAt: at, organizationId,
    termsUrl: `https://${tenantId}.example.test/terms`, privacyUrl: `https://${tenantId}.example.test/privacy`,
  });
  await database.db.insert(products).values({
    id: `${tenantId}-guide`, tenantId, type: 'digital_download', description: '', slug: 'guide', title: 'Guide',
    priceCents: 4900, currency: 'PLN', published: true, accessItems: [], vatRate: 23, createdAt: at,
  });
  await database.db.insert(productPrices).values({
    id: `${tenantId}-guide-price`, tenantId, productId: `${tenantId}-guide`, kind: 'one_time', interval: null,
    amountCents: 4900, currency: 'PLN', active: true, createdAt: at,
  });
  await database.db.insert(productStock).values({ tenantId, productId: `${tenantId}-guide`, onHand: 5, updatedAt: at });
  await database.db.insert(salesLinks).values({
    id: `${tenantId}-link`, tenantId, slug: 'offer', title: 'Offer', heading: 'Offer', description: '', productIds: [`${tenantId}-guide`],
    active: true, listed: true, revision: 1, createdAt: at, updatedAt: at,
  });
  let next = 0;
  const secretDeps = { secretCrypto: deps.secretCrypto, ids: { nextId: () => `${tenantId}-secret-${++next}` }, clock: deps.clock };
  await deps.tenantSecrets.upsertMany(tenantId, [
    buildTenantSecret(tenantId, 'stripe.restrictedKey', `rk_live_${tenantId}ownkey`, secretDeps),
    buildTenantSecret(tenantId, 'stripe.webhookSecret', `whsec_${tenantId}live`, secretDeps),
    buildTenantSecret(tenantId, 'stripe.webhookEndpointId', `we_${tenantId}live`, secretDeps),
    buildTenantSecret(tenantId, 'stripe.testRestrictedKey', `rk_test_${tenantId}ownkey`, secretDeps),
    buildTenantSecret(tenantId, 'stripe.testWebhookSecret', `whsec_${tenantId}test`, secretDeps),
    buildTenantSecret(tenantId, 'stripe.testWebhookEndpointId', `we_${tenantId}test`, secretDeps),
  ]);
};

beforeAll(async () => {
  database = await createTestDatabase('together_organization_payment_readers_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost', PAYMENT_PROVIDER: 'fake',
    BETTER_AUTH_SECRET: 'organization-payment-readers-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => at } });
  app = buildApp(deps);
  await database.db.insert(organizations).values([
    { id: 'org-active', slug: 'holding-active', name: 'Holding active', maxWorkspaces: 5, createdAt: at, updatedAt: at },
    { id: 'org-suspended', slug: 'holding-suspended', name: 'Holding suspended', status: 'suspended', maxWorkspaces: 5, createdAt: at, updatedAt: at },
  ]);
  await seedWorkspace('acme', null);
  await seedWorkspace('studio', 'org-active');
  await seedWorkspace('akademia', 'org-active');
  await seedWorkspace('linked-idle', 'org-active');
  await seedWorkspace('suspended-inheriting', 'org-suspended');
  await insertOrganizationKey('org-active', 'stripe.restrictedKey', 'rk_live_organizationkey');
  await insertOrganizationKey('org-suspended', 'stripe.restrictedKey', 'rk_live_suspendedkey');
  await insertOrganizationKey('org-suspended', 'stripe.testRestrictedKey', 'rk_test_suspendedkey');
  await inherit('studio', 'payments_live');
  await inherit('akademia', 'payments_test');
  await inherit('suspended-inheriting', 'payments_live');
  await inherit('suspended-inheriting', 'payments_test');
}, 120_000);
afterAll(async () => { await database?.close(); });

const providerCalls: string[] = [];

const recordingDeps = () => {
  const payment: PaymentProvider = {
    ...deps.payment,
    createCheckoutSession: async (input) => {
      providerCalls.push(`checkout:${input.tenantId}:${input.mode}`);
      return deps.payment.createCheckoutSession(input);
    },
  };
  return { ...deps, payment, logger: { warn: () => undefined, error: () => undefined } };
};

const startedRows = async (tenantId: Workspace) => ({
  snapshots: (await database.db.select({ tenantId: checkoutSnapshots.tenantId }).from(checkoutSnapshots))
    .filter((row) => row.tenantId === tenantId).length,
  holds: (await database.db.select({ tenantId: stockReservations.tenantId, status: stockReservations.status }).from(stockReservations))
    .filter((row) => row.tenantId === tenantId && row.status === 'active').length,
  providerCalls: providerCalls.filter((call) => call.startsWith(`checkout:${tenantId}:`)).length,
});

const publicCheckout = async (tenantId: Workspace) => {
  const checkoutDeps = recordingDeps();
  const input = { productId: `${tenantId}-guide`, email: 'buyer@example.test', language: 'en' as const };
  const selection = await validateCheckoutSelection(tenantId, input, checkoutDeps);
  if (!selection.ok) throw new Error(selection.error.message);
  const tenant = await deps.tenants.findById(tenantId);
  if (tenant === null) throw new Error('Tenant fixture missing');
  return startCheckoutSession(tenant, `${baseUrl}/${tenantId}`, input, selection.value, checkoutDeps, `${tenantId}-consent`);
};

const directCheckout = async (tenantId: Workspace) => {
  const tenant = await deps.tenants.findById(tenantId);
  if (tenant === null) throw new Error('Tenant fixture missing');
  return createDirectSalesLinkCheckout(tenant, `${baseUrl}/${tenantId}`, {
    slug: 'offer',
    termsAcceptanceMessage: ({ termsUrl, privacyUrl }) => `I accept ${termsUrl} and ${privacyUrl}`,
    couponDisclosureMessage: () => 'Lowest price',
  }, recordingDeps());
};

const publicPaymentConfig = async (tenantId: Workspace) => {
  const response = await app.request(new URL(API_PATHS.publicPaymentConfig, baseUrl).toString(), { headers: { [TENANT_HEADER]: tenantId } });
  return { status: response.status, body: await response.text() };
};

const configured = async (tenantId: Workspace, mode: StripeMode) => {
  const answer = await getPaymentConfig(tenantId, deps, mode);
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.value.stripeConfigured;
};

describe('payment configuration readers for a workspace that inherits payments', () => {
  it.each([
    { tenantId: 'acme', live: true, test: true },
    { tenantId: 'linked-idle', live: true, test: true },
    { tenantId: 'studio', live: false, test: true },
    { tenantId: 'akademia', live: true, test: false },
    { tenantId: 'suspended-inheriting', live: false, test: false },
  ] as const)('reports $tenantId as live $live and test $test', async ({ tenantId, live, test }) => {
    expect({ live: await configured(tenantId, 'live'), test: await configured(tenantId, 'test') }).toEqual({ live, test });
  });

  it('answers the public payment configuration of an inheriting workspace as not configured', async () => {
    const answer = await publicPaymentConfig('studio');
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('"stripeConfigured":false');
    expect(answer.body).not.toContain('organization');
    expect((await publicPaymentConfig('linked-idle')).body).toContain('"stripeConfigured":true');
  });

  it.each(['studio', 'suspended-inheriting'] as const)('refuses the public checkout of %s and starts nothing', async (tenantId) => {
    expect(await publicCheckout(tenantId)).toMatchObject({ ok: false, error: { code: 'validation', message: 'Stripe is not configured for this tenant' } });
    expect(await startedRows(tenantId)).toEqual({ snapshots: 0, holds: 0, providerCalls: 0 });
  });

  it.each(['studio', 'suspended-inheriting'] as const)('refuses the direct sales-link checkout of %s and starts nothing', async (tenantId) => {
    expect(await directCheckout(tenantId)).toMatchObject({ ok: false, error: { code: 'validation', message: 'Stripe is not configured for this tenant' } });
    expect(await startedRows(tenantId)).toEqual({ snapshots: 0, holds: 0, providerCalls: 0 });
  });

  it('keeps checkout working for workspaces whose live group is not inherited', async () => {
    for (const tenantId of ['acme', 'linked-idle', 'akademia'] as const) {
      expect(await publicCheckout(tenantId)).toMatchObject({ ok: true, value: { free: false } });
      expect(await directCheckout(tenantId)).toMatchObject({ ok: true });
      expect(await startedRows(tenantId)).toEqual({ snapshots: 2, holds: 2, providerCalls: 2 });
    }
  });
});

const ownerContext = (tenantId: Workspace) => {
  const identity: Identity = {
    userId: `${tenantId}-owner`, email: `owner@${tenantId}.example.test`, name: 'Owner', emailVerified: true, image: null,
    tenantAccess: 'staff', tenantId, tenantSlug: tenantId, tenantName: tenantId, staffRole: 'owner', memberId: null,
    memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  };
  return { identity };
};

const readerAnswers = async (tenantId: Workspace, readerDeps: typeof deps) => {
  const ctx = ownerContext(tenantId);
  const onboarding = await getCreatorOnboarding(ctx, readerDeps);
  const setup = await getTenantSetupReadiness(ctx, {
    tenants: readerDeps.tenants, tenantSecrets: readerDeps.tenantSecrets, paymentConfig: readerDeps.paymentConfig, spaces: readerDeps.spaces, sesSettings: null,
  });
  const operator = await getOperatorTenantReadiness(operatorContext(), { slug: tenantId }, readerDeps);
  const masked = await getTenantSecretsMasked(ctx, readerDeps);
  if (!onboarding.ok || !setup.ok || !operator.ok || !masked.ok) throw new Error('A reader failed');
  return {
    onboardingPayments: onboarding.value.steps.find((step) => step.id === 'payments_configured')?.done,
    setupStripe: setup.value.items.find((item) => item.id === 'stripe')?.configured,
    operator: operator.value,
    masked: { stripeMode: masked.value.stripeMode, paymentSources: masked.value.paymentSources, previews: masked.value.secrets.length },
    payment: { live: await configured(tenantId, 'live'), test: await configured(tenantId, 'test') },
    serialized: JSON.stringify({ onboarding, setup, operator, masked }),
  };
};

const workspaceRuleDeps = () => ({ ...deps, paymentConfig: undefined });

describe('readiness readers for a workspace that inherits payments', () => {
  it.each(['acme', 'linked-idle'] as const)('answers %s, which has no source row, byte for byte as the workspace rule', async (tenantId) => {
    const effective = await readerAnswers(tenantId, deps);
    expect(effective.serialized).toBe((await readerAnswers(tenantId, workspaceRuleDeps())).serialized);
    expect(effective.serialized).not.toContain('paymentSources');
    expect(effective).toMatchObject({
      onboardingPayments: true, setupStripe: true,
      operator: { stripeConfigured: true, mode: 'live', webhookEndpointRegistered: true },
      masked: { stripeMode: 'live', paymentSources: undefined },
    });
  });

  it('reports an inherited live group as not configured although the workspace keeps its own live rows', async () => {
    const answers = await readerAnswers('studio', deps);
    expect(answers).toMatchObject({
      onboardingPayments: false, setupStripe: false,
      operator: { stripeConfigured: true, mode: 'test', webhookEndpointRegistered: true, paymentSources: { live: 'organization', test: 'workspace' } },
      masked: { stripeMode: 'live', paymentSources: { live: 'organization', test: 'workspace' }, previews: 6 },
    });
    expect((await readerAnswers('studio', workspaceRuleDeps())).operator).toMatchObject({ mode: 'live' });
  });

  it('reports an inherited test group without an organization test key as not configured and leaves live alone', async () => {
    expect(await readerAnswers('akademia', deps)).toMatchObject({
      onboardingPayments: true, setupStripe: true,
      operator: { stripeConfigured: true, mode: 'live', webhookEndpointRegistered: true, paymentSources: { live: 'workspace', test: 'organization' } },
      masked: { stripeMode: 'live', paymentSources: { live: 'workspace', test: 'organization' } },
      payment: { live: true, test: false },
    });
  });

  it('reports a workspace inheriting both groups from a suspended organization as not configured anywhere', async () => {
    expect(await readerAnswers('suspended-inheriting', deps)).toMatchObject({
      onboardingPayments: false, setupStripe: false,
      operator: { stripeConfigured: false, mode: null, webhookEndpointRegistered: false, paymentSources: { live: 'organization', test: 'organization' } },
      masked: { stripeMode: 'live', paymentSources: { live: 'organization', test: 'organization' } },
      payment: { live: false, test: false },
    });
  });

  it('adds no key material, preview or organization identifier to the workspace answers', async () => {
    const serialized = (await readerAnswers('studio', deps)).serialized;
    for (const leaked of ['org-active', 'holding', 'rk_live_organizationkey', 'organizationkey']) expect(serialized).not.toContain(leaked);
  });
});

describe('the workspace webhook route of a workspace that inherits payments', () => {
  it('verifies with the workspace own signing secret', async () => {
    const received: Array<Parameters<PaymentProvider['verifyWebhookEvent']>[0]> = [];
    const routed = buildApp({
      ...deps,
      payment: {
        ...deps.payment,
        verifyWebhookEvent: async (input) => {
          received.push(input);
          return err(validation('Stripe webhook signature verification failed'));
        },
      },
    });
    for (const tenantId of ['studio', 'acme'] as const) {
      const response = await routed.request(new URL(`/api/webhooks/stripe/${tenantId}`, baseUrl).toString(), {
        method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=unused', 'content-type': 'application/json' },
      });
      expect(response.status).toBe(400);
    }
    expect(received.map(({ tenantId, mode, webhookSecret }) => ({ tenantId, mode, webhookSecret }))).toEqual([
      { tenantId: 'studio', mode: 'live', webhookSecret: 'whsec_studiolive' },
      { tenantId: 'acme', mode: 'live', webhookSecret: 'whsec_acmelive' },
    ]);
  });
});
