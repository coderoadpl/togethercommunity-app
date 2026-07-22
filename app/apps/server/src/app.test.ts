import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { API_PATHS, TENANT_HEADER } from '@core/contract/index.js';
import { BETTER_AUTH_MAGIC_LINK_PATH } from '@adapters/auth/create-auth.js';
import type { AppDeps, MarketingAppDeps } from './composition.js';
import { buildApp } from './app.js';
import {
  err,
  internal,
  MAGIC_LINK_LANGUAGE_HEADER,
  ok,
  type Member,
  type Membership,
  type Product,
  type Tenant,
  type TenantDomain,
  type TermsConsent,
} from '@core/domain/index.js';
import {
  FakeEmailHmac,
  FakeScheduler,
  FakeSesMarketingSender,
  FakeSnsVerifier,
  InMemoryAutomationIdempotencyRepository,
  InMemoryCampaignRepository,
  InMemoryCampaignSendRepository,
  InMemoryConsentConfirmationTokenRepository,
  InMemoryConsentDefinitionRepository,
  InMemoryEmailLayoutRepository,
  InMemoryMarketingAudienceRepository,
  InMemoryMarketingConsentRepository,
  InMemorySuppressionRepository,
  InMemoryTenantSesSettingsRepository,
  InMemoryUnsubscribeTokenRepository,
} from '@core/server/testing/marketing-fakes.js';

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
  databaseUp?: boolean;
  dispatchEmails?: AppDeps['dispatchEmails'];
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
    },
    memberErasure: {
      pseudonymize: async () => null,
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
    paymentRefunds: {
      findOrderByProviderObjectIds: async () => null,
      findLatestSubscriptionOrder: async () => null,
      listPaidOrdersForMemberProduct: async () => [],
      markOrderRefunded: async () => null,
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
    bunnyEmbedTokenSigner: {
      sign: ({ videoId, expires }) => `${videoId}-${expires}`,
    },
    fileUrlSigner: {
      presignGet: (input) => ok(input.url),
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
          deletedAt: null,
        },
        grantCreated: true,
      }),
    },
    email: {
      send: async () => ({ ok: true, value: { messageId: null } }),
    },
    emailOutbox: {
      enqueue: async (message) => ok({ id: message.id }),
      claimBatch: async () => ok([]),
      markSent: async () => ok(undefined),
      markFailed: async () => ok(undefined),
    },
    enrollmentTransaction: {
      run: async (operation) => operation({
        members: {
          findById: async (_tenantId, id) => members.find((member) => member.id === id) ?? null,
          findByEmail: async (_tenantId, email) => members.find((member) => member.email === email) ?? null,
          listWithProductIds: async () => [],
          create: async (_tenantId, member) => { members.push(member); },
          updateEmail: async () => null,
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
        emailOutbox: {
          enqueue: async (message) => ok({ id: message.id }),
          claimBatch: async () => ok([]),
          markSent: async () => ok(undefined),
          markFailed: async () => ok(undefined),
        },
      }),
    },
    dispatchEmails: input.dispatchEmails ?? (async () => ok({ attemptsMade: 0, sentCount: 0, failedCount: 0 })),
    dispatchEmail: () => undefined,
    emailDispatchSecret: 'test-email-dispatch-secret',
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
      lessonDiscussionUrl: ({ lessonId }) => `http://localhost/my/courses/c1/lessons/${lessonId}`,
      spaceUrl: ({ spaceId, rootPostId }) =>
        `http://localhost/community/${spaceId}${rootPostId === undefined ? '' : `/posts/${rootPostId}`}`,
    },
    tenantDomains: {
      findByDomain: async (domain) => domains.find((candidate) => candidate.domain === domain) ?? null,
      listVerifiedDomains: async () => domains,
    },
    tenants: {
      findById: async (tenantId) => tenants.find((tenant) => tenant.id === tenantId) ?? null,
      findBySlug: async (slug) => tenants.find((tenant) => tenant.slug === slug) ?? null,
      findSettings: async (tenantId) =>
        tenants.some((tenant) => tenant.id === tenantId) ? { billingPortalUrl: null, bunnyStreamLibraryId: null, logoUrl: null, accentColor: null, faviconUrl: null, termsUrl: null, privacyUrl: null } : null,
      updateSettings: async (_tenantId, settings) => settings,
      createTenantWithOwnerGrant: async (tenant) => ({
        id: tenant.tenant.id,
        slug: tenant.tenant.slug,
        name: tenant.tenant.name,
        contentVersion: 1,
      }),
    },
    consents: {
      record: async () => undefined,
      listByEmail: async () => [],
    },
    onboardingState: {
      findDismissedAt: async () => null,
      dismiss: async () => undefined,
    },
    tenantAccess: {
      listTenantsForStaff: async () => memberships,
      listStaffForTenant: async () => [],
      findStaffGrant: async () => null,
      findMember: async (_userId, tenantId) =>
        members.find((candidate) => candidate.tenantId === tenantId) ?? null,
    },
    health: { pingDatabase: async () => input.databaseUp ?? true },
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

const marketingDeps = (): MarketingAppDeps => ({
  definitions: new InMemoryConsentDefinitionRepository(),
  marketingConsents: new InMemoryMarketingConsentRepository(),
  confirmations: new InMemoryConsentConfirmationTokenRepository(),
  campaigns: new InMemoryCampaignRepository(),
  layouts: new InMemoryEmailLayoutRepository(),
  campaignSends: new InMemoryCampaignSendRepository(),
  audience: new InMemoryMarketingAudienceRepository(),
  suppressions: new InMemorySuppressionRepository(),
  unsubscribes: new InMemoryUnsubscribeTokenRepository(),
  sesSettings: new InMemoryTenantSesSettingsRepository(),
  documents: {
    create: async () => undefined,
    findById: async () => null,
    list: async () => [],
    listVersions: async () => [],
    saveDraft: async () => null,
    publishDraft: async () => null,
    findLatestPublished: async (tenantId, slug) => tenantId === 't-acme' && slug === 'terms' ? {
      document: { id: 'document-1', tenantId, slug, title: 'Terms', status: 'published', createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z' },
      version: { id: 'version-1', tenantId, documentId: 'document-1', version: 1, content: 'Immutable terms', publishedAt: '2026-07-22T00:00:00.000Z', createdAt: '2026-07-22T00:00:00.000Z', createdBy: 'staff' },
    } : null,
    findPublishedVersion: async () => null,
  },
  idempotency: new InMemoryAutomationIdempotencyRepository(),
  marketingSes: new FakeSesMarketingSender(),
  marketingCredentials: { resolve: async () => ok({ accessKeyId: 'key', secretAccessKey: 'secret', region: 'eu-central-1' }) },
  hmac: new FakeEmailHmac(),
  sns: new FakeSnsVerifier(ok({ type: 'Notification', topicArn: 'topic', message: '{}', subscribeUrl: null })),
  scheduler: new FakeScheduler(),
  tickSecret: 'test-marketing-tick-secret',
  dispatchCampaign: async () => ok({ leased: true, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 }),
});

const marketingApp = (marketing = marketingDeps()): ReturnType<typeof buildApp> => {
  const configured = deps();
  configured.marketing = marketing;
  configured.tenantApiKeys = {
    listByTenant: async () => [],
    create: async () => undefined,
    findActiveByHash: async (tenantId, hash) => tenantId === 't-acme' && hash === 'hash:marketing-key' ? {
      id: 'api-key-1', tenantId, name: 'Marketing', keyHash: hash,
      createdAt: '2026-07-22T00:00:00.000Z', revokedAt: null,
    } : null,
    revoke: async () => null,
  };
  return buildApp(configured);
};

const memberSurfaceMarketing = async (): Promise<MarketingAppDeps> => {
  const marketing = marketingDeps();
  await marketing.definitions.create('t-acme', {
    id: 'definition-news', tenantId: 't-acme', key: 'product-news', kind: 'optional_marketing',
    channel: 'email', doubleOptIn: true, documentRef: { mode: 'url', url: 'https://acme.test/privacy' },
    status: 'active', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
  }, {
    id: 'definition-news-v1', tenantId: 't-acme', definitionId: 'definition-news', version: 1,
    label: 'Product news', documentVersionRef: { mode: 'url', url: 'https://acme.test/privacy?v=1' },
    createdAt: '2026-07-01T00:00:00.000Z', createdBy: 'staff',
  });
  await marketing.marketingConsents.record('t-acme', {
    id: 'consent-news', tenantId: 't-acme', memberId: null, email: 'member@example.test',
    definitionId: 'definition-news', definitionVersion: 1, wordingSnapshot: 'Product news',
    documentRefSnapshot: { mode: 'url', url: 'https://acme.test/privacy?v=1' }, status: 'confirmed',
    previousId: null, source: 'api', evidence: { collectedAt: '2026-07-01T00:00:00.000Z', proofRef: 'form' },
    occurredAt: '2026-07-01T00:00:00.000Z',
  });
  await marketing.unsubscribes.create('t-acme', {
    id: 'unsubscribe-news', tenantId: 't-acme', token: 'unsubscribe_token_123456789012345',
    email: 'member@example.test', memberId: null, campaignSendId: null,
    scope: 'consent:definition-news', createdAt: '2026-07-01T00:00:00.000Z', usedAt: null,
  });
  await marketing.marketingConsents.record('t-acme', {
    id: 'consent-pending', tenantId: 't-acme', memberId: null, email: 'pending@example.test',
    definitionId: 'definition-news', definitionVersion: 1, wordingSnapshot: 'Product news',
    documentRefSnapshot: { mode: 'url', url: 'https://acme.test/privacy?v=1' }, status: 'granted',
    previousId: null, source: 'api', evidence: { collectedAt: '2026-07-01T00:00:00.000Z', proofRef: 'form' },
    occurredAt: '2026-07-01T00:00:00.000Z',
  });
  await marketing.confirmations.create('t-acme', {
    id: 'confirmation-news', tenantId: 't-acme', token: 'confirmation_token_123456789012345',
    marketingConsentRowId: 'consent-pending', createdAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-07-20T00:00:00.000Z', usedAt: null,
  });
  return marketing;
};

describe('marketing HTTP surfaces', () => {
  it('authenticates automation routes with the tenant API key and releases invalid idempotency claims', async () => {
    const marketing = marketingDeps();
    marketing.layouts = new InMemoryEmailLayoutRepository([{
      id: 'layout-1', tenantId: 't-acme', name: 'Default', bodyHtml: '<main>{{{content}}}</main>',
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    }]);
    const app = marketingApp(marketing);
    const headers = { host: 'acme.localhost:48730', 'x-api-key': 'marketing-key' };
    const templates = await app.request('/api/m2m/marketing/templates', { headers });
    expect(templates.status).toBe(200);
    expect(await templates.json()).toMatchObject({
      ok: true,
      data: { layouts: [{ id: 'layout-1', name: 'Default' }] },
    });
    expect((await app.request('/api/m2m/marketing/templates', { headers: { host: headers.host } })).status).toBe(401);
    const invalid = { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'same', 'content-type': 'application/json' }, body: '{}' };
    expect((await app.request('/api/m2m/marketing/messages', invalid)).status).toBe(400);
    expect((await app.request('/api/m2m/marketing/messages', invalid)).status).toBe(400);
  });

  it('returns 429 with Retry-After when the tenant SES throttle is under pressure', async () => {
    const marketing = marketingDeps();
    marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: '2026-07-22T00:00:00.000Z', configurationSet: null,
      snsTopicArn: null, webhookToken: 'webhook-token-123456789012', quotaRatePerSec: 1,
      quotaDaily: 1000, quotaRefreshedAt: '2026-07-22T00:00:00.000Z', inSandbox: false,
      webhookVerifiedAt: '2026-07-22T00:00:00.000Z', footerLegalName: 'Acme',
      footerAddress: 'Warsaw', broadcastsEnabled: true,
    }]);
    const response = await marketingApp(marketing).request('/api/m2m/marketing/messages', {
      method: 'POST',
      headers: { host: 'acme.localhost:48730', 'x-api-key': 'marketing-key', 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [
        { to: 'one@example.test', consentDefinitionId: 'definition-1', subject: 'One', bodyHtml: '<p>One</p>' },
        { to: 'two@example.test', consentDefinitionId: 'definition-1', subject: 'Two', bodyHtml: '<p>Two</p>' },
      ] }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });

  it('serves the latest published hosted document on the tenant domain', async () => {
    const response = await marketingApp().request('/legal/terms', { headers: { host: 'acme.localhost:48730' } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Immutable terms');
  });

  it('renders member preferences without mutating GET and returns a human confirmation after POST', async () => {
    const marketing = await memberSurfaceMarketing();
    const before = await marketing.marketingConsents.listByEmail('t-acme', 'member@example.test');
    const app = marketingApp(marketing);
    const get = await app.request('/u/unsubscribe_token_123456789012345?lang=en', {
      headers: { host: 'acme.localhost:48730' },
    });
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('Product news');
    expect(await marketing.marketingConsents.listByEmail('t-acme', 'member@example.test')).toEqual(before);
    const post = await app.request('/u/unsubscribe_token_123456789012345/confirm?lang=en', {
      method: 'POST', headers: { host: 'acme.localhost:48730' },
    });
    expect(post.status).toBe(200);
    expect(await post.text()).toContain('Unsubscribe confirmed');
    expect((await marketing.marketingConsents.listByEmail('t-acme', 'member@example.test')).at(-1)?.status).toBe('withdrawn');
  });

  it('keeps RFC one-click POST empty and renders DOI success and expired states', async () => {
    const marketing = await memberSurfaceMarketing();
    const oneClick = await marketingApp(marketing).request('/u/unsubscribe_token_123456789012345', {
      method: 'POST', headers: { host: 'acme.localhost:48730' },
    });
    expect(oneClick.status).toBe(200);
    expect(await oneClick.text()).toBe('');
    const app = marketingApp(await memberSurfaceMarketing());
    const success = await app.request('/marketing/confirm/confirmation_token_123456789012345?lang=en', {
      headers: { host: 'acme.localhost:48730' },
    });
    expect(await success.text()).toContain('Email address confirmed');
    const expired = await app.request('/marketing/confirm/missing_confirmation_token_123456?lang=en', {
      headers: { host: 'acme.localhost:48730' },
    });
    expect(await expired.text()).toContain('This link is no longer active');
  });

  it('acknowledges a verified SNS envelope from another tenant topic without processing it', async () => {
    const marketing = marketingDeps();
    marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: '2026-07-22T00:00:00.000Z', configurationSet: null,
      snsTopicArn: 'arn:aws:sns:eu-central-1:123:acme', webhookToken: 'webhook-token',
      quotaRatePerSec: 10, quotaDaily: 1000, quotaRefreshedAt: '2026-07-22T00:00:00.000Z',
      inSandbox: false, webhookVerifiedAt: null, footerLegalName: 'Acme', footerAddress: 'Warsaw',
      broadcastsEnabled: true,
    }]);
    marketing.sns = new FakeSnsVerifier(ok({
      type: 'Notification', topicArn: 'arn:aws:sns:eu-central-1:123:other', message: '{}', subscribeUrl: null,
    }));
    const response = await marketingApp(marketing).request('/api/webhooks/ses/webhook-token', {
      method: 'POST', body: '{}',
    });
    expect(response.status).toBe(200);
  });
});

describe('email dispatch route', () => {
  it('requires the shared secret and returns the dispatch envelope', async () => {
    const app = buildApp(deps());
    expect((await app.request(API_PATHS.emailDispatch, { method: 'POST' })).status).toBe(401);
    const response = await app.request(API_PATHS.emailDispatch, {
      method: 'POST',
      headers: { 'x-email-dispatch-secret': 'test-email-dispatch-secret' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { attemptsMade: 0, sentCount: 0, failedCount: 0 },
    });
  });

  it('surfaces a dispatch failure as an error envelope', async () => {
    const app = buildApp(deps({ dispatchEmails: async () => err(internal('outbox unavailable')) }));
    const response = await app.request(API_PATHS.emailDispatch, {
      method: 'POST',
      headers: { 'x-email-dispatch-secret': 'test-email-dispatch-secret' },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('health route', () => {
  it('reports the database status from the health port', async () => {
    const up = await buildApp(deps()).request(API_PATHS.health);
    expect(await up.json()).toMatchObject({ ok: true, data: { status: 'ok', database: 'up' } });

    const down = await buildApp(deps({ databaseUp: false })).request(API_PATHS.health);
    expect(await down.json()).toMatchObject({ ok: true, data: { database: 'down' } });
  });
});

describe('public payment-config route', () => {
  it('exposes the simulated-payments flag for a resolved tenant', async () => {
    const response = await buildApp(deps()).request(API_PATHS.publicPaymentConfig, {
      headers: { [TENANT_HEADER]: 'acme' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { simulatedPaymentsEnabled: false } });
  });

  it('returns a 404 envelope for an unknown tenant', async () => {
    const response = await buildApp(deps()).request(API_PATHS.publicPaymentConfig, {
      headers: { [TENANT_HEADER]: 'nope' },
    });
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});

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

const consentApp = (simulatedPayments: boolean) => {
  const recorded: TermsConsent[] = [];
  const base = deps();
  const app = buildApp({
    ...base,
    tenants: {
      ...base.tenants,
      findSettings: async (tenantId) =>
        tenantId === acme.id
          ? {
              billingPortalUrl: null,
              bunnyStreamLibraryId: null,
              logoUrl: null,
              accentColor: null,
              faviconUrl: null,
              termsUrl: 'https://acme.example/terms-v2',
              privacyUrl: 'https://acme.example/privacy-v3',
            }
          : null,
    },
    consents: {
      ...base.consents,
      record: async (_tenantId, consent) => {
        recorded.push(consent);
      },
    },
    tenantSecrets: {
      ...base.tenantSecrets,
      findByKey: async (tenantId, key) => ({
        id: `secret-${key}`,
        tenantId,
        key,
        ciphertext: 'ciphertext',
        iv: 'iv',
        authTag: 'auth-tag',
        maskedPreview: '••••text',
        updatedAt: '2026-07-12T00:00:00.000Z',
      }),
    },
    devEndpoints: { simulatedPayments, exposeMagicLinks: false },
  });
  return { app, recorded };
};

describe('checkout consent ordering', () => {
  it('records real-checkout consent only after validating the product', async () => {
    const { app, recorded } = consentApp(false);
    const request = (productId: string) =>
      app.request(API_PATHS.checkoutSession, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'acme.localhost:48730' },
        body: JSON.stringify({
          email: 'buyer@together.dev',
          productId,
          termsAccepted: true,
        }),
      });

    expect((await request('missing-product')).status).toBe(404);
    expect(recorded).toEqual([]);
    expect((await request('acme-published')).status).toBe(200);
    expect(recorded).toEqual([
      expect.objectContaining({
        email: 'buyer@together.dev',
        termsUrl: 'https://acme.example/terms-v2',
        privacyUrl: 'https://acme.example/privacy-v3',
        acceptedAt: '2026-07-12T00:00:00.000Z',
      }),
    ]);
  });

  it('records simulated-checkout consent only after validating the product', async () => {
    const { app, recorded } = consentApp(true);

    expect(
      (
        await purchase(
          app,
          { host: 'acme.localhost:48730' },
          { email: 'buyer@together.dev', productId: 'missing-product', termsAccepted: true },
        )
      ).status,
    ).toBe(404);
    expect(recorded).toEqual([]);

    expect(
      (
        await purchase(
          app,
          { host: 'acme.localhost:48730' },
          { email: 'buyer@together.dev', productId: 'acme-published', termsAccepted: true },
        )
      ).status,
    ).toBe(200);
    expect(recorded).toEqual([
      expect.objectContaining({
        email: 'buyer@together.dev',
        termsUrl: 'https://acme.example/terms-v2',
        privacyUrl: 'https://acme.example/privacy-v3',
        acceptedAt: '2026-07-12T00:00:00.000Z',
      }),
    ]);
  });
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
