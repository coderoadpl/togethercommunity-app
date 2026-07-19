import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { API_PATHS, TENANT_HEADER } from '@core/contract/index.js';
import { BETTER_AUTH_MAGIC_LINK_PATH } from '@adapters/auth/create-auth.js';
import type { AppDeps } from './composition.js';
import { buildApp } from './app.js';
import {
  MAGIC_LINK_LANGUAGE_HEADER,
  ok,
  type Member,
  type Membership,
  type Product,
  type Tenant,
  type TenantDomain,
} from '@core/domain/index.js';

const acme: Tenant = { id: 't-acme', slug: 'acme', name: 'Acme', contentVersion: 4 };
const globex: Tenant = { id: 't-globex', slug: 'globex', name: 'Globex', contentVersion: 2 };

const product = (input: {
  id: string;
  tenantId: string;
  title: string;
  published: boolean;
}): Product => ({
  id: input.id,
  tenantId: input.tenantId,
  title: input.title,
  description: '',
  priceCents: 1000,
  currency: 'PLN',
  published: input.published,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
});

const deps = (input: {
  tenants?: Tenant[];
  domains?: TenantDomain[];
  products?: Product[];
  authenticated?: boolean;
} = {}): AppDeps => {
  const tenants = input.tenants ?? [acme, globex];
  const domains = input.domains ?? [];
  const products = input.products ?? [
    product({ id: 'acme-published', tenantId: 't-acme', title: 'Acme Published', published: true }),
    product({ id: 'acme-draft', tenantId: 't-acme', title: 'Acme Draft', published: false }),
    product({ id: 'globex-published', tenantId: 't-globex', title: 'Globex Published', published: true }),
  ];
  const memberships: Membership[] = [];
  const members: Member[] = [];
  return {
    auth: {
      handler: async () => new Response(null, { status: 404 }),
      setMagicLinkDeliveryContext: () => undefined,
      setResetPasswordDeliveryContext: () => undefined,
    },
    authPort: {
      getAuthenticatedUser: async () => {
        if (!input.authenticated) throw new Error('Public route must not authenticate');
        return null;
      },
      ensureUser: async () => ({ userId: 'user-id', created: true }),
      requestMagicLink: async () => undefined,
      createEnrollmentMagicLink: async () => ({ url: 'https://example.com/magic' }),
    },
    members: {
      findById: async () => null,
      findByEmail: async () => null,
      listWithProductIds: async () => [],
      create: async () => undefined,
      updateEmail: async () => null,
      delete: async () => false,
    },
    grants: {
      findById: async () => null,
      findGrant: async () => null,
      createGrant: async () => true,
      setGrantWindow: async () => null,
      revokeGrant: async () => null,
      listForMemberWithProductNames: async () => [],
      listActiveForMember: async () => [],
      listGrantedProducts: async () => [],
    },
    prices: {
      listByProduct: async () => [],
      listActiveByProducts: async () => [],
      findById: async () => null,
      create: async () => undefined,
      setActive: async () => null,
    },
    orders: {
      create: async () => undefined,
      list: async () => ({ orders: [], total: 0 }),
      revenueSince: async () => [],
      countSince: async () => 0,
    },
    subscriptions: {
      findById: async () => null,
      findByProviderSubscriptionId: async () => null,
      listForMember: async () => [],
      create: async () => undefined,
      update: async () => null,
      countActive: async () => 0,
    },
    tenantApiKeys: {
      listByTenant: async () => [],
      create: async () => undefined,
      findActiveByHash: async () => null,
      revoke: async () => null,
    },
    apiKeyCrypto: {
      generateSecret: () => 'secret',
      hash: (secret) => `hash:${secret}`,
    },
    tenantSecrets: {
      listByTenant: async () => [],
      findByKey: async () => null,
      upsert: async (_tenantId, secret) => secret,
      delete: async () => false,
    },
    secretCrypto: {
      encrypt: () => ({ ciphertext: 'cipher', iv: 'iv', authTag: 'tag' }),
      decrypt: () => ok('plaintext'),
    },
    secretResolver: {
      resolve: async () => ok('plaintext'),
    },
    payment: {
      createCheckoutSession: async () => ok({ url: 'https://checkout.local/cs', sessionId: 'cs' }),
      expireCheckoutSession: async () => ok({ expired: true }),
      verifyWebhookEvent: async () => ok({ id: 'evt', type: 'test', objectId: null, checkoutSession: null }),
    },
    videoLibrary: {
      listVideos: async () => ok({ videos: [], totalItems: 0 }),
    },
    processedPaymentEvents: {
      claim: async () => true,
      release: async () => undefined,
    },
    purchases: {
      createMemberGrant: async (purchase) => ({
        member: {
          id: purchase.memberId,
          tenantId: purchase.tenantId,
          userId: purchase.userId,
          email: purchase.email,
          displayName: null,
          tags: [],
          marketingConsents: {},
          externalCustomerIds: {},
          createdAt: purchase.createdAt,
        },
        grantCreated: true,
      }),
    },
    email: {
      send: async () => ({ ok: true, value: { messageId: null } }),
    },
    devEmails: {
      findByRecipient: async () => null,
    },
    devMagicLinks: {
      findByEmail: async () => null,
    },
    products: {
      listByTenant: async (tenantId) => products.filter((candidate) => candidate.tenantId === tenantId),
      listPublishedByTenant: async (tenantId) =>
        products.filter((candidate) => candidate.tenantId === tenantId && candidate.published),
      findById: async (tenantId, id) =>
        products.find((candidate) => candidate.tenantId === tenantId && candidate.id === id) ?? null,
      create: async () => undefined,
      updateAccessItems: async () => null,
      setPublished: async () => undefined,
      bumpContentVersion: async () => undefined,
    },
    courses: {
      list: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    modules: {
      list: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    lessons: {
      list: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    entityVersions: {
      list: async () => [],
      findById: async () => null,
    },
    userDisplays: {
      findDisplayNames: async () => new Map(),
    },
    progress: {
      findByMemberAndCourse: async () => null,
      listByMember: async () => [],
      findOrCreate: async (_tenantId, input) => ({
        id: input.id,
        tenantId: _tenantId,
        memberId: input.memberId,
        courseId: input.courseId,
        completedLessonIds: [],
        updatedAt: input.now,
      }),
      update: async (_tenantId, progress) => progress,
      countReferencingLesson: async () => 0,
    },
    posts: {
      createPost: async (_tenantId, post) => post,
      findById: async () => null,
      listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
      listReplies: async () => [],
      updateBody: async () => null,
      softDelete: async () => null,
      search: async () => [],
    },
    spaces: {
      list: async () => [],
      findById: async () => null,
      findBySlug: async () => null,
      create: async () => undefined,
      update: async () => null,
      setArchived: async () => null,
      delete: async () => false,
      stats: async () => new Map(),
    },
    reactions: {
      add: async () => true,
      remove: async () => false,
      summarize: async () => new Map(),
    },
    spaceSubscriptions: {
      follow: async () => undefined,
      unfollow: async () => false,
      listFollowersForSpace: async () => [],
      listForUser: async () => [],
    },
    threadSubscriptions: {
      upsert: async (tenantId, subscription) => ({
        tenantId,
        userId: subscription.userId,
        rootPostId: subscription.rootPostId,
        createdAt: subscription.createdAt,
        mutedAt: null,
      }),
      mute: async (tenantId, subscription) => ({
        tenantId,
        userId: subscription.userId,
        rootPostId: subscription.rootPostId,
        createdAt: subscription.mutedAt,
        mutedAt: subscription.mutedAt,
      }),
      listSubscribersForRoot: async () => [],
      listForUser: async () => [],
    },
    notifications: {
      insert: async (_tenantId, notification) => notification,
      listForRecipient: async () => ({ notifications: [], nextCursor: null }),
      markRead: async () => null,
      markAllRead: async () => 0,
      unreadCount: async () => 0,
    },
    notificationChannels: [],
    realtimeBus: {
      publish: () => undefined,
      subscribe: () => () => undefined,
    },
    links: {
      lessonDiscussionUrl: ({ lessonId }) => `http://localhost/my/lessons/${lessonId}`,
      spaceUrl: ({ spaceId }) => `http://localhost/my/spaces/${spaceId}`,
    },
    tenantDomains: {
      findByDomain: async (domain) => domains.find((candidate) => candidate.domain === domain) ?? null,
      listVerifiedDomains: async () => domains,
    },
    tenants: {
      findById: async (tenantId) => tenants.find((tenant) => tenant.id === tenantId) ?? null,
      findBySlug: async (slug) => tenants.find((tenant) => tenant.slug === slug) ?? null,
      findSettings: async (tenantId) =>
        tenants.some((tenant) => tenant.id === tenantId) ? { billingPortalUrl: null, bunnyStreamLibraryId: null } : null,
      updateSettings: async (_tenantId, settings) => settings,
      createTenantWithOwnerGrant: async (tenant) => ({
        id: tenant.tenant.id,
        slug: tenant.tenant.slug,
        name: tenant.tenant.name,
        contentVersion: 1,
      }),
    },
    onboardingState: {
      findDismissedAt: async () => null,
      dismiss: async () => undefined,
    },
    tenantAccess: {
      listTenantsForStaff: async () => memberships,
      findStaffGrant: async () => null,
      findMember: async (_userId, tenantId) =>
        members.find((candidate) => candidate.tenantId === tenantId) ?? null,
    },
    health: { pingDatabase: async () => true },
    ids: { nextId: () => 'id' },
    clock: { nowIso: () => '2026-07-12T00:00:00.000Z' },
    baseDomain: 'localhost',
    appBaseUrl: 'http://localhost:48730',
    devEndpoints: { simulatedPayments: false, exposeMagicLinks: false },
    authConfig: { googleEnabled: false },
  };
};

const requestPublicOffer = (app: ReturnType<typeof buildApp>, headers: Record<string, string>) =>
  app.request(API_PATHS.publicOffer, { headers });

describe('public offer route', () => {
  it('returns only published products with public CORS and cache headers', async () => {
    const app = buildApp(deps());

    const response = await requestPublicOffer(app, { host: 'acme.localhost:48730' });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(response.headers.get('vary')).toBe(`Host, ${TENANT_HEADER}`);
    expect(response.headers.get('etag')).toBe('W/"offer-t-acme-4"');
    expect(body).toMatchObject({
      ok: true,
      data: {
        tenant: { slug: 'acme', name: 'Acme' },
        contentVersion: 4,
        products: [{ id: 'acme-published', title: 'Acme Published' }],
      },
    });
    expect(JSON.stringify(body)).not.toContain('acme-draft');
    expect(JSON.stringify(body)).not.toContain('"published":');
  });

  it('round-trips ETag through If-None-Match as 304', async () => {
    const app = buildApp(deps());
    const first = await requestPublicOffer(app, { host: 'acme.localhost:48730' });
    const etag = first.headers.get('etag') ?? '';

    const second = await requestPublicOffer(app, {
      host: 'acme.localhost:48730',
      'if-none-match': etag,
    });

    expect(second.status).toBe(304);
    expect(second.headers.get('etag')).toBe(etag);
    expect(second.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('selects the tenant from x-tenant on the base domain', async () => {
    const app = buildApp(deps());

    const response = await requestPublicOffer(app, {
      host: 'localhost:48730',
      [TENANT_HEADER]: 'globex',
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        tenant: { slug: 'globex', name: 'Globex' },
        products: [{ id: 'globex-published' }],
      },
    });
  });

  it('returns a 404 envelope for an unknown tenant', async () => {
    const app = buildApp(deps());

    const response = await requestPublicOffer(app, { host: 'missing.localhost:48730' });
    const body: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });

  it('handles OPTIONS before auth middleware', async () => {
    const app = buildApp(deps());

    const response = await app.request(API_PATHS.publicOffer, { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });
});

describe('public auth-config route', () => {
  it('reports Google disabled with public CORS headers when no credentials are configured', async () => {
    const app = buildApp(deps());

    const response = await app.request(API_PATHS.authConfig);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(body).toMatchObject({
      ok: true,
      data: {
        googleEnabled: false,
        passkeysEnabled: true,
        totpEnabled: true,
        exposeMagicLinks: false,
      },
    });
  });

  it('reports Google enabled when the composition provides credentials', async () => {
    const app = buildApp({ ...deps(), authConfig: { googleEnabled: true } });

    const response = await app.request(API_PATHS.authConfig);
    const body: unknown = await response.json();

    expect(body).toMatchObject({ ok: true, data: { googleEnabled: true } });
  });
});

type RequestMagicLinkInput = Parameters<AppDeps['authPort']['requestMagicLink']>[0];
type DeliveryContext = Parameters<AppDeps['auth']['setMagicLinkDeliveryContext']>[1];

interface Captured {
  request: RequestMagicLinkInput | null;
  context: { email: string; context: DeliveryContext } | null;
}

const capturingApp = (): { app: ReturnType<typeof buildApp>; captured: Captured } => {
  const captured: Captured = { request: null, context: null };
  const base = deps();
  const app = buildApp({
    ...base,
    authPort: {
      ...base.authPort,
      requestMagicLink: async (input) => {
        captured.request = input;
      },
    },
    auth: {
      ...base.auth,
      setMagicLinkDeliveryContext: (email, context) => {
        captured.context = { email, context };
      },
    },
    devMagicLinks: {
      findByEmail: async (email) =>
        captured.request?.baseUrl === undefined
          ? null
          : {
              email,
              url: `${captured.request.baseUrl}/magic/verify?token=tok`,
              token: 'tok',
            },
    },
    devEndpoints: { simulatedPayments: true, exposeMagicLinks: true },
  });
  return { app, captured };
};

const purchase = (
  app: ReturnType<typeof buildApp>,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) =>
  app.request(API_PATHS.devSimulatePurchase, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('tenant-host magic links on checkout', () => {
  it('builds the verify link on the requesting tenant subdomain', async () => {
    const { app, captured } = capturingApp();

    const response = await purchase(
      app,
      { host: 'acme.localhost:48730' },
      { email: 'buyer@together.dev', productId: 'acme-published', language: 'en' },
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(captured.request?.baseUrl).toBe('http://acme.localhost:48730');
    expect(captured.request?.callbackURL).toBe('http://acme.localhost:48730');
    expect(captured.request?.language).toBe('en');
    const parsed = z.object({ data: z.object({ magicLink: z.object({ url: z.string() }) }) }).parse(body);
    expect(parsed.data.magicLink.url).toBe('http://acme.localhost:48730/magic/verify?token=tok');
    expect(new URL(parsed.data.magicLink.url).host).toBe('acme.localhost:48730');
  });

  it('keeps the base host when the tenant comes from the x-tenant header', async () => {
    const { app, captured } = capturingApp();

    const response = await purchase(
      app,
      { host: 'localhost:48730', [TENANT_HEADER]: 'globex' },
      { email: 'buyer@together.dev', productId: 'globex-published' },
    );

    expect(response.status).toBe(200);
    expect(captured.request?.baseUrl).toBe('http://localhost:48730');
    expect(captured.request?.language).toBe('pl');
  });
});

describe('tenant-host magic links on login', () => {
  it('sets the tenant name, language and host from the subdomain request', async () => {
    const { app, captured } = capturingApp();

    await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'acme.localhost:48730',
        [MAGIC_LINK_LANGUAGE_HEADER]: 'en',
      },
      body: JSON.stringify({ email: 'login@together.dev', callbackURL: 'http://acme.localhost:48730/my' }),
    });

    expect(captured.context?.email).toBe('login@together.dev');
    expect(captured.context?.context).toMatchObject({
      tenantName: 'Acme',
      language: 'en',
      mode: 'email',
      baseUrl: 'http://acme.localhost:48730',
    });
  });

  it('falls back to Polish and the base host on the bare domain', async () => {
    const { app, captured } = capturingApp();

    await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:48730' },
      body: JSON.stringify({ email: 'login@together.dev', callbackURL: 'http://localhost:48730/my' }),
    });

    expect(captured.context?.context).toMatchObject({
      language: 'pl',
      baseUrl: 'http://localhost:48730',
    });
    expect(captured.context?.context.tenantName).toBeUndefined();
  });
});
