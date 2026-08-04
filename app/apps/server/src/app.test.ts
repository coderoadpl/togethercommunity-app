import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  API_PATHS,
  capabilitiesForPrincipal,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  TENANT_HEADER,
} from '#core/contract/index.js';
import {
  BETTER_AUTH_MAGIC_LINK_PATH,
} from '#adapters/auth/create-auth.js';
import type { AppDeps, MarketingAppDeps } from './composition.js';
import { buildApp } from './app.js';
import { PUBLIC_ROUTE_MANIFEST } from './public-route-manifest.js';
import {
  err,
  emailEventSchema,
  internal,
  MAGIC_LINK_LANGUAGE_HEADER,
  ok,
  type Member,
  type Membership,
  type CourseLesson,
  type LessonAttachment,
  type Order,
  type Post,
  type Product,
  type ProductDownloadAsset,
  type ProductGrant,
  type Tenant,
  type TenantDomain,
  type TermsConsent,
} from '#core/domain/index.js';
import { authorize, type PaymentWebhookEvent } from '#core/server/index.js';
import { authenticateMarketingApiKey } from './marketing-routes.js';
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
  InMemoryEmailEventRepository,
  InMemoryMarketingAudienceRepository,
  InMemoryMarketingConsentRepository,
  InMemorySchedulerRunRepository,
  InMemoryMarketingThrottleRepository,
  InMemorySuppressionRepository,
  InMemoryTenantSesSettingsRepository,
  InMemoryUnsubscribeTokenRepository,
} from '#core/server/testing/marketing-fakes.js';

const acme: Tenant = {
  id: 't-acme', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 4,
};
const globex: Tenant = {
  id: 't-globex', slug: 'globex', name: 'Globex', status: 'active', plan: 'hosted_pro', contentVersion: 2,
};

const product = (input: {
  id: string;
  tenantId: string;
  title: string;
  published: boolean;
}): Product => ({
  id: input.id,
  tenantId: input.tenantId,
  type: 'course',
  slug: input.id,
  title: input.title,
  description: '',
  coverUrl: null,
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
  logger?: AppDeps['logger'];
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
  const checkoutConsentCaptures = new Map<string, Parameters<AppDeps['checkoutConsentCaptures']['create']>[1]>();
  let nextId = 0;
  const appDeps: AppDeps = {
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
      setBanned: async () => null,
    },
    memberEvents: {
      append: async () => undefined,
      listForMember: async () => [],
    },
    memberErasure: {
      pseudonymize: async () => null,
    },
    reports: {
      open: async () => null,
      findById: async () => null,
      listByStatus: async () => ({ reports: [], nextCursor: null }),
      countOpenByPost: async () => new Map(),
      countOpen: async () => 0,
      resolve: async () => null,
      resolveAllForPost: async () => 0,
    },
    erasureRequests: {
      create: async () => 'created',
      findOpenForMember: async () => null,
      findLatestForMember: async () => null,
      list: async () => [],
      resolve: async () => null,
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
    downloadAssets: {
      create: async () => undefined,
      findById: async () => null,
      listByProduct: async () => [],
      listReadyByProduct: async () => [],
      markReady: async () => null,
      delete: async () => false,
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
      listForMember: async () => [],
      revenueSince: async () => [],
      countSince: async () => 0,
      listPaidWithoutGrant: async () => [],
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
      test: async () => ok({ code: 'payment.available', message: 'Payment is available.' }),
      createCheckoutSession: async () => ok({ url: 'https://checkout.local/cs', sessionId: 'cs' }),
      expireCheckoutSession: async () => ok({ expired: true }),
      cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
      verifyWebhookEvent: async () => ok({ id: 'evt', type: 'test', objectId: null, checkoutSession: null }),
    },
    invoices: {
      findById: async () => null,
      findCurrentByOrder: async () => null,
      findLatestRequestedEvent: async () => null,
      create: async () => true,
      claimRetry: async () => true,
      update: async () => null,
      appendEvent: async () => undefined,
    },
    invoicing: {
      issueInvoice: async () =>
        ok({
          providerInvoiceId: 'fake-1',
          invoiceNumber: 'FV/1',
          status: 'issued',
        }),
      getInvoiceStatus: async () => ok('issued'),
      downloadInvoice: async () => ok({
        content: new TextEncoder().encode('%PDF-1.7'),
        contentType: 'application/pdf',
      }),
      testConnection: async () => ok({ diagnostic: 'Fake invoicing is available.' }),
    },
    checkoutConsentCaptures: {
      create: async (_tenantId, capture) => {
        checkoutConsentCaptures.set(capture.id, structuredClone(capture));
      },
      findById: async (_tenantId, id) =>
        structuredClone(checkoutConsentCaptures.get(id)?.capture ?? null),
    },
    videoLibrary: {
      listVideos: async () => ok({ videos: [], totalItems: 0 }),
    },
    bunnyEmbedTokenSigner: {
      sign: ({ videoId, expires }) => `${videoId}-${expires}`,
    },
    storage: {
      objectUrl: (configuration, key) => new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
      probe: async () => ok({ code: 'storage.available', message: 'Storage is available.' }),
      presignPut: (input) => ok(input.url),
      presignGet: (input) => ok(input.url),
      delete: async () => ok({ deleted: true }),
      head: async () => ok({ sizeBytes: 1 }),
      healthcheck: async () => ok({ healthy: true }),
      test: async () => ok({ code: 'storage.available', message: 'Storage is available.' }),
    },
    processedPaymentEvents: {
      claim: async () => 'claimed',
      finalize: async () => undefined,
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
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
        },
        grantCreated: true,
      }),
    },
    email: {
      healthcheck: async () => ok({ healthy: true }),
      test: async () => ok({ code: 'email.available', message: 'Email is available.' }),
      send: async () => ({ ok: true, value: { messageId: 'test-message-id' } }),
    },
    emailSender: {
      send: async () => ok({ messageId: 'test-message-id', transport: 'platform' }),
    },
    emailTransports: {
      resolve: async () => ({
        healthcheck: async () => ok({ healthy: true }),
        test: async () => ok({ code: 'email.available', message: 'Email is available.' }),
        send: async () => ok({ messageId: 'transport-test-message-id' }),
      }),
    },
    emailOutbox: {
      enqueue: async (message) => ok({ id: message.id }),
      claimBatch: async () => ok([]),
      markSent: async () => ok(undefined),
      markFailed: async () => ok(undefined),
      correlateBySesMessageId: async () => null,
      markDelivery: async () => ok(undefined),
    },
    enrollmentTransaction: {
      run: async (operation) => operation({
        members: {
          findById: async (_tenantId, id) => members.find((member) => member.id === id) ?? null,
          findByEmail: async (_tenantId, email) => members.find((member) => member.email === email) ?? null,
          listWithProductIds: async () => [],
          create: async (_tenantId, member) => { members.push(member); },
          updateEmail: async () => null,
        setBanned: async () => null,
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
    paymentTransaction: {
      run: async (operation) =>
        operation({
          members: appDeps.members,
          grants: appDeps.grants,
          orders: appDeps.orders,
          subscriptions: appDeps.subscriptions,
          paymentRefunds: appDeps.paymentRefunds,
          couponRedemptions: appDeps.couponRedemptions ?? {
            counts: async () => ({ total: 0, member: 0 }),
            createOrderAndClaim: async () => false,
          },
          emailOutbox: appDeps.emailOutbox,
          processedPaymentEvents: appDeps.processedPaymentEvents,
          enrollmentTransaction: appDeps.enrollmentTransaction,
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
      findByIds: async (tenantId, ids) =>
        products.filter((candidate) => candidate.tenantId === tenantId && ids.includes(candidate.id)),
      create: async () => 'created',
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
    attachments: {
      create: async () => undefined,
      findById: async () => null,
      listByLesson: async () => [],
      listReadyByLesson: async () => [],
      markReady: async () => null,
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
      findByIds: async () => [],
      countByAuthorSince: async () => 0,
      listRecentBodiesByAuthor: async () => [],
      listByAuthor: async () => [],
      listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
      listReplies: async () => [],
      updateBody: async () => null,
      softDelete: async () => null,
      setPinned: async () => null,
      listPinnedForContext: async () => [],
      countPinnedForContext: async () => 0,
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
      findSole: async () => tenants.length === 1 ? tenants[0] ?? null : null,
      hasAny: async () => tenants.length > 0,
      findSettings: async (tenantId) =>
        tenants.some((tenant) => tenant.id === tenantId) ? {
          name: tenants.find((tenant) => tenant.id === tenantId)?.name ?? '',
          socialLinks: [],
          billingPortalUrl: null, bunnyStreamLibraryId: null, logoUrl: null,
          accentColor: null, faviconUrl: null, ogTitle: null, ogDescription: null,
          ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
          privacyUrl: null,
        } : null,
      updateSettings: async (_tenantId, settings) => settings,
      createTenantWithOwnerGrant: async (tenant) => ({
        id: tenant.tenant.id,
        slug: tenant.tenant.slug,
        name: tenant.tenant.name,
        status: 'active',
        plan: 'self_hosted',
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
      findMember: async (tenantId) =>
        members.find((candidate) => candidate.tenantId === tenantId) ?? null,
    },
    health: { pingDatabase: async () => input.databaseUp ?? true },
    appVersion: '0.1.0-test',
    commitSha: 'test-sha',
    tenantCreationMode: 'open',
    ids: { nextId: () => `id-${String(++nextId)}` },
    clock: { nowIso: () => '2026-07-12T00:00:00.000Z' },
    logger: input.logger ?? { error: () => undefined },
    deferredEffects: {
      schedule: (effect) => {
        queueMicrotask(() => { void effect(); });
      },
    },
    baseDomain: 'localhost',
    singleTenantMode: false,
    appBaseUrl: 'http://localhost:48730',
    devEndpoints: { simulatedPayments: false, exposeMagicLinks: false },
    authConfig: { googleEnabled: false },
  };
  return appDeps;
};

const requestPublicOffer = (app: ReturnType<typeof buildApp>, headers: Record<string, string>) =>
  app.request(API_PATHS.publicOffer, { headers });

const scopedApp = (
  scope: 'none' | 'member' | 'banned-member' | 'staff' | 'owner',
  options: { memberDeletedAt?: string; marketing?: MarketingAppDeps; overrides?: Partial<AppDeps> } = {},
) => {
  const base = deps();
  const member: Member = {
    id: 'member-1',
    tenantId: acme.id,
    userId: 'user-1',
    email: 'user@acme.test',
    displayName: 'User',
    tags: [],
    marketingConsents: {},
    externalCustomerIds: {},
    createdAt: '2026-07-12T00:00:00.000Z',
    deletedAt: options.memberDeletedAt ?? null,
    bannedAt: scope === 'banned-member' ? '2026-07-12T00:00:00.000Z' : null,
    bannedReason: null,
    bannedByUserId: null,
  };
  const staffGrant: Membership = { tenant: acme, staffRole: scope === 'owner' ? 'owner' : 'admin' };
  const post: Post = {
    id: 'post-1',
    tenantId: acme.id,
    contextKind: 'space',
    contextId: 'space-1',
    rootPostId: 'post-1',
    parentPostId: null,
    authorUserId: 'user-2',
    authorDisplay: 'Author',
    authorIsStaff: false,
    body: 'Pinned',
    createdAt: '2026-07-12T00:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
  };
  return buildApp({
    ...base,
    authPort: {
      ...base.authPort,
      getAuthenticatedUser: async () => ({
        userId: 'user-1',
        email: 'user@acme.test',
        name: 'User',
      }),
    },
    tenantAccess: {
      ...base.tenantAccess,
      findStaffGrant: async () => (scope === 'staff' || scope === 'owner' ? staffGrant : null),
      findMember: async () => (scope === 'member' || scope === 'banned-member' ? member : null),
    },
    members: {
      ...base.members,
      findById: async () => (scope === 'none' ? null : member),
      setBanned: async () => member,
    },
    tenants: {
      ...base.tenants,
      findSettings: async (tenantId) => {
        const settings = await base.tenants.findSettings(tenantId);
        return settings === null ? null : { ...settings, supportEmail: 'support@acme.test' };
      },
    },
    emailOutbox: {
      ...base.emailOutbox,
      enqueue: async (message) => ok({ id: message.id }),
    },
    posts: {
      ...base.posts,
      findById: async () => post,
      countPinnedForContext: async () => 0,
      setPinned: async (_tenantId, input) => ({
        ...post,
        pinnedAt: input.pinnedAt,
      }),
    },
    spaces: {
      ...base.spaces,
      findById: async () => ({
        id: 'space-1',
        tenantId: acme.id,
        slug: 'general',
        name: 'General',
        description: null,
        visibility: 'members',
        productIds: [],
        position: 0,
        archivedAt: null,
        createdAt: '2026-07-12T00:00:00.000Z',
      }),
    },
    reports: {
      ...base.reports,
      open: async (_tenantId, report) => report,
      findById: async () => ({
        id: 'report-1',
        tenantId: acme.id,
        postId: post.id,
        reporterUserId: member.userId,
        reporterDisplay: member.displayName,
        source: 'member',
        reason: 'spam',
        note: null,
        signals: null,
        status: 'open',
        createdAt: '2026-07-12T00:00:00.000Z',
        resolvedAt: null,
        resolvedByUserId: null,
      }),
      resolve: async (_tenantId, input) => ({
        id: input.id,
        tenantId: acme.id,
        postId: post.id,
        reporterUserId: member.userId,
        reporterDisplay: member.displayName,
        source: 'member',
        reason: 'spam',
        note: null,
        signals: null,
        status: input.status,
        createdAt: '2026-07-12T00:00:00.000Z',
        resolvedAt: input.resolvedAt,
        resolvedByUserId: input.resolvedByUserId,
      }),
    },
    orders: {
      ...base.orders,
      listPaidWithoutGrant: async () => [],
    },
    marketing: options.marketing ?? marketingDeps(),
    ...options.overrides,
  });
};

const marketingDeps = (): MarketingAppDeps => ({
  runs: new InMemorySchedulerRunRepository(),
  events: new InMemoryEmailEventRepository(),
  emailSends: {
    listPage: async () => ({ sends: [], nextCursor: null }),
    findById: async () => null,
    listByEmailAcrossKinds: async () => [],
  },
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
  platformTransactionalPool: {
    usage: async () => ({ sent: 0, reserved: 0 }),
    reserve: async () => true,
    settle: async () => undefined,
  },
  documents: {
    create: async () => undefined,
    findById: async () => null,
    list: async () => [],
    listVersions: async () => [],
    saveDraft: async () => null,
    publishDraft: async () => null,
    findPublishedVersionById: async () => null,
    findLatestPublished: async (tenantId, slug) => tenantId === 't-acme' && slug === 'terms' ? {
      document: { id: 'document-1', tenantId, slug, title: 'Terms', status: 'published', createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z' },
      version: { id: 'version-1', tenantId, documentId: 'document-1', version: 1, content: 'Immutable terms', publishedAt: '2026-07-22T00:00:00.000Z', createdAt: '2026-07-22T00:00:00.000Z', createdBy: 'staff' },
    } : null,
    findPublishedVersion: async () => null,
  },
  idempotency: new InMemoryAutomationIdempotencyRepository(),
  marketingSes: new FakeSesMarketingSender(),
  marketingCredentials: { resolve: async () => ok({ accessKeyId: 'key', secretAccessKey: 'secret', region: 'eu-central-1' }) },
  quotaReader: undefined,
  throttle: new InMemoryMarketingThrottleRepository(),
  hmac: new FakeEmailHmac(),
  sns: new FakeSnsVerifier(ok({ type: 'Notification', topicArn: 'topic', message: '{}', subscribeUrl: null })),
  scheduler: new FakeScheduler(),
  tickSecret: 'test-marketing-tick-secret',
  cronSecret: 'test-marketing-cron-secret',
  dispatchCampaign: async () => ok({ leased: true, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 }),
  dispatchScheduledMarketing: async () => ok({
    campaignsDispatched: 0,
    retentionTenantsProcessed: 0,
    identityChecksPerformed: 0,
    reputationAlertsSent: 0,
  }),
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

const ksefApp = (
  dispatch: NonNullable<AppDeps['ksef']>['dispatch'],
): ReturnType<typeof buildApp> => {
  const configured = deps();
  configured.ksef = {
    environment: 'test',
    credentials: {
      resolve: async () => ok({
        tenantId: 't-acme',
        token: 'token',
        contextNip: '5555555555',
      }),
    },
    numbers: {
      allocate: async () => ({ p2: 'FV/2026/000001', sequence: 1 }),
    },
    artifacts: {
      findByKey: async () => null,
      store: async () => true,
    },
    hash: { sha256: () => 'a'.repeat(64) },
    validator: { validate: async () => ok(undefined) },
    pdf: { render: () => new Uint8Array() },
    client: {
      validateCredentials: async () => ok({ diagnostic: 'ok' }),
      openSession: async () => ok({ sessionReference: 'session-1' }),
      submitInvoice: async () => ok({ invoiceReference: 'invoice-1' }),
      listSessionInvoices: async () => ok([]),
      getInvoiceStatus: async () => ok({
        code: 150,
        description: 'processing',
        details: [],
        extensions: {},
        ksefNumber: null,
        acquisitionAt: null,
        invoicingAt: null,
        permanentStorageAt: null,
      }),
      downloadUpo: async () => ok('<UPO/>'),
      verifyDuplicateOriginal: async () => ok(true),
      closeSession: async () => ok(undefined),
    },
    jobs: {
      claimDue: async () => null,
      reschedule: async () => undefined,
      complete: async () => undefined,
    },
    dispatchSecret: 'test-ksef-cron-secret',
    dispatch,
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
  it('rejects staff sessions on machine-only marketing edges', async () => {
    const marketing = marketingDeps();
    const app = scopedApp('staff', { marketing });
    const tenantHeaders = { host: 'acme.localhost:48730' };

    expect((await app.request('/api/internal/marketing/tick', {
      method: 'GET',
      headers: tenantHeaders,
    })).status).toBe(401);
    expect((await app.request('/api/internal/marketing/tick', {
      method: 'POST',
      headers: { ...tenantHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 't-acme', campaignId: 'campaign-1' }),
    })).status).toBe(401);
    expect((await app.request('/api/m2m/marketing/messages', {
      method: 'GET',
      headers: tenantHeaders,
    })).status).toBe(401);
    expect((await app.request('/api/m2m/marketing/messages', {
      method: 'POST',
      headers: { ...tenantHeaders, 'content-type': 'application/json' },
      body: '{}',
    })).status).toBe(401);
  });

  it('returns the same SES webhook response regardless of session scope', async () => {
    const request = async (scope: 'none' | 'member' | 'staff') => {
      const marketing = marketingDeps();
      marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
        tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
        identityVerifiedAt: '2026-07-22T00:00:00.000Z', identityCheckedAt: null,
        identityCheckError: null, configurationSet: null, snsTopicArn: 'topic',
        trackingEnabled: false, autoPauseOnCritical: false, webhookToken: 'webhook-token',
        quotaRatePerSec: 10, quotaDaily: 1000, quotaSentLast24Hours: 0,
        quotaRefreshedAt: '2026-07-22T00:00:00.000Z', inSandbox: false,
        webhookVerifiedAt: null, footerLegalName: 'Acme', footerAddress: 'Warsaw',
        broadcastsEnabled: true, reputationAlertStatus: null, reputationAlertedAt: null,
      }]);
      const response = await scopedApp(scope, { marketing }).request(
        '/api/webhooks/ses/webhook-token',
        { method: 'POST', headers: { host: 'acme.localhost:48730' }, body: '{}' },
      );
      return { status: response.status, body: await response.json() };
    };

    const [anonymous, member, staff] = await Promise.all([
      request('none'),
      request('member'),
      request('staff'),
    ]);
    expect(anonymous).toEqual({
      status: 400,
      body: {
        ok: false,
        error: expect.objectContaining({ code: 'validation' }),
      },
    });
    expect(member).toEqual(anonymous);
    expect(staff).toEqual(anonymous);
  });

  it('denies staff-only capabilities to an authenticated API-key context', async () => {
    const configured = deps();
    configured.tenantApiKeys = {
      listByTenant: async () => [],
      create: async () => undefined,
      findActiveByHash: async (tenantId, hash) => tenantId === acme.id && hash === 'hash:marketing-key' ? {
        id: 'api-key-1', tenantId, name: 'Marketing', keyHash: hash,
        createdAt: '2026-07-22T00:00:00.000Z', revokedAt: null,
      } : null,
      revoke: async () => null,
    };
    const authenticated = await authenticateMarketingApiKey(new Headers({
      host: 'acme.localhost:48730',
      'x-api-key': 'marketing-key',
    }), configured);
    expect(authenticated.ok).toBe(true);
    if (!authenticated.ok) return;
    expect(authenticated.value.ctx.capabilities).toEqual(capabilitiesForPrincipal('api-key'));
    expect(authorize(authenticated.value.ctx, 'marketing:campaign:write')).toMatchObject({ code: 'forbidden' });
  });

  it('runs the due-campaign and retention scan only for the configured cron bearer', async () => {
    const marketing = marketingDeps();
    const triggers: string[] = [];
    marketing.dispatchScheduledMarketing = async (trigger) => {
      triggers.push(trigger);
      return ok({
        campaignsDispatched: 2,
        retentionTenantsProcessed: 3,
        identityChecksPerformed: 4,
        reputationAlertsSent: 5,
      });
    };
    const app = marketingApp(marketing);
    expect((await app.request('/api/internal/marketing/tick')).status).toBe(401);
    const response = await app.request('/api/internal/marketing/tick', {
      headers: { authorization: 'Bearer test-marketing-cron-secret' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        campaignsDispatched: 2,
        retentionTenantsProcessed: 3,
        identityChecksPerformed: 4,
        reputationAlertsSent: 5,
      },
    });
    expect(triggers).toEqual(['cron']);
  });

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

  it.each([
    [{ host: 'globex.localhost:48730', 'x-api-key': 'marketing-key' }],
    [{ host: 'localhost:48730', 'x-tenant': 'globex', 'x-api-key': 'marketing-key' }],
  ])('rejects a tenant A API key resolved against tenant B', async (headers) => {
    const response = await marketingApp().request('/api/m2m/marketing/messages', { headers });
    expect(response.status).toBe(401);
  });

  it('exposes active consent definitions and ordered message events to API clients', async () => {
    const marketing = await memberSurfaceMarketing();
    const now = '2026-07-22T00:00:00.000Z';
    await marketing.campaignSends.claimRecipient('t-acme', {
      id: 'send-1',
      tenantId: 't-acme',
      campaignId: null,
      source: 'api',
      memberId: null,
      email: 'member@example.test',
      subject: 'News',
      consentRowId: 'consent-news',
      unsubscribeTokenId: null,
      status: 'sent',
      skipReason: null,
      sesMessageId: 'ses-1',
      deliveryStatus: null,
      deliveryOccurredAt: null,
      idempotencySource: null,
      renderedBodyPurgedAt: null,
      createdAt: now,
      sentAt: now,
    });
    for (const [id, type, meta] of [
      ['event-1', 'queued', null],
      ['event-2', 'accepted', { sesMessageId: 'ses-1' }],
    ] as const) {
      await marketing.events.append('t-acme', emailEventSchema.parse({
        id,
        tenantId: 't-acme',
        mailKind: 'marketing',
        refId: 'send-1',
        type,
        occurredAt: now,
        meta,
        createdAt: now,
      }));
    }
    const headers = { host: 'acme.localhost:48730', 'x-api-key': 'marketing-key' };
    const definitions = await marketingApp(marketing).request(
      '/api/m2m/marketing/consent-definitions',
      { headers },
    );
    expect(await definitions.json()).toMatchObject({
      ok: true,
      data: {
        definitions: [{
          id: 'definition-news',
          key: 'product-news',
          kind: 'optional_marketing',
          label: 'Product news',
          doubleOptIn: true,
        }],
      },
    });
    const message = await marketingApp(marketing).request(
      '/api/m2m/marketing/messages/send-1',
      { headers },
    );
    expect(await message.json()).toMatchObject({
      ok: true,
      data: { id: 'send-1', events: [{ type: 'queued' }, { type: 'accepted' }] },
    });
  });

  it('returns 429 with Retry-After when the tenant SES throttle is under pressure', async () => {
    const marketing = marketingDeps();
    marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: '2026-07-22T00:00:00.000Z', identityCheckedAt: null,
      identityCheckError: null, configurationSet: 'marketing',
      snsTopicArn: null, trackingEnabled: false, autoPauseOnCritical: false,
      webhookToken: 'webhook-token-123456789012', quotaRatePerSec: 1,
      quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: '2026-07-22T00:00:00.000Z', inSandbox: false,
      webhookVerifiedAt: '2026-07-22T00:00:00.000Z', footerLegalName: 'Acme',
      footerAddress: 'Warsaw', broadcastsEnabled: true,
      reputationAlertStatus: null, reputationAlertedAt: null,
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
    const contentSecurityPolicy = response.headers.get('content-security-policy');
    const nonce = /(?:^|; )script-src [^;]*'nonce-([^']+)'/.exec(contentSecurityPolicy ?? '')?.[1];
    const body = await response.text();
    expect(body).toContain('Immutable terms');
    expect(nonce).toBeDefined();
    expect(body).toContain(`<script nonce="${nonce}">`);
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

  it('keeps RFC one-click POST empty and requires an idempotent DOI confirmation POST', async () => {
    const marketing = await memberSurfaceMarketing();
    const oneClick = await marketingApp(marketing).request('/u/unsubscribe_token_123456789012345', {
      method: 'POST', headers: { host: 'acme.localhost:48730' },
    });
    expect(oneClick.status).toBe(200);
    expect(await oneClick.text()).toBe('');
    const confirmationMarketing = await memberSurfaceMarketing();
    const confirmationApp = marketingApp(confirmationMarketing);
    const before = await confirmationMarketing.marketingConsents.listByEmail('t-acme', 'member@example.test');
    const interstitial = await confirmationApp.request('/marketing/confirm/confirmation_token_123456789012345?lang=en', {
      headers: { host: 'acme.localhost:48730' },
    });
    const interstitialHtml = await interstitial.text();
    expect(interstitialHtml).toContain('Confirm your subscription');
    expect(interstitialHtml).toContain('<button type="submit">Confirm subscription</button>');
    expect(interstitialHtml).toContain('method="post"');
    expect(await confirmationMarketing.marketingConsents.listByEmail('t-acme', 'member@example.test')).toEqual(before);
    const success = await confirmationApp.request('/marketing/confirm/confirmation_token_123456789012345?lang=en', {
      method: 'POST', headers: { host: 'acme.localhost:48730' },
    });
    expect(await success.text()).toContain('Email address confirmed');
    const repeated = await confirmationApp.request('/marketing/confirm/confirmation_token_123456789012345?lang=en', {
      method: 'POST', headers: { host: 'acme.localhost:48730' },
    });
    expect(await repeated.text()).toContain('Email address confirmed');
    const confirmedGet = await confirmationApp.request('/marketing/confirm/confirmation_token_123456789012345?lang=en', {
      headers: { host: 'acme.localhost:48730' },
    });
    expect(await confirmedGet.text()).toContain('Email address confirmed');
    const expired = await confirmationApp.request('/marketing/confirm/missing_confirmation_token_123456?lang=en', {
      headers: { host: 'acme.localhost:48730' },
    });
    expect(await expired.text()).toContain('This link is no longer active');
    const expiredPost = await confirmationApp.request('/marketing/confirm/missing_confirmation_token_123456?lang=en', {
      method: 'POST', headers: { host: 'acme.localhost:48730' },
    });
    expect(await expiredPost.text()).toContain('This link is no longer active');
  });

  it('acknowledges a verified SNS envelope from another tenant topic without processing it', async () => {
    const marketing = marketingDeps();
    marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: '2026-07-22T00:00:00.000Z', identityCheckedAt: null,
      identityCheckError: null, configurationSet: null,
      snsTopicArn: 'arn:aws:sns:eu-central-1:123:acme', trackingEnabled: false,
      autoPauseOnCritical: false, webhookToken: 'webhook-token',
      quotaRatePerSec: 10, quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: '2026-07-22T00:00:00.000Z',
      inSandbox: false, webhookVerifiedAt: null, footerLegalName: 'Acme', footerAddress: 'Warsaw',
      broadcastsEnabled: true, reputationAlertStatus: null, reputationAlertedAt: null,
    }]);
    marketing.sns = new FakeSnsVerifier(ok({
      type: 'Notification', topicArn: 'arn:aws:sns:eu-central-1:123:other', message: '{}', subscribeUrl: null,
    }));
    const response = await marketingApp(marketing).request('/api/webhooks/ses/webhook-token', {
      method: 'POST', body: '{}',
    });
    expect(response.status).toBe(200);
  });

  it('marks the webhook verified when an uncorrelated simulator bounce completes the signed SNS round-trip', async () => {
    const marketing = marketingDeps();
    const now = '2026-07-22T00:00:00.000Z';
    const topicArn = 'arn:aws:sns:eu-central-1:123:acme';
    const settings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: now, identityCheckedAt: null, identityCheckError: null,
      configurationSet: 'marketing', snsTopicArn: topicArn,
      trackingEnabled: false, autoPauseOnCritical: false, webhookToken: 'webhook-token', quotaRatePerSec: 10,
      quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: now, inSandbox: false,
      webhookVerifiedAt: null, footerLegalName: 'Acme', footerAddress: 'Warsaw',
      broadcastsEnabled: false, reputationAlertStatus: null, reputationAlertedAt: null,
    }]);
    marketing.sesSettings = settings;
    marketing.sns = new FakeSnsVerifier(ok({
      type: 'Notification',
      topicArn,
      message: JSON.stringify({
        eventType: 'Bounce',
        mail: { messageId: 'ses-simulator-message', timestamp: now },
        bounce: {
          timestamp: now,
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'bounce@simulator.amazonses.com', status: '5.1.1' }],
        },
      }),
      subscribeUrl: null,
    }));

    const response = await marketingApp(marketing).request('/api/webhooks/ses/webhook-token', {
      method: 'POST',
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect((await settings.findByTenant('t-acme'))?.webhookVerifiedAt).not.toBeNull();
  });

  it('ingests SES configuration-set Open and Click records and tolerates unknown messages', async () => {
    const marketing = marketingDeps();
    const now = '2026-07-22T00:00:00.000Z';
    const topicArn = 'arn:aws:sns:eu-central-1:123:acme';
    const events = new InMemoryEmailEventRepository();
    const sends = new InMemoryCampaignSendRepository(events);
    await sends.claimRecipient('t-acme', {
      id: 'send-tracked', runId: null, tenantId: 't-acme', campaignId: 'campaign-1',
      source: 'broadcast', memberId: 'member-1', email: 'member@example.test',
      subject: 'Tracked', consentRowId: 'consent-1', unsubscribeTokenId: null,
      status: 'sent', skipReason: null, sesMessageId: 'ses-tracked',
      deliveryStatus: null, deliveryOccurredAt: null, idempotencySource: null,
      renderedBodyPurgedAt: null, createdAt: now, sentAt: now,
    });
    marketing.events = events;
    marketing.campaignSends = sends;
    marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: now, identityCheckedAt: null, identityCheckError: null,
      configurationSet: 'marketing', snsTopicArn: topicArn,
      trackingEnabled: true, autoPauseOnCritical: false, webhookToken: 'webhook-token', quotaRatePerSec: 10,
      quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: now, inSandbox: false,
      webhookVerifiedAt: now, footerLegalName: 'Acme', footerAddress: 'Warsaw',
      broadcastsEnabled: true, reputationAlertStatus: null, reputationAlertedAt: null,
    }]);
    const app = marketingApp(marketing);
    for (const message of [
      {
        eventType: 'Open', mail: { messageId: 'ses-tracked', timestamp: now },
        open: { timestamp: now, ipAddress: '192.0.2.1' },
      },
      {
        eventType: 'Click', mail: { messageId: 'ses-tracked', timestamp: now },
        click: { timestamp: now, link: 'https://acme.test/offer' },
      },
      {
        eventType: 'Open', mail: { messageId: 'ses-unknown', timestamp: now },
        open: { timestamp: now },
      },
    ]) {
      marketing.sns = new FakeSnsVerifier(ok({
        type: 'Notification', topicArn, message: JSON.stringify(message), subscribeUrl: null,
      }));
      const response = await app.request('/api/webhooks/ses/webhook-token', { method: 'POST', body: '{}' });
      expect(response.status).toBe(200);
    }
    expect((await events.listByRef('t-acme', 'marketing', 'send-tracked'))).toMatchObject([
      { type: 'opened' },
      { type: 'clicked', meta: { linkUrl: 'https://acme.test/offer' } },
    ]);
  });

  it('ingests configuration-set delivery records and acknowledges unsupported SES event types', async () => {
    const marketing = marketingDeps();
    const now = '2026-07-22T00:00:00.000Z';
    const topicArn = 'arn:aws:sns:eu-central-1:123:acme';
    const events = new InMemoryEmailEventRepository();
    const sends = new InMemoryCampaignSendRepository(events);
    await sends.claimRecipient('t-acme', {
      id: 'send-delivery', runId: null, tenantId: 't-acme', campaignId: 'campaign-1',
      source: 'broadcast', memberId: 'member-1', email: 'member@example.test',
      subject: 'Delivery', consentRowId: 'consent-1', unsubscribeTokenId: null,
      status: 'sent', skipReason: null, sesMessageId: 'ses-delivery',
      deliveryStatus: null, deliveryOccurredAt: null, idempotencySource: null,
      renderedBodyPurgedAt: null, createdAt: now, sentAt: now,
    });
    marketing.events = events;
    marketing.campaignSends = sends;
    marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: now, identityCheckedAt: null, identityCheckError: null,
      configurationSet: 'marketing', snsTopicArn: topicArn,
      trackingEnabled: false, autoPauseOnCritical: false, webhookToken: 'webhook-token', quotaRatePerSec: 10,
      quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: now, inSandbox: false,
      webhookVerifiedAt: now, footerLegalName: 'Acme', footerAddress: 'Warsaw',
      broadcastsEnabled: true, reputationAlertStatus: null, reputationAlertedAt: null,
    }]);
    const app = marketingApp(marketing);
    for (const message of [
      {
        eventType: 'Delivery', mail: { messageId: 'ses-delivery', timestamp: now },
        delivery: { timestamp: now },
      },
      {
        eventType: 'Send', mail: { messageId: 'ses-delivery', timestamp: now },
        send: {},
      },
    ]) {
      marketing.sns = new FakeSnsVerifier(ok({
        type: 'Notification', topicArn, message: JSON.stringify(message), subscribeUrl: null,
      }));
      const response = await app.request('/api/webhooks/ses/webhook-token', { method: 'POST', body: '{}' });
      expect(response.status).toBe(200);
    }
    expect(await sends.correlateBySesMessageId('t-acme', 'ses-delivery'))
      .toMatchObject({ deliveryStatus: 'delivered' });
  });
});

describe('KSeF HTTP surfaces', () => {
  it('runs the durable dispatcher only for the configured cron bearer', async () => {
    const dispatch = vi.fn(async () => ok({
      processed: false,
      invoiceId: null,
      processedCount: 0,
    }));
    const app = ksefApp(dispatch);

    expect((await app.request(API_PATHS.ksefDispatch)).status).toBe(401);
    const response = await app.request(API_PATHS.ksefDispatch, {
      headers: { authorization: 'Bearer test-ksef-cron-secret' },
    });

    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalledOnce();
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
  it('keeps the compatibility endpoint and exposes deploy attestation', async () => {
    const up = await buildApp(deps()).request(API_PATHS.health);
    expect(await up.json()).toMatchObject({
      ok: true,
      data: {
        status: 'ok',
        database: 'up',
        version: '0.1.0-test',
        sha: 'test-sha',
      },
    });

    const down = await buildApp(deps({ databaseUp: false })).request(API_PATHS.health);
    expect(await down.json()).toMatchObject({ ok: true, data: { database: 'down' } });
  });

  it('serves liveness without touching the database', async () => {
    let databasePings = 0;
    const configured = deps();
    configured.health = {
      pingDatabase: async () => {
        databasePings += 1;
        return false;
      },
    };

    const response = await buildApp(configured).request(API_PATHS.healthLive);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { status: 'ok', version: '0.1.0-test', sha: 'test-sha' },
    });
    expect(databasePings).toBe(0);
  });

  it('returns unavailable from readiness when the database is down', async () => {
    const up = await buildApp(deps()).request(API_PATHS.healthReady);
    expect(up.status).toBe(200);
    expect(await up.json()).toMatchObject({
      ok: true,
      data: { status: 'ok', database: 'up', sha: 'test-sha' },
    });

    const down = await buildApp(deps({ databaseUp: false })).request(API_PATHS.healthReady);
    expect(down.status).toBe(503);
    expect(down.headers.get('cache-control')).toBe('no-store');
    expect(await down.json()).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'Database is not reachable' },
    });
  });
});

describe('API envelope totality', () => {
  it.each([
    ['unknown route', '/api/does-not-exist', 'GET'],
    ['wrong method', API_PATHS.health, 'POST'],
  ])('returns a not_found envelope for an %s', async (_label, path, method) => {
    const response = await buildApp(deps({ authenticated: true })).request(path, { method });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'not_found', message: `No API route for ${method} ${path}` },
    });
  });
});

describe('server edge security baseline', () => {
  it('sets secure headers and keeps authenticated responses out of shared caches', async () => {
    const response = await deps({ authenticated: true });
    const app = buildApp(response);
    const result = await app.request(API_PATHS.health);

    expect(result.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(result.headers.get('content-security-policy')).toContain("connect-src 'self' https://*.sentry.io");
    expect(result.headers.get('content-security-policy')).not.toContain("connect-src 'self' https:;");
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('allows tenant bucket connections for SPA entries without widening server-rendered documents', async () => {
    const app = buildApp(deps());
    const panel = await app.request('/panel/lessons/lesson-1');
    const checkout = await app.request('/checkout/product-1');
    const unsubscribe = await app.request('/u/unsubscribe_token_123456789012345');
    const confirmation = await app.request('/marketing/confirm/confirmation_token_123456789012345');
    const legal = await app.request('/legal/terms');

    expect(panel.headers.get('content-security-policy')).toContain("connect-src 'self' https:;");
    expect(checkout.headers.get('content-security-policy')).toContain("connect-src 'self' https:;");
    for (const response of [unsubscribe, confirmation, legal]) {
      expect(response.headers.get('content-security-policy')).toContain("connect-src 'self' https://*.sentry.io");
      expect(response.headers.get('content-security-policy')).not.toContain("connect-src 'self' https:;");
    }
  });

  it('rejects API request bodies over 100KB with a taxonomy envelope', async () => {
    const app = buildApp(deps());
    const response = await app.request(API_PATHS.checkoutSession, {
      method: 'POST',
      headers: {
        'content-length': String(100 * 1024 + 1),
        host: 'acme.localhost',
      },
      body: '{}',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('caps public form posts outside the API prefix', async () => {
    const response = await buildApp(deps()).request('/u/token/preferences', {
      method: 'POST',
      headers: {
        'content-length': String(16 * 1024 + 1),
        host: 'acme.localhost',
      },
      body: 'definitionIds=product-news',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'validation',
        message: `Request body exceeds the ${16 * 1024} byte limit`,
      },
    });
  });

  it('allows content authoring requests above 100KB to reach authentication', async () => {
    const body = JSON.stringify({ bodyHtml: 'x'.repeat(100 * 1024) });
    const response = await buildApp(deps({ authenticated: true })).request(API_PATHS.marketingLayouts, {
      method: 'POST',
      headers: {
        'content-length': String(Buffer.byteLength(body)),
        host: 'acme.localhost',
      },
      body,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
  });

  it('does not open CORS on an authenticated route', async () => {
    const app = buildApp(deps({ authenticated: true }));
    const response = await app.request(API_PATHS.me, {
      headers: { origin: 'https://example.test' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('lesson attachment download route', () => {
  const lesson: CourseLesson = {
    id: 'lesson-download',
    tenantId: acme.id,
    name: 'Download lesson',
    contents: [],
    legacyId: null,
    createdAt: '2026-07-12T00:00:00.000Z',
  };
  const attachment: LessonAttachment = {
    id: 'attachment-download',
    tenantId: acme.id,
    lessonId: lesson.id,
    fileName: 'private.pdf',
    contentType: 'application/pdf',
    sizeBytes: 4096,
    storageKey: 'lesson-attachments/private.pdf',
    status: 'ready',
    createdAt: '2026-07-12T00:00:00.000Z',
  };
  const app = scopedApp('owner', {
    overrides: {
      lessons: {
        list: async () => [lesson],
        findById: async (tenantId, lessonId) =>
          tenantId === acme.id && lessonId === lesson.id ? lesson : null,
        findByIds: async () => [lesson],
        create: async () => undefined,
        update: async () => null,
        delete: async () => false,
      },
      attachments: {
        create: async () => undefined,
        findById: async (tenantId, attachmentId) =>
          tenantId === acme.id && attachmentId === attachment.id ? attachment : null,
        listByLesson: async () => [attachment],
        listReadyByLesson: async () => [attachment],
        markReady: async () => attachment,
        delete: async () => false,
      },
      secretResolver: {
        resolve: async () => ok(JSON.stringify({
          provider: 'minio',
          endpoint: 'https://storage.example.test',
          region: 'eu-central-1',
          bucket: 'creator-files',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        })),
      },
      storage: {
        objectUrl: (configuration, key) =>
          new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
        probe: async () => ok({ code: 'storage.available', message: 'ok' }),
        presignPut: (input) => ok(input.url),
        presignGet: () => ok('https://download.example.test/signed'),
        delete: async () => ok({ deleted: true }),
        head: async () => ok({ sizeBytes: attachment.sizeBytes }),
        healthcheck: async () => ok({ healthy: true }),
        test: async () => ok({ code: 'storage.available', message: 'ok' }),
      },
    },
  });
  const path = API_PATHS.studentLessonAttachmentDownload
    .replace(':lessonId', lesson.id)
    .replace(':attachmentId', attachment.id);

  it('redirects an authorized request to the signed object URL', async () => {
    const response = await app.request(path, { headers: { host: 'acme.localhost:48730' } });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://download.example.test/signed');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns an API envelope when the use-case rejects the attachment', async () => {
    const response = await app.request(path.replace(attachment.id, 'missing'), {
      headers: { host: 'acme.localhost:48730' },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('purchased product download route', () => {
  const downloadProduct: Product = {
    ...product({ id: 'digital-download', tenantId: acme.id, title: 'Creator workbook', published: true }),
    type: 'digital_download',
  };
  const asset: ProductDownloadAsset = {
    id: 'download-asset',
    tenantId: acme.id,
    productId: downloadProduct.id,
    fileName: 'workbook.pdf',
    contentType: 'application/pdf',
    sizeBytes: 4096,
    storageKey: 'product-downloads/digital-download/download-asset/workbook.pdf',
    status: 'ready',
    createdAt: '2026-07-12T00:00:00.000Z',
  };
  const grant: ProductGrant = {
    id: 'download-grant',
    tenantId: acme.id,
    memberId: 'member-1',
    productId: downloadProduct.id,
    source: 'stripe',
    startsAt: '2026-07-01T00:00:00.000Z',
    expiresAt: null,
    legacyId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
  const path = API_PATHS.memberProductDownload
    .replace(':productId', downloadProduct.id)
    .replace(':assetId', asset.id);
  const overrides = (entitled: boolean): Partial<AppDeps> => ({
    grants: {
      ...deps().grants,
      listActiveForMember: async () => entitled ? [grant] : [],
    },
    downloadAssets: {
      ...deps().downloadAssets,
      findById: async () => asset,
    },
    secretResolver: {
      resolve: async () => ok(JSON.stringify({
        provider: 'minio',
        endpoint: 'https://storage.example.test',
        region: 'eu-central-1',
        bucket: 'creator-files',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      })),
    },
    storage: {
      ...deps().storage,
      presignGet: () => ok('https://download.example.test/signed-workbook'),
    },
  });

  it('redirects a purchased download to its signed object URL', async () => {
    const response = await scopedApp('member', { overrides: overrides(true) }).request(path, {
      headers: { host: 'acme.localhost:48730' },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://download.example.test/signed-workbook');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 403 for an unentitled member', async () => {
    const response = await scopedApp('member', { overrides: overrides(false) }).request(path, {
      headers: { host: 'acme.localhost:48730' },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('new route authorization', () => {
  const headers = {
    host: 'acme.localhost:48730',
    'content-type': 'application/json',
  };

  it('denies members on product-download creator routes', async () => {
    const uploadPath = API_PATHS.productDownloadUpload.replace(':productId', 'download-1');
    const deletePath = API_PATHS.productDownloadDelete
      .replace(':productId', 'download-1')
      .replace(':assetId', 'asset-1');
    const upload = await scopedApp('member').request(uploadPath, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: 'workbook.pdf',
        contentType: 'application/pdf',
        sizeBytes: 4096,
      }),
    });
    const remove = await scopedApp('member').request(deletePath, { method: 'DELETE', headers });

    expect(upload.status).toBe(403);
    expect(remove.status).toBe(403);
  });

  it('denies members and permits staff on post pinning', async () => {
    const request = {
      method: 'POST',
      headers,
      body: JSON.stringify({ postId: 'post-1', pinned: true }),
    };

    expect((await scopedApp('member').request(API_PATHS.postsPin, request)).status).toBe(403);
    expect((await scopedApp('staff').request(API_PATHS.postsPin, request)).status).toBe(200);
  });

  it('permits tenant actors to report posts', async () => {
    const request = {
      method: 'POST',
      headers,
      body: JSON.stringify({ postId: 'post-1', reason: 'spam' }),
    };

    expect((await scopedApp('member').request(API_PATHS.postsReport, request)).status).toBe(200);
    expect((await scopedApp('staff').request(API_PATHS.postsReport, request)).status).toBe(200);
    expect((await scopedApp('none').request(API_PATHS.postsReport, request)).status).toBe(403);
  });

  it('restricts report queue access to staff', async () => {
    const request = { method: 'GET', headers };

    expect((await scopedApp('member').request(API_PATHS.reports, request)).status).toBe(403);
    expect((await scopedApp('staff').request(API_PATHS.reports, request)).status).toBe(200);
    expect((await scopedApp('none').request(API_PATHS.reports, request)).status).toBe(403);
  });

  it('restricts report resolution to staff', async () => {
    const request = {
      method: 'POST',
      headers,
      body: JSON.stringify({ reportId: 'report-1', action: 'dismiss' }),
    };

    expect((await scopedApp('member').request(API_PATHS.reportResolve, request)).status).toBe(403);
    expect((await scopedApp('staff').request(API_PATHS.reportResolve, request)).status).toBe(200);
    expect((await scopedApp('none').request(API_PATHS.reportResolve, request)).status).toBe(403);
  });

  it('restricts member bans to staff', async () => {
    const request = {
      method: 'POST',
      headers,
      body: JSON.stringify({ memberId: 'member-1', banned: true, reason: 'Repeated abuse' }),
    };

    expect((await scopedApp('member').request(API_PATHS.memberBan, request)).status).toBe(403);
    expect((await scopedApp('staff').request(API_PATHS.memberBan, request)).status).toBe(200);
    expect((await scopedApp('none').request(API_PATHS.memberBan, request)).status).toBe(403);
  });

  it('returns the banned code when a suspended member creates a post', async () => {
    const response = await scopedApp('banned-member').request(API_PATHS.postsCreate, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contextKind: 'space', contextId: 'space-1', body: 'A new post' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'banned' } });
  });

  it('returns the banned code when a suspended member reports a post', async () => {
    const response = await scopedApp('banned-member').request(API_PATHS.postsReport, {
      method: 'POST',
      headers,
      body: JSON.stringify({ postId: 'post-1', reason: 'spam' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'banned' } });
  });

  it('maps a tombstoned grant mutation to conflict', async () => {
    const response = await scopedApp('staff', {
      memberDeletedAt: '2026-07-12T00:00:00.000Z',
    }).request(API_PATHS.grantsCreate, {
      method: 'POST',
      headers,
      body: JSON.stringify({ memberId: 'member-1', productId: 'acme-published' }),
    });

    expect(response.status).toBe(409);
  });

  it('allows only a member to export their own data', async () => {
    expect(
      (await scopedApp('member').request(API_PATHS.memberDataExport, { headers })).status,
    ).toBe(200);
    expect(
      (await scopedApp('staff').request(API_PATHS.memberDataExport, { headers })).status,
    ).toBe(403);
    expect(
      (await scopedApp('none').request(API_PATHS.memberDataExport, { headers })).status,
    ).toBe(403);
  });

  it('enforces member and staff erasure-request scopes', async () => {
    const memberApp = scopedApp('member');
    const staffApp = scopedApp('staff');
    const noneApp = scopedApp('none');
    expect(
      (await memberApp.request(API_PATHS.memberErasureRequest, { headers })).status,
    ).toBe(200);
    expect(
      (
        await memberApp.request(API_PATHS.memberErasureRequest, {
          method: 'POST',
          headers,
          body: JSON.stringify({ confirmEmail: 'user@acme.test' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await memberApp.request(API_PATHS.memberErasureRequest, {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(404);
    expect(
      (await staffApp.request(API_PATHS.memberErasureRequest, { headers })).status,
    ).toBe(403);
    expect(
      (await noneApp.request(API_PATHS.memberErasureRequest, { headers })).status,
    ).toBe(403);
    expect(
      (await staffApp.request(API_PATHS.memberErasureRequests, { headers })).status,
    ).toBe(200);
    expect(
      (await memberApp.request(API_PATHS.memberErasureRequests, { headers })).status,
    ).toBe(403);
    expect(
      (
        await staffApp.request(
          API_PATHS.memberErasureReject.replace(':requestId', 'request-1'),
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ note: 'Accounting retention' }),
          },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await memberApp.request(
          API_PATHS.memberErasureReject.replace(':requestId', 'request-1'),
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ note: 'No' }),
          },
        )
      ).status,
    ).toBe(403);
  });

  it('denies support messages from a session without member or staff scope', async () => {
    const response = await scopedApp('none').request(API_PATHS.supportMessage, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subject: 'Help', body: 'Body' }),
    });

    expect(response.status).toBe(403);
  });

  it('permits members to send support messages', async () => {
    const response = await scopedApp('member').request(API_PATHS.supportMessage, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subject: 'Help', body: 'Body' }),
    });

    expect(response.status).toBe(200);
  });

  it('denies members and permits staff on order reconciliation', async () => {
    expect(
      (await scopedApp('member').request(API_PATHS.ordersReconciliation, { headers })).status,
    ).toBe(403);
    expect(
      (await scopedApp('staff').request(API_PATHS.ordersReconciliation, { headers })).status,
    ).toBe(200);
  });

  it('restricts storage probing and configuration to an owner', async () => {
    const body = JSON.stringify({
      provider: 'minio',
      endpoint: 'http://127.0.0.1:19000',
      region: 'us-east-1',
      bucket: 'together-test',
      accessKeyId: 'minio-access',
      secretAccessKey: 'minio-secret',
    });
    const request = { method: 'POST', headers, body };

    expect((await scopedApp('staff').request(API_PATHS.storageProbe, request)).status).toBe(403);
    expect((await scopedApp('staff').request(API_PATHS.storageConfigure, request)).status).toBe(403);
    expect((await scopedApp('owner').request(API_PATHS.storageProbe, request)).status).toBe(200);

    const configured = await scopedApp('owner').request(API_PATHS.storageConfigure, request);
    expect(configured.status).toBe(200);
    const payload = await configured.json();
    expect(payload).toMatchObject({
      ok: true,
      data: {
        diagnostic: { code: 'storage.available' },
        secret: { key: 's3.configuration', maskedPreview: '••••' },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('minio-access');
    expect(JSON.stringify(payload)).not.toContain('minio-secret');
  });
});

describe('public route manifest', () => {
  it('records the six approved mutating surfaces', () => {
    const mutatingSurfaces = new Set(PUBLIC_ROUTE_MANIFEST
      .filter((route) => route.mutating)
      .map((route) => route.why));

    expect(mutatingSurfaces).toEqual(new Set([
      'Unsubscribe preference changes',
      'Double opt-in confirmation',
      'Amazon SNS delivery webhook',
      'Stripe payment webhook',
      'Checkout session start',
      'Login, recovery, and magic-link authentication surface',
    ]));
  });
});

describe('social preview route', () => {
  it('renders tenant metadata for a crawler', async () => {
    const response = await buildApp(deps()).request('/', {
      headers: { host: 'acme.localhost:48730', 'user-agent': 'Twitterbot/1.0' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('property="og:title" content="Acme"');
  });

  it.each([
    ['browser', '/', 'Mozilla/5.0', 'acme.localhost:48730'],
    ['asset', '/assets/app.js', 'Twitterbot/1.0', 'acme.localhost:48730'],
    ['unknown tenant', '/', 'Twitterbot/1.0', 'unknown.localhost:48730'],
  ])('falls through for a %s request', async (_name, path, userAgent, host) => {
    const response = await buildApp(deps()).request(path, {
      headers: { host, 'user-agent': userAgent },
    });

    expect(response.status).toBe(404);
  });
});

describe('single-tenant mode', () => {
  const singleTenantApp = (tenant: Tenant) => {
    const base = deps({ tenants: [tenant], authenticated: true });
    return buildApp({
      ...base,
      singleTenantMode: true,
      authPort: {
        ...base.authPort,
        getAuthenticatedUser: async () => ({ userId: 'user-1', email: 'owner@acme.test', name: 'Owner' }),
      },
      tenantAccess: {
        ...base.tenantAccess,
        findStaffGrant: async () => ({ tenant, staffRole: 'owner' }),
      },
    });
  };

  it('serves the panel on the bare base host when no base domain is configured', async () => {
    const response = await singleTenantApp(acme).request(API_PATHS.products, {
      headers: { host: 'localhost:48730' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { products: [{ id: 'acme-published' }, { id: 'acme-draft' }] },
    });
  });

  it('refuses a suspended sole tenant', async () => {
    const response = await singleTenantApp({ ...acme, status: 'suspended' }).request(API_PATHS.products, {
      headers: { host: 'localhost:48730' },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
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
  it('reports public capabilities with CORS headers when no credentials are configured', async () => {
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
        tenantCreationEnabled: true,
      },
    });
  });

  it('handles auth-config preflight before auth middleware', async () => {
    const response = await buildApp(deps()).request(API_PATHS.authConfig, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://creator.example',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('reports Google enabled when the composition provides credentials', async () => {
    const app = buildApp({ ...deps(), authConfig: { googleEnabled: true } });

    const response = await app.request(API_PATHS.authConfig);
    const body: unknown = await response.json();

    expect(body).toMatchObject({ ok: true, data: { googleEnabled: true } });
  });

  it('reports bootstrap tenant creation only while no tenant exists', async () => {
    const empty = buildApp({ ...deps({ tenants: [] }), tenantCreationMode: 'bootstrap' });
    const populated = buildApp({ ...deps(), tenantCreationMode: 'bootstrap' });

    const emptyBody: unknown = await (await empty.request(API_PATHS.authConfig)).json();
    const populatedBody: unknown = await (await populated.request(API_PATHS.authConfig)).json();

    expect(emptyBody).toMatchObject({ ok: true, data: { tenantCreationEnabled: true } });
    expect(populatedBody).toMatchObject({ ok: true, data: { tenantCreationEnabled: false } });
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
  const captures = new Map<
    string,
    Parameters<AppDeps['checkoutConsentCaptures']['create']>[1]
  >();
  const base = deps();
  const checkoutSessions: Parameters<AppDeps['payment']['createCheckoutSession']>[0][] = [];
  const app = buildApp({
    ...base,
    tenants: {
      ...base.tenants,
      findSettings: async (tenantId) =>
        tenantId === acme.id
          ? {
              name: acme.name,
              socialLinks: [],
              billingPortalUrl: null,
              bunnyStreamLibraryId: null,
              logoUrl: null,
              accentColor: null,
              faviconUrl: null,
              ogTitle: null,
              ogDescription: null,
              ogImageUrl: null,
              supportEmail: null,
              supportUrl: null,
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
    payment: {
      ...base.payment,
      createCheckoutSession: async (input) => {
        checkoutSessions.push(input);
        return ok({ url: 'https://checkout.local/cs', sessionId: 'cs' });
      },
    },
    checkoutConsentCaptures: {
      create: async (_tenantId, capture) => {
        captures.set(capture.id, structuredClone(capture));
      },
      findById: async (_tenantId, id) =>
        structuredClone(captures.get(id)?.capture ?? null),
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
  return { app, captures, checkoutSessions, recorded };
};

describe('checkout consent ordering', () => {
  it('does not record consent when a real checkout session is only started', async () => {
    const { app, captures, checkoutSessions, recorded } = consentApp(false);
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
    expect(recorded).toEqual([]);
    expect(checkoutSessions[0]?.checkoutConsentCaptureId).toBe('id-1');
    expect(captures.get('id-1')?.capture).toMatchObject({
      termsAccepted: true,
      selectedDefinitionIds: [],
      attachedDefinitionIds: [],
      collectedAt: '2026-07-12T00:00:00.000Z',
      confirmationBaseUrl: 'http://acme.localhost:48730/marketing/confirm',
    });
  });

  it('records simulated-checkout consent only after purchase fulfillment', async () => {
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

  it('records locally captured consent after a real webhook and stays idempotent', async () => {
    const definitionId = 'webhook-news';
    const attached = {
      ...product({
        id: 'webhook-product',
        tenantId: acme.id,
        title: 'Webhook Product',
        published: true,
      }),
      checkoutConsentDefinitionIds: [definitionId],
    };
    const marketing = marketingDeps();
    await marketing.definitions.create(
      acme.id,
      {
        id: definitionId,
        tenantId: acme.id,
        key: definitionId,
        kind: 'optional_marketing',
        channel: 'email',
        doubleOptIn: false,
        documentRef: { mode: 'url', url: 'https://acme.example/webhook-news' },
        status: 'active',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
      {
        id: `${definitionId}-v1`,
        tenantId: acme.id,
        definitionId,
        version: 1,
        label: 'Webhook news',
        documentVersionRef: {
          mode: 'url',
          url: 'https://acme.example/webhook-news',
        },
        createdAt: '2026-07-12T00:00:00.000Z',
        createdBy: null,
      },
    );
    const base = deps({ products: [attached] });
    const recorded: TermsConsent[] = [];
    const order: Order = {
      id: 'order-webhook',
      tenantId: acme.id,
      memberId: 'member-webhook',
      productId: attached.id,
      priceId: null,
      kind: 'one_time',
      status: 'paid',
      amountCents: 1000,
      currency: 'PLN',
      provider: 'stripe',
      providerObjectIds: { checkoutSession: 'cs_webhook' },
      couponId: null,
      discountCents: 0,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    const event: PaymentWebhookEvent = {
      id: 'evt_webhook',
      type: 'checkout.session.completed',
      objectId: 'cs_webhook',
      checkoutSession: {
        email: 'webhook-buyer@together.dev',
        subscriptionId: null,
        paymentIntentId: 'pi_webhook',
        metadata: {
          tenantId: acme.id,
          productId: attached.id,
          priceId: null,
          memberEmail: null,
          language: 'pl',
          checkoutConsentCaptureId: 'capture-webhook',
        },
      },
    };
    const claimedEvents = new Set<string>();
    let orderResult: Order | null = order;
    const orderLookups: Record<string, string>[] = [];
    const logger = { error: vi.fn() };
    const deferredEffects: Array<() => Promise<void>> = [];
    let invoiceRequests = 0;
    let deferredLookupFails = false;
    const app = buildApp({
      ...base,
      marketing,
      logger,
      tenants: {
        ...base.tenants,
        findSettings: async (tenantId) =>
          tenantId === acme.id
            ? {
                name: acme.name,
                socialLinks: [],
                billingPortalUrl: null,
                bunnyStreamLibraryId: null,
                logoUrl: null,
                accentColor: null,
                faviconUrl: null,
                ogTitle: null,
                ogDescription: null,
                ogImageUrl: null,
                supportEmail: null,
                supportUrl: null,
                termsUrl: 'https://acme.example/terms-v2',
                privacyUrl: 'https://acme.example/privacy-v3',
                autoIssueInvoices: true,
                autoIssueInvoiceScope: 'all',
                invoiceVatRatePercent: 23,
                invoicingProvider: 'ifirma',
                invoiceSellerName: 'Acme',
                invoiceSellerAddress: 'Warsaw',
              }
            : null,
      },
      orderDetails: {
        findById: async () => ({
          ...order,
          billing: null,
          memberEmail: 'webhook-buyer@together.dev',
          memberName: 'Webhook Buyer',
          productTitle: attached.title,
          couponCode: null,
        }),
      },
      invoices: {
        ...base.invoices,
        create: async () => {
          invoiceRequests += 1;
          return true;
        },
      },
      deferredEffects: {
        schedule: (effect) => {
          deferredEffects.push(effect);
        },
      },
      consents: {
        ...base.consents,
        record: async (_tenantId, consent) => {
          recorded.push(consent);
        },
      },
      checkoutConsentCaptures: {
        create: async () => undefined,
        findById: async (_tenantId, id) =>
          id === 'capture-webhook'
            ? {
                termsAccepted: true,
                selectedDefinitionIds: [definitionId],
                attachedDefinitionIds: [definitionId],
                collectedAt: '2026-07-12T00:00:00.000Z',
                confirmationBaseUrl: 'https://acme.example/marketing/confirm',
                ip: '203.0.113.90',
                userAgent: 'Webhook Browser/99',
              }
            : null,
      },
      payment: {
        ...base.payment,
        verifyWebhookEvent: async () => ok(event),
      },
      processedPaymentEvents: {
        claim: async (_tenantId, paymentEvent) => {
          if (claimedEvents.has(paymentEvent.id)) return 'duplicate';
          claimedEvents.add(paymentEvent.id);
          return 'claimed';
        },
        finalize: async () => undefined,
        release: async () => undefined,
      },
      paymentRefunds: {
        ...base.paymentRefunds,
        findOrderByProviderObjectIds: async (_tenantId, providerObjectIds) => {
          if (deferredLookupFails) throw new Error('invoice lookup failed');
          orderLookups.push(providerObjectIds);
          return orderResult;
        },
      },
      prices: {
        ...base.prices,
        findById: async (_tenantId, priceId) =>
          priceId === 'price-webhook-monthly'
            ? {
                id: priceId,
                tenantId: acme.id,
                productId: attached.id,
                kind: 'recurring',
                interval: 'month',
                amountCents: 900,
                currency: 'PLN',
                active: true,
                createdAt: '2026-07-12T00:00:00.000Z',
              }
            : null,
      },
      devEndpoints: { simulatedPayments: false, exposeMagicLinks: false },
    });
    const deliver = () =>
      app.request('/api/webhooks/stripe/t-acme', {
        method: 'POST',
        headers: { 'stripe-signature': 'test-signature' },
        body: '{}',
      });

    expect((await deliver()).status).toBe(200);
    expect(invoiceRequests).toBe(0);
    expect(orderLookups).toEqual([{ checkoutSession: 'cs_webhook' }]);
    orderLookups.length = 0;
    expect(deferredEffects).toHaveLength(1);
    await deferredEffects.shift()?.();
    expect(invoiceRequests).toBe(1);
    expect(orderLookups).toEqual([{ checkoutSession: 'cs_webhook' }]);
    orderLookups.length = 0;
    expect((await deliver()).status).toBe(200);
    expect(recorded).toEqual([
      expect.objectContaining({
        email: 'webhook-buyer@together.dev',
        source: 'checkout',
      }),
    ]);
    expect(
      await marketing.marketingConsents.listByEmail(
        acme.id,
        'webhook-buyer@together.dev',
      ),
    ).toMatchObject([
      {
        status: 'granted',
        evidence: {
          ip: '203.0.113.90',
          userAgent: 'Webhook Browser/99',
          proofRef: 'product:webhook-product;order:order-webhook',
        },
      },
    ]);
    expect(logger.error).not.toHaveBeenCalled();

    event.id = 'evt_webhook_subscription';
    event.objectId = 'cs_webhook_subscription';
    if (event.checkoutSession !== null) {
      event.checkoutSession.subscriptionId = 'sub_webhook';
      event.checkoutSession.metadata.priceId = 'price-webhook-monthly';
    }
    orderResult = {
      ...order,
      id: 'order-webhook-subscription',
      priceId: 'price-webhook-monthly',
      kind: 'recurring',
      providerObjectIds: {
        checkoutSession: 'cs_webhook_subscription',
        subscription: 'sub_webhook',
      },
    };
    expect((await deliver()).status).toBe(200);
    expect(orderLookups.at(-1)).toEqual({
      checkoutSession: 'cs_webhook_subscription',
    });

    event.id = 'evt_webhook_missing_order';
    event.objectId = 'cs_webhook_missing_order';
    orderResult = null;
    expect((await deliver()).status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(
      '[checkout-consent] tenant=t-acme checkout=cs_webhook_missing_order order=missing',
    );

    const grantedBefore = await marketing.marketingConsents.listByEmail(
      acme.id,
      'webhook-buyer@together.dev',
    );
    event.id = 'evt_webhook_missing_capture';
    event.objectId = 'cs_webhook_missing_capture';
    orderResult = order;
    if (event.checkoutSession !== null) {
      event.checkoutSession.metadata.checkoutConsentCaptureId = 'capture-gone';
    }
    const recordedBefore = recorded.length;
    expect((await deliver()).status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(
      '[checkout-consent] tenant=t-acme capture=capture-gone missing',
    );
    expect(recorded).toHaveLength(recordedBefore);
    expect(
      await marketing.marketingConsents.listByEmail(acme.id, 'webhook-buyer@together.dev'),
    ).toEqual(grantedBefore);
    deferredLookupFails = true;
    const failingEffect = deferredEffects.at(-1);
    if (failingEffect === undefined) throw new Error('Deferred invoice effect is missing');
    await expect(failingEffect()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      '[invoice-auto] tenant=t-acme unexpected=Error: invoice lookup failed',
    );
  });

  it('captures checkout consent evidence, suppresses repeated DOI mail, and logs non-blocking failures', async () => {
    const definitionId = 'checkout-news';
    const attached = {
      ...product({ id: 'checkout-product', tenantId: acme.id, title: 'Checkout Product', published: true }),
      checkoutConsentDefinitionIds: [definitionId],
    };
    const secondAttached = {
      ...product({ id: 'checkout-product-2', tenantId: acme.id, title: 'Second Checkout Product', published: true }),
      checkoutConsentDefinitionIds: [definitionId],
    };
    const marketing = marketingDeps();
    await marketing.definitions.create(acme.id, {
      id: definitionId,
      tenantId: acme.id,
      key: 'checkout-news',
      kind: 'optional_marketing',
      channel: 'email',
      doubleOptIn: true,
      documentRef: { mode: 'url', url: 'https://acme.example/newsletter' },
      status: 'active',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    }, {
      id: 'checkout-news-v1',
      tenantId: acme.id,
      definitionId,
      version: 1,
      label: 'Send me product news',
      documentVersionRef: { mode: 'url', url: 'https://acme.example/newsletter' },
      createdAt: '2026-07-12T00:00:00.000Z',
      createdBy: null,
    });
    const logger = { error: vi.fn() };
    const base = deps({ products: [attached, secondAttached], logger });
    const queued: string[] = [];
    let failEnqueue = false;
    const app = buildApp({
      ...base,
      marketing,
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
      emailOutbox: {
        ...base.emailOutbox,
        enqueue: async (message) => {
          if (failEnqueue) return err(internal('outbox unavailable'));
          queued.push(message.to);
          return ok({ id: message.id });
        },
      },
      devEndpoints: { simulatedPayments: true, exposeMagicLinks: false },
    });
    const checkoutBody = (email: string, productId = attached.id) => ({
        email,
        productId,
        termsAccepted: true,
        marketingConsentDefinitionIds: [definitionId],
    });
    const headers = {
      'content-type': 'application/json',
      host: 'acme.localhost:48730',
      'user-agent': 'Checkout Browser/1.0',
      'x-forwarded-for': '203.0.113.8, 10.0.0.1',
    };
    const startCheckout = (email: string) => app.request(API_PATHS.checkoutSession, {
      method: 'POST',
      headers,
      body: JSON.stringify(checkoutBody(email)),
    });
    const fulfillCheckout = (email: string, productId = attached.id) =>
      purchase(app, headers, checkoutBody(email, productId));

    expect((await startCheckout('buyer@together.dev')).status).toBe(200);
    expect(queued).toEqual([]);
    expect(await marketing.marketingConsents.listByEmail(acme.id, 'buyer@together.dev')).toEqual([]);

    expect((await fulfillCheckout('buyer@together.dev')).status).toBe(200);
    expect((await fulfillCheckout('buyer@together.dev', secondAttached.id)).status).toBe(200);
    expect(queued).toEqual(['buyer@together.dev']);
    expect(await marketing.marketingConsents.listByEmail(acme.id, 'buyer@together.dev')).toMatchObject([{
      evidence: {
        ip: '203.0.113.8',
        userAgent: 'Checkout Browser/1.0',
        proofRef: expect.stringContaining('product:checkout-product;order:'),
      },
    }]);

    failEnqueue = true;
    expect((await fulfillCheckout('failure@together.dev')).status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[checkout-consent] tenant=t-acme'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('outbox unavailable'));
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

describe('scheduler operator routes', () => {
  it('requires the operator secret and returns global totals with the per-tenant detail', async () => {
    const marketing = marketingDeps();
    await marketing.runs.start({
      id: 'run-global',
      kind: 'outbox_dispatch',
      trigger: 'cron',
      startedAt: '2026-07-26T10:00:00.000Z',
      finishedAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      totals: {
        campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0, reEnqueued: false,
      },
      createdAt: '2026-07-26T10:00:00.000Z',
    });
    await marketing.runs.finalize('run-global', {
      finishedAt: '2026-07-26T10:00:01.000Z',
      durationMs: 1000,
      status: 'completed',
      error: null,
      totals: {
        campaignsTouched: 0, sendsAttempted: 4, sent: 3, failed: 1, skipped: 0, reEnqueued: false,
      },
      tenants: [{
        id: 'run-global-tenant-acme',
        runId: 'run-global',
        tenantId: 't-acme',
        campaignsTouched: 0,
        batchSize: 4,
        sent: 3,
        failed: 1,
        skipped: 0,
        budgetComputed: 25,
        budgetUsed: 4,
        errors: ['SES rejected'],
        createdAt: '2026-07-26T10:00:01.000Z',
      }],
    });
    const app = marketingApp(marketing);

    expect((await app.request(API_PATHS.globalSchedulerRuns)).status).toBe(401);
    const response = await app.request(`${API_PATHS.globalSchedulerRuns}?kind=outbox_dispatch`, {
      headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: 'test-marketing-cron-secret' },
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: { runs: [{ id: 'run-global', totals: { sent: 3, failed: 1 } }] },
    });

    const detailResponse = await app.request(
      API_PATHS.globalSchedulerRun.replace(':id', 'run-global'),
      { headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: 'test-marketing-cron-secret' } },
    );
    const detailBody: unknown = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody).toMatchObject({
      data: {
        run: { id: 'run-global', totals: { sent: 3, failed: 1 } },
        tenants: [{ tenantId: 't-acme', budgetUsed: 4, errors: ['SES rejected'] }],
      },
    });
  });
});
