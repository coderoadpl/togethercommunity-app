import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  checkoutConsentCaptures, checkoutSnapshots, couponCheckoutSessions, coupons, members, organizationSecrets, organizations, productPrices, products,
  productStock, salesLinks, stockReservations, tenantConfigSources, tenants,
} from '#adapters/db/schema.js';
import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import { err, ok, validation, type Identity, type Member, type StripeMode, type Tenant } from '#core/domain/index.js';
import {
  buildTenantSecret,
  getCreatorOnboarding,
  getOperatorTenantReadiness,
  getPaymentConfig,
  getTenantSecretsMasked,
  getTenantSetupReadiness,
  type PaymentProvider,
} from '#core/server/index.js';
import { workspaceOnlyPaymentSource } from '#core/server/testing/payment-source-fake.js';

import { buildApp } from './app.js';
import { createDeps, createPaymentSecretResolvers, stripePaymentProviderConfig, type AppDeps } from './composition.js';
import { envSchema } from './env.js';
import { operatorContext } from './marketing-worker-context.js';

const baseUrl = 'http://localhost:48730';
const at = '2026-11-25T12:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: AppDeps;

const WORKSPACES = ['acme', 'studio', 'akademia', 'linked-idle', 'wrong-mode', 'suspended-inheriting', 'bare'] as const;
type Workspace = typeof WORKSPACES[number];

const productId = (tenantId: Workspace, kind: 'guide' | 'free') =>
  `00000000-0000-4000-8000-${String(WORKSPACES.indexOf(tenantId) * 10 + (kind === 'guide' ? 1 : 2)).padStart(12, '0')}`;

const ORGANIZATION_PREVIEW = 'rk_live_…orgpreview';

const inherit = async (tenantId: Workspace, group: 'payments_live' | 'payments_test') => {
  await database.db.insert(tenantConfigSources).values({ tenantId, configGroup: group, source: 'organization', updatedAt: at, updatedByUserId: 'user-owner' });
};

const insertOrganizationKey = async (organizationId: string, key: 'stripe.restrictedKey' | 'stripe.testRestrictedKey', value: string) => {
  await database.db.insert(organizationSecrets).values({
    id: `org-secret-${organizationId}-${key}`, organizationId, key, ...deps.secretCrypto.encrypt(value), maskedPreview: ORGANIZATION_PREVIEW, updatedAt: at,
  });
};

const seedProduct = async (tenantId: Workspace, kind: 'guide' | 'free') => {
  const id = productId(tenantId, kind);
  const priceCents = kind === 'guide' ? 4900 : 0;
  await database.db.insert(products).values({
    id, tenantId, type: 'digital_download', description: '', slug: kind, title: kind === 'guide' ? 'Guide' : 'Free guide',
    priceCents, currency: 'PLN', published: true, accessItems: [], vatRate: 23, createdAt: at,
  });
  await database.db.insert(productPrices).values({
    id: `${id}-price`, tenantId, productId: id, kind: 'one_time', interval: null, amountCents: priceCents, currency: 'PLN', active: true, createdAt: at,
  });
  await database.db.insert(productStock).values({ tenantId, productId: id, onHand: 50, updatedAt: at });
};

const seedWorkspace = async (tenantId: Workspace, organizationId: string | null) => {
  await database.db.insert(tenants).values({
    id: tenantId, slug: tenantId, name: tenantId, createdAt: at, organizationId,
    termsUrl: `https://${tenantId}.example.test/terms`, privacyUrl: `https://${tenantId}.example.test/privacy`,
  });
  await seedProduct(tenantId, 'guide');
  await seedProduct(tenantId, 'free');
  await database.db.insert(salesLinks).values({
    id: `${tenantId}-link`, tenantId, slug: 'offer', title: 'Offer', heading: 'Offer', description: '', productIds: [productId(tenantId, 'guide')],
    active: true, listed: true, revision: 1, createdAt: at, updatedAt: at,
  });
  await database.db.insert(coupons).values({
    id: `${tenantId}-coupon`, tenantId, code: 'SAVE10', kind: 'percent', value: 10, scope: { kind: 'all' }, appliesTo: 'one_time', createdAt: at,
  });
  if (tenantId === 'bare') return;
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
  await database.db.insert(organizations).values([
    { id: 'org-active', slug: 'holding-active', name: 'Holding active', maxWorkspaces: 5, createdAt: at, updatedAt: at },
    { id: 'org-wrong-mode', slug: 'holding-wrong-mode', name: 'Holding wrong mode', maxWorkspaces: 5, createdAt: at, updatedAt: at },
    { id: 'org-suspended', slug: 'holding-suspended', name: 'Holding suspended', status: 'suspended', maxWorkspaces: 5, createdAt: at, updatedAt: at },
  ]);
  await seedWorkspace('acme', null);
  await seedWorkspace('studio', 'org-active');
  await seedWorkspace('akademia', 'org-active');
  await seedWorkspace('linked-idle', 'org-active');
  await seedWorkspace('wrong-mode', 'org-wrong-mode');
  await seedWorkspace('suspended-inheriting', 'org-suspended');
  await seedWorkspace('bare', null);
  await insertOrganizationKey('org-active', 'stripe.restrictedKey', 'rk_live_organizationkey');
  await insertOrganizationKey('org-wrong-mode', 'stripe.restrictedKey', 'rk_test_inlivegroupkey');
  await insertOrganizationKey('org-suspended', 'stripe.restrictedKey', 'rk_live_suspendedkey');
  await insertOrganizationKey('org-suspended', 'stripe.testRestrictedKey', 'rk_test_suspendedkey');
  await inherit('studio', 'payments_live');
  await inherit('akademia', 'payments_test');
  await inherit('wrong-mode', 'payments_live');
  await inherit('suspended-inheriting', 'payments_live');
  await inherit('suspended-inheriting', 'payments_test');
}, 120_000);
afterAll(async () => { await database?.close(); });

const calls = { provider: new Array<string>(), secretReads: new Array<string>(), sourceReads: new Array<string>() };

const resetCalls = () => {
  calls.provider.length = 0;
  calls.secretReads.length = 0;
  calls.sourceReads.length = 0;
};

const recordingDeps = (): AppDeps => {
  const ensureCouponPromotion = deps.payment.ensureCouponPromotion;
  const payment: PaymentProvider = {
    ...deps.payment,
    createCheckoutSession: async (input) => {
      calls.provider.push(`checkout:${input.tenantId}:${input.mode}`);
      return deps.payment.createCheckoutSession(input);
    },
    ...(ensureCouponPromotion === undefined ? {} : {
      ensureCouponPromotion: async (input: Parameters<typeof ensureCouponPromotion>[0]) => {
        calls.provider.push(`promotion:${input.tenantId}`);
        return ensureCouponPromotion(input);
      },
    }),
  };
  return {
    ...deps,
    payment,
    tenantSecrets: {
      ...deps.tenantSecrets,
      findByKey: async (tenantId, key) => {
        calls.secretReads.push(`${tenantId}:${key}`);
        return deps.tenantSecrets.findByKey(tenantId, key);
      },
      listByTenant: async (tenantId) => {
        calls.secretReads.push(`${tenantId}:*`);
        return deps.tenantSecrets.listByTenant(tenantId);
      },
    },
    paymentSource: {
      read: async (tenantId, mode) => {
        calls.sourceReads.push(`${tenantId}:${mode}`);
        return deps.paymentSource.read(tenantId, mode);
      },
    },
  };
};

const tenantOf = async (tenantId: Workspace): Promise<Tenant> => {
  const tenant = await deps.tenants.findById(tenantId);
  if (tenant === null) throw new Error('Tenant fixture missing');
  return tenant;
};

const staffSession = async (tenantId: Workspace, appDeps: AppDeps): Promise<{ deps: AppDeps; cookie: string }> => {
  const tenant = await tenantOf(tenantId);
  const userId = `${tenantId}-staff-user`;
  const email = `staff@${tenantId}.example.test`;
  const existingMember: Member = {
    id: `${tenantId}-staff-member`, tenantId, userId, email, displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {},
    createdAt: at, deletedAt: null, bannedAt: null, bannedReason: null, bannedByUserId: null, dmOptOutAt: null,
  };
  const session = deps.secretCrypto.encrypt(JSON.stringify({ userId, tenantId, expiresAt: Date.parse(at) + 60_000 }));
  return {
    cookie: `together_stripe_test=${encodeURIComponent(JSON.stringify(session))}`,
    deps: {
      ...appDeps,
      authPort: {
        ...appDeps.authPort,
        getAuthenticatedUser: async () => ({ sessionId: `${tenantId}-session`, userId, email, name: 'Staff', emailVerified: true, image: null }),
      },
      tenantAccess: {
        ...appDeps.tenantAccess,
        findStaffGrant: async () => ({ tenant, staffRole: 'owner', source: 'direct' }),
        findMember: async () => existingMember,
      },
    },
  };
};

type Attempt = 'product' | 'cart' | 'sales link' | 'direct sales link' | 'coupon' | 'free order' | 'staff test';

const attempt = async (kind: Attempt, tenantId: Workspace) => {
  const guide = productId(tenantId, 'guide');
  const buyer = { email: `buyer@${tenantId}.example.test`, language: 'en' as const };
  const body: Record<Exclude<Attempt, 'direct sales link'>, unknown> = {
    product: { productId: guide, ...buyer },
    cart: { lines: [{ productId: guide, quantity: 1 }], termsAccepted: true, ...buyer },
    'sales link': { productId: guide, salesLinkSlug: 'offer', ...buyer },
    coupon: { productId: guide, couponCode: 'SAVE10', ...buyer },
    'free order': { productId: productId(tenantId, 'free'), termsAccepted: true, ...buyer },
    'staff test': { productId: guide, language: 'en' },
  };
  const staff = kind === 'staff test' ? await staffSession(tenantId, recordingDeps()) : null;
  const app = buildApp(staff?.deps ?? recordingDeps());
  const origin = `http://${tenantId}.localhost:48730`;
  const headers = { [TENANT_HEADER]: tenantId, 'content-type': 'application/json', ...(staff === null ? {} : { cookie: staff.cookie, host: `${tenantId}.localhost:48730`, origin }) };
  const path = kind === 'direct sales link' ? API_PATHS.directSalesLinkCheckout.replace(':slug', 'offer') : API_PATHS.checkoutSession;
  const response = await app.request(new URL(path, baseUrl).toString(), {
    method: 'POST', headers, body: JSON.stringify(kind === 'direct sales link' ? {} : body[kind]),
  });
  return { status: response.status, body: await response.text() };
};

const countRows = async (tenantId: Workspace, rows: Promise<Array<{ tenantId: string }>>) =>
  (await rows).filter((row) => row.tenantId === tenantId).length;

const sideEffects = async (tenantId: Workspace) => ({
  consentCaptures: await countRows(tenantId, database.db.select({ tenantId: checkoutConsentCaptures.tenantId }).from(checkoutConsentCaptures)),
  members: await countRows(tenantId, database.db.select({ tenantId: members.tenantId }).from(members)),
  snapshots: await countRows(tenantId, database.db.select({ tenantId: checkoutSnapshots.tenantId }).from(checkoutSnapshots)),
  stockHolds: await countRows(tenantId, database.db.select({ tenantId: stockReservations.tenantId }).from(stockReservations)),
  couponSessions: await countRows(tenantId, database.db.select({ tenantId: couponCheckoutSessions.tenantId }).from(couponCheckoutSessions)),
  providerCalls: calls.provider.filter((call) => call.split(':')[1] === tenantId).length,
});

const NOTHING = { consentCaptures: 0, members: 0, snapshots: 0, stockHolds: 0, couponSessions: 0, providerCalls: 0 };

const difference = (after: typeof NOTHING, before: typeof NOTHING): typeof NOTHING => ({
  consentCaptures: after.consentCaptures - before.consentCaptures,
  members: after.members - before.members,
  snapshots: after.snapshots - before.snapshots,
  stockHolds: after.stockHolds - before.stockHolds,
  couponSessions: after.couponSessions - before.couponSessions,
  providerCalls: after.providerCalls - before.providerCalls,
});

describe('checkout routes of a workspace that inherits payments', () => {
  it.each<{ kind: Attempt; refused: Workspace; ordinary: Workspace; started: Partial<typeof NOTHING> }>([
    { kind: 'product', refused: 'studio', ordinary: 'linked-idle', started: { consentCaptures: 1, snapshots: 1, stockHolds: 1, providerCalls: 1 } },
    { kind: 'product', refused: 'suspended-inheriting', ordinary: 'acme', started: { consentCaptures: 1, snapshots: 1, stockHolds: 1, providerCalls: 1 } },
    { kind: 'product', refused: 'wrong-mode', ordinary: 'acme', started: { consentCaptures: 1, snapshots: 1, stockHolds: 1, providerCalls: 1 } },
    { kind: 'cart', refused: 'studio', ordinary: 'linked-idle', started: { consentCaptures: 1, snapshots: 1, stockHolds: 1, providerCalls: 1 } },
    { kind: 'sales link', refused: 'studio', ordinary: 'linked-idle', started: { consentCaptures: 1, snapshots: 1, stockHolds: 1, providerCalls: 1 } },
    { kind: 'direct sales link', refused: 'studio', ordinary: 'linked-idle', started: { snapshots: 1, stockHolds: 1, providerCalls: 1 } },
    { kind: 'coupon', refused: 'studio', ordinary: 'linked-idle', started: { consentCaptures: 1, couponSessions: 1, providerCalls: 2 } },
    { kind: 'free order', refused: 'studio', ordinary: 'linked-idle', started: { consentCaptures: 1, members: 1 } },
    { kind: 'staff test', refused: 'akademia', ordinary: 'linked-idle', started: { members: 1, providerCalls: 1 } },
  ])('refuses the $kind checkout of $refused before anything is recorded, and $ordinary starts it', async ({ kind, refused, ordinary, started }) => {
    resetCalls();
    const refusal = await attempt(kind, refused);
    expect(refusal.status).toBe(400);
    expect(refusal.body).toContain('Stripe is not configured for this tenant');
    expect(await sideEffects(refused)).toEqual(NOTHING);

    const before = await sideEffects(ordinary);
    const accepted = await attempt(kind, ordinary);
    expect({ kind, status: accepted.status }).toEqual({ kind, status: 200 });
    const after = await sideEffects(ordinary);
    expect(difference(after, before)).toMatchObject(started);
  });

  it('reads no payment secret for a free order of a workspace without a source row, and one source per paid check', async () => {
    resetCalls();
    expect((await attempt('free order', 'acme')).status).toBe(200);
    expect(calls.secretReads.filter((read) => read.includes(':stripe.') || read.endsWith(':*'))).toEqual([]);
    expect(calls.sourceReads).toEqual(['acme:live']);

    resetCalls();
    expect((await attempt('product', 'acme')).status).toBe(200);
    expect(calls.secretReads.toSorted()).toEqual(['acme:stripe.restrictedKey', 'acme:stripe.webhookSecret']);
    expect(calls.sourceReads).toEqual(['acme:live']);
  });
});

const publicPaymentConfig = async (tenantId: Workspace) => {
  const response = await buildApp(deps).request(new URL(API_PATHS.publicPaymentConfig, baseUrl).toString(), { headers: { [TENANT_HEADER]: tenantId } });
  return { status: response.status, body: await response.text() };
};

const configured = async (tenantId: Workspace, mode: StripeMode) => {
  const answer = await getPaymentConfig(tenantId, deps, mode);
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.value.stripeConfigured;
};

describe('payment configuration of a workspace that inherits payments', () => {
  it.each([
    { tenantId: 'acme', live: true, test: true },
    { tenantId: 'linked-idle', live: true, test: true },
    { tenantId: 'studio', live: false, test: true },
    { tenantId: 'akademia', live: true, test: false },
    { tenantId: 'wrong-mode', live: false, test: true },
    { tenantId: 'suspended-inheriting', live: false, test: false },
    { tenantId: 'bare', live: false, test: false },
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
});

const ownerContext = (tenantId: Workspace) => {
  const identity: Identity = {
    userId: `${tenantId}-owner`, email: `owner@${tenantId}.example.test`, name: 'Owner', emailVerified: true, image: null,
    tenantAccess: 'staff', tenantId, tenantSlug: tenantId, tenantName: tenantId, staffRole: 'owner', memberId: null,
    memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  };
  return { identity };
};

const readerAnswers = async (tenantId: Workspace, readerDeps: AppDeps) => {
  const ctx = ownerContext(tenantId);
  const onboarding = await getCreatorOnboarding(ctx, readerDeps);
  const setup = await getTenantSetupReadiness(ctx, {
    tenants: readerDeps.tenants, tenantSecrets: readerDeps.tenantSecrets, paymentSource: readerDeps.paymentSource, spaces: readerDeps.spaces, sesSettings: null,
  });
  const operator = await getOperatorTenantReadiness(operatorContext(), { slug: tenantId }, readerDeps);
  const masked = await getTenantSecretsMasked(ctx, readerDeps);
  if (!onboarding.ok || !setup.ok || !operator.ok || !masked.ok) throw new Error('A reader failed');
  return {
    onboardingPayments: onboarding.value.steps.find((step) => step.id === 'payments_configured')?.done,
    setupStripe: setup.value.items.find((item) => item.id === 'stripe')?.configured,
    operator: operator.value,
    masked: { stripeMode: masked.value.stripeMode, keys: masked.value.secrets.map((secret) => secret.key).toSorted(), stripeTestLastEventAt: masked.value.stripeTestLastEventAt },
    serialized: JSON.stringify({ onboarding, setup, operator, masked }),
  };
};

const STRIPE_KEYS = [
  'stripe.restrictedKey', 'stripe.testRestrictedKey', 'stripe.testWebhookEndpointId', 'stripe.testWebhookSecret', 'stripe.webhookEndpointId', 'stripe.webhookSecret',
];

const releasedOperatorReadinessSchema = z.object({
  tenantExists: z.boolean(),
  ownerGrantPresent: z.boolean(),
  storageConfigured: z.boolean(),
  lastProbeOk: z.boolean(),
  lastProbeAt: z.string().datetime().nullable(),
  stripeConfigured: z.boolean(),
  mode: z.enum(['live', 'test']).nullable(),
  webhookEndpointRegistered: z.boolean(),
  legalUrlsSet: z.boolean(),
  publishedProducts: z.number().int().nonnegative(),
}).strict();

describe('readiness readers of a workspace that inherits payments', () => {
  it.each(['acme', 'linked-idle'] as const)('answers %s, which has no source row, as the stored rows always did', async (tenantId) => {
    const effective = await readerAnswers(tenantId, deps);
    expect(effective.serialized).toBe((await readerAnswers(tenantId, { ...deps, paymentSource: workspaceOnlyPaymentSource })).serialized);
    expect(effective).toMatchObject({
      onboardingPayments: true, setupStripe: true,
      operator: {
        tenantExists: true, ownerGrantPresent: false, storageConfigured: false, lastProbeOk: false, lastProbeAt: null,
        stripeConfigured: true, mode: 'live', webhookEndpointRegistered: true, legalUrlsSet: true, publishedProducts: 2,
      },
      masked: { stripeMode: 'live', keys: STRIPE_KEYS, stripeTestLastEventAt: null },
    });
    expect(Object.keys(effective.operator)).toHaveLength(10);
  });

  it('derives every payment field of a workspace without a source row from the one list of rows it loaded', async () => {
    const listedEmpty: AppDeps = {
      ...deps,
      tenantSecrets: { ...deps.tenantSecrets, listByTenant: async () => [] },
    };
    expect(await readerAnswers('acme', listedEmpty)).toMatchObject({
      setupStripe: false,
      operator: { stripeConfigured: false, mode: null, webhookEndpointRegistered: false },
      masked: { stripeMode: null, keys: [] },
    });
  });

  it('reports an inherited live group as not configured although the workspace keeps its own live rows', async () => {
    const answers = await readerAnswers('studio', deps);
    expect(answers).toMatchObject({
      onboardingPayments: false, setupStripe: false,
      operator: { stripeConfigured: true, mode: 'test', webhookEndpointRegistered: true },
      masked: { stripeMode: 'live', keys: STRIPE_KEYS },
    });
    expect((await readerAnswers('studio', { ...deps, paymentSource: workspaceOnlyPaymentSource })).operator).toMatchObject({ mode: 'live' });
  });

  it('shows the mode of the organization key in the masked view of an inherited live group', async () => {
    expect(await readerAnswers('wrong-mode', deps)).toMatchObject({ masked: { stripeMode: 'test' }, operator: { mode: 'test' } });
    expect((await readerAnswers('wrong-mode', { ...deps, paymentSource: workspaceOnlyPaymentSource })).masked).toMatchObject({ stripeMode: 'live' });
  });

  it('reports an inherited test group without an organization test key as not configured and leaves live alone', async () => {
    expect(await readerAnswers('akademia', deps)).toMatchObject({
      onboardingPayments: true, setupStripe: true,
      operator: { stripeConfigured: true, mode: 'live', webhookEndpointRegistered: true },
      masked: { stripeMode: 'live' },
    });
  });

  it('reports a workspace inheriting both groups from a suspended organization as not configured anywhere', async () => {
    expect(await readerAnswers('suspended-inheriting', deps)).toMatchObject({
      onboardingPayments: false, setupStripe: false,
      operator: { stripeConfigured: false, mode: null, webhookEndpointRegistered: false },
      masked: { stripeMode: 'live' },
    });
  });

  it.each(['acme', 'studio', 'wrong-mode', 'suspended-inheriting'] as const)('answers the operator readiness of %s in the shape the released strict schema parses', async (tenantId) => {
    const { operator } = await readerAnswers(tenantId, deps);
    expect(releasedOperatorReadinessSchema.safeParse(JSON.parse(JSON.stringify(operator))).success).toBe(true);
  });

  it('adds no source, key material, preview or organization identifier to the workspace answers', async () => {
    for (const tenantId of ['studio', 'wrong-mode', 'suspended-inheriting'] as const) {
      const serialized = (await readerAnswers(tenantId, deps)).serialized;
      for (const leaked of ['org-', 'holding', 'organization', 'orgpreview', 'inlivegroupkey', 'suspendedkey', 'paymentSources']) {
        expect({ tenantId, leaked, found: serialized.includes(leaked) }).toEqual({ tenantId, leaked, found: false });
      }
    }
  });
});

describe('creator onboarding with local simulated payments', () => {
  const onboardingPayments = async (tenantId: Workspace, simulatedPayments: boolean) => {
    const answer = await getCreatorOnboarding(ownerContext(tenantId), { ...deps, devEndpoints: { simulatedPayments } });
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.value.steps.find((step) => step.id === 'payments_configured')?.done;
  };

  it('applies the simulation to the workspace source only', async () => {
    expect({
      bare: [await onboardingPayments('bare', false), await onboardingPayments('bare', true)],
      acme: [await onboardingPayments('acme', false), await onboardingPayments('acme', true)],
      studio: [await onboardingPayments('studio', false), await onboardingPayments('studio', true)],
      suspended: [await onboardingPayments('suspended-inheriting', false), await onboardingPayments('suspended-inheriting', true)],
    }).toEqual({ bare: [false, true], acme: [true, true], studio: [false, false], suspended: [false, false] });
  });
});

describe('the workspace webhook of a workspace that inherits payments', () => {
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

  it('wires the workspace own key resolver into the payment provider for its invoice lookups', async () => {
    const resolvers = createPaymentSecretResolvers(deps.tenantSecrets, database.db, deps.secretCrypto);
    const config = stripePaymentProviderConfig(resolvers);
    expect(config.workspaceResolver).toBe(resolvers.workspace);
    expect(config.resolver).toBe(resolvers.effective);
    expect(await config.workspaceResolver.resolve('studio', 'stripe.restrictedKey')).toEqual(ok('rk_live_studioownkey'));
    expect(await config.resolver.resolve('studio', 'stripe.restrictedKey')).toEqual(ok('rk_live_organizationkey'));
    expect(await config.workspaceResolver.resolve('acme', 'stripe.restrictedKey')).toEqual(await config.resolver.resolve('acme', 'stripe.restrictedKey'));
  });
});
