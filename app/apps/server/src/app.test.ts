import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  API_PATHS,
  API_ROUTES,
  capabilitiesForPrincipal,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  TENANT_HEADER,
} from '#core/contract/index.js';
import {
  BETTER_AUTH_EMAIL_VERIFICATION_PATH,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
  BETTER_AUTH_SIGN_UP_PATH,
} from '#adapters/auth/create-auth.js';
import type { AppDeps, MarketingAppDeps } from './composition.js';
import { selectDevEndpoints, selectPlatformReset } from './composition.js';
import { buildApp } from './app.js';
import { PUBLIC_ROUTE_MANIFEST, publicRouteManifestEntry } from './public-route-manifest.js';
import { selectPublicRateLimitPolicies } from './public-rate-limit.js';
import { selfAuthenticatingRouteManifestEntry } from './self-authenticating-route-manifest.js';
import {
  err,
  emailEventSchema,
  forbidden,
  integrationUnavailable,
  internal,
  MAGIC_LINK_LANGUAGE_HEADER,
  notFound,
  ok,
  type Course,
  type CourseLesson,
  type CourseModule,
  type ImportAuditEvent,
  type Member,
  type Membership,
  type LessonAttachment,
  type Notification,
  type Order,
  type Post,
  type Product,
  type ProductDownloadAsset,
  type ProductGrant,
  type Space,
  type SpaceEvent,
  type Tenant,
  type TenantApiKey,
  type TenantDomain,
  type TenantSesSettings,
  type TermsConsent,
  type TenantApiKeyScope,
} from '#core/domain/index.js';
import {
  authorize,
  dispatchAutoInvoiceJobs,
  type AutoInvoiceJob,
  type PaymentWebhookEvent,
} from '#core/server/index.js';
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
  InMemoryEmailOutboxRepository,
  InMemoryMarketingAudienceRepository,
  InMemoryMarketingConsentRepository,
  InMemorySchedulerRunRepository,
  InMemoryMarketingThrottleRepository,
  InMemorySuppressionRepository,
  InMemorySnsWebhookDeliveryRepository,
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
  createdAt: '1998-07-12T00:00:00.000Z',
});

const readOnlyImportUsers = (repository: AppDeps['importUsers']): AppDeps['importUsersReader'] => ({
  findAuthUserByEmail: repository.findAuthUserByEmail,
  findMemberById: repository.findMemberById,
  findMemberByEmail: repository.findMemberByEmail,
  findGrantById: repository.findGrantById,
  findGrantByPair: repository.findGrantByPair,
  findProgressById: repository.findProgressById,
  findProgressByPair: repository.findProgressByPair,
});

const deps = (input: {
  tenants?: Tenant[];
  domains?: TenantDomain[];
  products?: Product[];
  lessons?: CourseLesson[];
  getAuthenticatedUser?: AppDeps['authPort']['getAuthenticatedUser'];
  authenticated?: boolean;
  databaseUp?: boolean;
  schemaStatus?: Awaited<ReturnType<AppDeps['health']['schemaStatus']>>;
  dispatchEmails?: AppDeps['dispatchEmails'];
  dispatchAutoInvoices?: AppDeps['dispatchAutoInvoices'];
  autoInvoiceJobs?: Parameters<Parameters<AppDeps['paymentTransaction']['run']>[0]>[0]['autoInvoiceJobs'];
  paymentRefunds?: AppDeps['paymentRefunds'];
  rateLimitBuckets?: AppDeps['rateLimitBuckets'];
  logger?: AppDeps['logger'];
  passwordAccounts?: readonly string[];
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
      clearMagicLinkDeliveryContext: () => undefined,
      setResetPasswordDeliveryContext: () => undefined,
      clearResetPasswordDeliveryContext: () => undefined,
      setEmailVerificationDeliveryContext: () => undefined,
      clearEmailVerificationDeliveryContext: () => undefined,
    },
    authPort: {
      getAuthenticatedUser: input.getAuthenticatedUser ?? (async () => {
        if (!input.authenticated) throw new Error('Public route must not authenticate');
        return null;
      }),
      listSessions: async () => [],
      revokeSessions: async () => undefined,
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
      updateDisplayName: async () => null,
      updateDmOptOut: async () => null,
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
    paymentRefunds: input.paymentRefunds ?? {
      findOrderByProviderObjectIds: async () => null,
      findLatestSubscriptionOrder: async () => null,
      listAccessRetainingOrdersForMemberProduct: async () => [],
      markOrderRefunded: async () => null,
      markOrderPartiallyRefunded: async () => null,
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
    importAuditEvents: {
      append: async () => undefined,
      findLatestByImportKey: async () => null,
      listByApiKey: async () => ({ events: [], nextCursor: null }),
    },
    importContent: {
      commit: async () => 'saved',
    },
    importUsersReader: {
      findAuthUserByEmail: async () => null,
      findMemberById: async () => null,
      findMemberByEmail: async () => null,
      findGrantById: async () => null,
      findGrantByPair: async () => null,
      findProgressById: async () => null,
      findProgressByPair: async () => null,
    },
    importUsers: {
      findAuthUserByEmail: async () => null,
      findMemberById: async () => null,
      findMemberByEmail: async () => null,
      findGrantById: async () => null,
      findGrantByPair: async () => null,
      findProgressById: async () => null,
      findProgressByPair: async () => null,
      commit: async () => 'saved',
    },
    contentHash: {
      sha256: () => 'a'.repeat(64),
    },
    apiKeyRateLimits: {
      claim: async () => true,
      release: async () => undefined,
    },
    rateLimitBuckets: input.rateLimitBuckets ?? {
      claim: async () => true,
      purgeExpired: async () => 0,
    },
    publicRateLimitPolicies: selectPublicRateLimitPolicies({}),
    m2mTransactionalRateLimits: { perMinute: 60, perDay: 5000 },
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
    bunnyTokenSigner: {
      signEmbedToken: ({ videoId, expires }) => `${videoId}-${expires}`,
      signHlsPlaylistUrl: ({ cdnHostname, videoId, expires }) =>
        `https://${cdnHostname}/${videoId}/playlist.m3u8?expires=${expires}`,
    },
    playbackTokenTtlSeconds: 21_600,
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
    dmOptOutAt: null,
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
          updateDisplayName: async () => null,
          updateDmOptOut: async () => null,
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
          autoInvoiceJobs: input.autoInvoiceJobs ?? {
            enqueue: async () => true,
            claimDue: async () => null,
            reschedule: async () => undefined,
            complete: async () => undefined,
          },
          processedPaymentEvents: appDeps.processedPaymentEvents,
          enrollmentTransaction: appDeps.enrollmentTransaction,
        }),
    },
    dispatchEmails: input.dispatchEmails ?? (async () => ok({ attemptsMade: 0, sentCount: 0, failedCount: 0 })),
    drainNotificationFanout: async () => ok({ jobsClaimed: 0, notificationsCreated: 0, jobsFailed: 0 }),
    dispatchAutoInvoices: input.dispatchAutoInvoices ?? (async () => ok({
      processed: false,
      processedCount: 0,
      orderId: null,
    })),
    dispatchEmail: () => undefined,
    emailDispatchSecret: 'test-email-dispatch-secret',
    emailDispatchCronSecret: 'test-email-dispatch-cron-secret',
    autoInvoiceDispatchSecret: 'test-auto-invoice-dispatch-secret',
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
      update: async () => null,
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
      list: async (tenantId) => (input.lessons ?? []).filter((lesson) => lesson.tenantId === tenantId),
      listPreviews: async () => [],
      findById: async (tenantId, id) =>
        (input.lessons ?? []).find((lesson) => lesson.tenantId === tenantId && lesson.id === id) ?? null,
      findByIds: async (tenantId, ids) =>
        (input.lessons ?? []).filter((lesson) => lesson.tenantId === tenantId && ids.includes(lesson.id)),
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
    avatarSources: {
      listAvatarSources: async () => [],
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
      listThreadsForSpaces: async () => ({ threads: [], nextCursor: null }),
      listReplies: async () => [],
      updateBody: async () => null,
      softDelete: async () => null,
      setPinned: async () => null,
      listPinnedForContext: async () => [],
      countPinnedForContext: async () => 0,
      latestRootPostAt: async () => new Map(),
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
      listFollowersPage: async () => [],
      listForUser: async () => [],
    },
    spaceSeen: {
      markSeen: async () => undefined,
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
      listSubscribersPage: async () => [],
      listForUser: async () => [],
    },
    events: {
      findById: async () => null,
      insert: async (_tenantId, spaceEvent) => spaceEvent,
      update: async () => null,
      softDelete: async () => null,
      listForSpace: async () => ({ events: [], nextCursor: null }),
      listUpcomingForSpaces: async () => [],
    },
    eventRsvps: {
      upsert: async (tenantId, rsvp) => ({ tenantId, ...rsvp }),
      countsForEvents: async () => new Map(),
      listForViewer: async () => [],
    },
    dmConversations: {
      findById: async () => null,
      findByParticipants: async () => null,
      insert: async (_tenantId, conversation) => conversation,
      listForParticipant: async () => ({ conversations: [], nextCursor: null }),
      countCreatedBySince: async () => 0,
      countUnreadForParticipant: async () => 0,
      applyLastMessage: async () => null,
    },
    dmMessages: {
      insert: async (_tenantId, message) => message,
      listForConversation: async () => ({ messages: [], nextCursor: null }),
      countRecentBySender: async () => 0,
    },
    dmConversationStates: {
      findForViewer: async () => [],
      markRead: async (tenantId, input) => ({ tenantId, ...input }),
    },
    fanoutJobs: { claimDue: async () => [], save: async () => undefined },
    notifications: {
      insert: async (_tenantId, notification) => notification,
      insertMany: async (_tenantId, batch) => batch,
      listForRecipient: async () => ({ notifications: [], nextCursor: null }),
      markRead: async () => null,
      markAllRead: async () => 0,
      unreadCount: async () => 0,
      hasUnreadDmNotification: async () => false,
      markDmConversationRead: async () => 0,
    },
    notificationChannels: [],
    realtimeBus: {
      publish: () => undefined,
      subscribe: () => () => undefined,
    },
    links: {
      conversationUrl: ({ conversationId }) => `http://localhost/messages/${conversationId}`,
      eventUrl: ({ spaceId, eventId }) => `http://localhost/community/${spaceId}/events/${eventId}`,
      lessonDiscussionUrl: ({ lessonId }) => `http://localhost/my/courses/c1/lessons/${lessonId}`,
      spaceUrl: ({ spaceId, rootPostId }) =>
        `http://localhost/community/${spaceId}${rootPostId === undefined ? '' : `/posts/${rootPostId}`}`,
    },
    tenantDomains: {
      findByDomain: async (domain) => domains.find((candidate) => candidate.domain === domain) ?? null,
      listVerifiedDomains: async () => domains,
      listByTenant: async (tenantId) => domains.filter((candidate) => candidate.tenantId === tenantId),
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
          billingPortalUrl: null, bunnyStreamLibraryId: null, bunnyStreamCdnHostname: null, logoUrl: null, logoDarkUrl: null,
          accentColor: null, faviconUrl: null, ogTitle: null, ogDescription: null,
          ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
          privacyUrl: null,
          defaultHomeSpaceId: null,
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
    signInMethods: {
      hasCredentialAccount: async (_tenantId, email) =>
        (input.passwordAccounts ?? []).includes(email),
    },
    health: {
      pingDatabase: async () => input.databaseUp ?? true,
      schemaStatus: async () => input.schemaStatus ?? {
        expectedMigrations: 82,
        appliedMigrations: 82,
        schemaCurrent: true,
        schemaFingerprint: 'c087b16a6bb6',
        schemaFingerprintMatch: true,
      },
    },
    appVersion: '0.1.0-test',
    commitSha: 'test-sha',
    deploymentIdentity: {
      environment: 'preview',
      production: false,
      commit: 'test-sha',
      databaseFingerprint: 'b1bfbb98b4f7',
    },
    tenantCreationMode: 'open',
    ids: { nextId: () => `id-${String(++nextId)}` },
    clock: { nowIso: () => '1998-07-12T00:00:00.000Z' },
    logger: input.logger ?? { error: () => undefined, warn: () => undefined },
    baseDomain: 'localhost',
    platformHost: 'start.localhost',
    singleTenantMode: false,
    appBaseUrl: 'http://localhost:48730',
    customDomainTarget: 'start.localhost',
    devEndpoints: { simulatedPayments: false, exposeMagicLinks: false },
    authConfig: { googleEnabled: false },
    authTrustedProxyHeader: null,
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
    createdAt: '1998-07-12T00:00:00.000Z',
    deletedAt: options.memberDeletedAt ?? null,
    bannedAt: scope === 'banned-member' ? '1998-07-12T00:00:00.000Z' : null,
    bannedReason: null,
    bannedByUserId: null,
    dmOptOutAt: null,
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
    createdAt: '1998-07-12T00:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
  };
  return buildApp({
    ...base,
    authPort: {
      ...base.authPort,
      getAuthenticatedUser: async () => ({
        sessionId: 'session-1',
        userId: 'user-1',
        email: 'user@acme.test',
        name: 'User',
        emailVerified: true,
        image: null,
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
        publicReadOnly: false,
        position: 0,
        archivedAt: null,
        createdAt: '1998-07-12T00:00:00.000Z',
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
        createdAt: '1998-07-12T00:00:00.000Z',
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
        createdAt: '1998-07-12T00:00:00.000Z',
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
  snsDeliveries: new InMemorySnsWebhookDeliveryRepository(),
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
      document: { id: 'document-1', tenantId, slug, title: 'Terms', status: 'published', createdAt: '1998-07-22T00:00:00.000Z', updatedAt: '1998-07-22T00:00:00.000Z' },
      version: { id: 'version-1', tenantId, documentId: 'document-1', version: 1, content: 'Immutable terms', publishedAt: '1998-07-22T00:00:00.000Z', createdAt: '1998-07-22T00:00:00.000Z', createdBy: 'staff' },
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

const marketingApp = (
  marketing = marketingDeps(),
  logger?: AppDeps['logger'],
): ReturnType<typeof buildApp> => {
  const configured = deps(logger === undefined ? {} : { logger });
  configured.marketing = marketing;
  configured.tenantApiKeys = {
    listByTenant: async () => [],
    create: async () => undefined,
    findActiveByHash: async (tenantId, hash) => tenantId === 't-acme' && hash === 'hash:marketing-key' ? {
      id: 'api-key-1', tenantId, name: 'Marketing', keyHash: hash,
      scopes: null,
      createdAt: '1998-07-22T00:00:00.000Z', expiresAt: null, revokedAt: null,
    } : null,
    revoke: async () => null,
  };
  return buildApp(configured);
};

const transactionalM2mApp = (options: {
  scopes?: readonly ('enrollment' | 'marketing' | 'transactional')[];
  transport?: boolean;
  perMinute?: number;
} = {}) => {
  const configured = deps();
  const marketing = marketingDeps();
  const events = new InMemoryEmailEventRepository();
  marketing.events = events;
  const outbox = new InMemoryEmailOutboxRepository(events);
  const counts = new Map<string, number>();
  configured.marketing = marketing;
  configured.emailOutbox = outbox;
  configured.tenantApiKeys = {
    listByTenant: async () => [],
    create: async () => undefined,
    findActiveByHash: async (tenantId, hash) => {
      if (tenantId !== 't-acme' || !['hash:transactional-key', 'hash:other-transactional-key'].includes(hash)) return null;
      return {
        id: hash === 'hash:transactional-key' ? 'transactional-key-id' : 'other-transactional-key-id',
        tenantId,
        name: hash === 'hash:transactional-key' ? 'orders-app' : 'billing-app',
        keyHash: hash,
        scopes: [...(options.scopes ?? ['transactional'])],
        createdAt: '1998-08-10T00:00:00.000Z',
        expiresAt: null,
        revokedAt: null,
      };
    },
    revoke: async () => null,
  };
  configured.emailTransports = {
    resolve: async () => options.transport === false ? null : configured.email,
  };
  configured.m2mTransactionalRateLimits = { perMinute: options.perMinute ?? 60, perDay: 5000 };
  configured.apiKeyRateLimits = {
    claim: async (_tenantId, claim) => {
      const key = `${claim.apiKeyId}:${claim.period}:${claim.windowStartedAt}`;
      const count = counts.get(key) ?? 0;
      if (count >= claim.limit) return false;
      counts.set(key, count + 1);
      return true;
    },
    release: async () => undefined,
  };
  return { app: buildApp(configured), marketing, outbox };
};

const importM2mApp = (options: {
  scopes?: readonly TenantApiKeyScope[] | null;
  rateLimited?: boolean;
  importUsers?: Partial<AppDeps['importUsers']>;
  overrides?: Partial<AppDeps>;
} = {}) => {
  const configured = { ...deps(), ...options.overrides };
  const mutations: Parameters<AppDeps['importContent']['commit']>[1][] = [];
  const userMutations: Parameters<AppDeps['importUsers']['commit']>[1][] = [];
  configured.tenantApiKeys = {
    listByTenant: async () => [],
    create: async () => undefined,
    findActiveByHash: async (tenantId, hash) => tenantId === 't-acme' && hash === 'hash:import-key' ? {
      id: 'import-key-id',
      tenantId,
      name: 'Migration',
      keyHash: hash,
      scopes: options.scopes === null ? null : [...(options.scopes ?? ['import:content'])],
      createdAt: '1998-08-10T00:00:00.000Z',
      expiresAt: '1998-08-20T00:00:00.000Z',
      revokedAt: null,
    } : null,
    revoke: async () => null,
  };
  configured.importContent = {
    commit: async (_tenantId, mutation) => {
      mutations.push(mutation);
      return 'saved';
    },
  };
  configured.importUsers = {
    ...configured.importUsers,
    ...options.importUsers,
    commit: async (_tenantId, mutation) => {
      userMutations.push(mutation);
      return 'saved';
    },
  };
  configured.importUsersReader = readOnlyImportUsers(configured.importUsers);
  configured.contentHash = { sha256: (content) => String(content) };
  configured.apiKeyRateLimits = {
    claim: async () => options.rateLimited !== true,
    release: async () => undefined,
  };
  return { app: buildApp(configured), mutations, userMutations };
};

const ksefApp = (
  dispatch: NonNullable<AppDeps['ksef']>['dispatch'],
  rateLimitBuckets?: AppDeps['rateLimitBuckets'],
): ReturnType<typeof buildApp> => {
  const configured = deps(rateLimitBuckets === undefined ? {} : { rateLimitBuckets });
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
      allocate: async () => ({ p2: 'FV/1998/000001', sequence: 1 }),
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
    status: 'active', createdAt: '1998-07-01T00:00:00.000Z', updatedAt: '1998-07-01T00:00:00.000Z',
  }, {
    id: 'definition-news-v1', tenantId: 't-acme', definitionId: 'definition-news', version: 1,
    label: 'Product news', documentVersionRef: { mode: 'url', url: 'https://acme.test/privacy?v=1' },
    createdAt: '1998-07-01T00:00:00.000Z', createdBy: 'staff',
  });
  await marketing.marketingConsents.record('t-acme', {
    id: 'consent-news', tenantId: 't-acme', memberId: null, email: 'member@example.test',
    definitionId: 'definition-news', definitionVersion: 1, wordingSnapshot: 'Product news',
    documentRefSnapshot: { mode: 'url', url: 'https://acme.test/privacy?v=1' }, status: 'confirmed',
    previousId: null, source: 'api', evidence: { collectedAt: '1998-07-01T00:00:00.000Z', proofRef: 'form' },
    occurredAt: '1998-07-01T00:00:00.000Z',
  });
  await marketing.unsubscribes.create('t-acme', {
    id: 'unsubscribe-news', tenantId: 't-acme', token: 'unsubscribe_token_123456789012345',
    email: 'member@example.test', memberId: null, campaignSendId: null,
    scope: 'consent:definition-news', createdAt: '1998-07-01T00:00:00.000Z', usedAt: null,
  });
  await marketing.marketingConsents.record('t-acme', {
    id: 'consent-pending', tenantId: 't-acme', memberId: null, email: 'pending@example.test',
    definitionId: 'definition-news', definitionVersion: 1, wordingSnapshot: 'Product news',
    documentRefSnapshot: { mode: 'url', url: 'https://acme.test/privacy?v=1' }, status: 'granted',
    previousId: null, source: 'api', evidence: { collectedAt: '1998-07-01T00:00:00.000Z', proofRef: 'form' },
    occurredAt: '1998-07-01T00:00:00.000Z',
  });
  await marketing.confirmations.create('t-acme', {
    id: 'confirmation-news', tenantId: 't-acme', token: 'confirmation_token_123456789012345',
    marketingConsentRowId: 'consent-pending', createdAt: '1998-07-01T00:00:00.000Z',
    expiresAt: '1998-07-20T00:00:00.000Z', usedAt: null,
  });
  return marketing;
};

describe('migration import HTTP surfaces', () => {
  const headers = {
    host: 'acme.localhost:48730',
    'x-api-key': 'import-key',
    'content-type': 'application/json',
  };

  it('authenticates, scope-checks, and imports a draft lesson through the M2M envelope', async () => {
    const { app, mutations } = importM2mApp();
    const response = await app.request(API_PATHS.m2mImportLessons, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasetVersion: 'together-import/v1',
        records: [{
          importKey: 'lesson-source',
          name: 'Lesson',
          isPreview: false,
          contents: [{ type: 'html', html: '<p>Lesson</p>' }],
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        results: [{ importKey: 'lesson-source', action: 'created', id: 'lesson-source' }],
        summary: { created: 1, updated: 0, unchanged: 0, failed: 0 },
      },
    });
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      kind: 'lesson',
      action: 'created',
      resource: { id: 'lesson-source', tenantId: 't-acme' },
      event: { apiKeyId: 'import-key-id', importKey: 'lesson-source' },
    });
  });

  it('returns record-level validation for publish attempts and preserves HTTP 200', async () => {
    const { app, mutations } = importM2mApp();
    const response = await app.request(API_PATHS.m2mImportProducts, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasetVersion: 'together-import/v1',
        records: [{
          importKey: 'product-source', type: 'course', slug: 'course', title: 'Course',
          description: '', coverUrl: null, priceCents: 0, currency: 'PLN', accessItems: [], published: true,
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        results: [{ importKey: 'product-source', action: 'error', error: { code: 'validation' } }],
        summary: { failed: 1 },
      },
    });
    expect(mutations).toEqual([]);
  });

  it('enforces validate scopes per record kind and performs no commit', async () => {
    const { app, mutations } = importM2mApp({ scopes: ['import:users'] });
    const response = await app.request(API_PATHS.m2mImportValidate, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasetVersion: 'together-import/v1',
        records: [{
          kind: 'course', importKey: 'course-source', name: 'Course', description: '',
          imageUrl: null, moduleOrder: [],
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        plan: { create: { course: 0 } },
        errors: [{ index: 0, kind: 'course', error: { code: 'forbidden' } }],
        warnings: [],
        valid: false,
      },
    });
    expect(mutations).toEqual([]);
  });

  it('rejects unscoped keys and returns retry metadata for exhausted import limits', async () => {
    const request = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasetVersion: 'together-import/v1',
        records: [{ importKey: 'lesson-source', name: 'Lesson', isPreview: false, contents: [] }],
      }),
    };
    const forbiddenResponse = await importM2mApp({ scopes: null }).app.request(API_PATHS.m2mImportLessons, request);
    const limitedResponse = await importM2mApp({ rateLimited: true }).app.request(API_PATHS.m2mImportLessons, request);

    expect(forbiddenResponse.status).toBe(403);
    expect(await forbiddenResponse.json()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get('retry-after')).toBe('60');
    expect(await limitedResponse.json()).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });

  it('imports members passwordless and rejects credential fields', async () => {
    const marker = `pbkdf2$25000$${'ab'.repeat(32)}$${'cd'.repeat(512)}`;
    const { app, userMutations } = importM2mApp({ scopes: ['import:users'] });
    const response = await app.request(API_PATHS.m2mImportMembers, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasetVersion: 'together-import/v1',
        records: [{
          importKey: 'member-source',
          email: 'USER@example.test',
          displayName: 'Jan Kowalski',
        }, {
          importKey: 'member-with-credential',
          email: 'other@example.test',
          displayName: 'Other User',
          legacyPasswordHash: marker,
        }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        results: [
          { importKey: 'member-source', action: 'created', id: 'member-source' },
          {
            importKey: 'member-with-credential',
            action: 'error',
            error: expect.objectContaining({ code: 'validation' }),
          },
        ],
        summary: { created: 1, updated: 0, unchanged: 0, failed: 1 },
      },
    });
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(userMutations[0]).toMatchObject({
      kind: 'member',
      resource: { email: 'user@example.test' },
      authUser: { emailVerified: false },
    });
    expect(userMutations).toHaveLength(1);
    expect(userMutations[0]).not.toHaveProperty('authUser.legacyPasswordHash');
    expect(userMutations[0]).not.toHaveProperty('authUser.credentialAccountId');
    expect(userMutations[0]).not.toHaveProperty('credentialEvent');
  });

  it('keeps user import writes isolated from content-scoped keys', async () => {
    const response = await importM2mApp({ scopes: ['import:content'] }).app.request(
      API_PATHS.m2mImportMembers,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          datasetVersion: 'together-import/v1',
          records: [{
            importKey: 'member-source',
            email: 'user@example.test',
            displayName: 'User',
          }],
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('rejects native member and product references for users-scoped grant imports', async () => {
    const member = {
      id: 'member-native', tenantId: 't-acme', userId: 'user-native',
      email: 'member@example.test', displayName: 'Member', legacyId: null,
      createdAt: '1998-08-01T00:00:00.000Z',
    };
    const { app, userMutations } = importM2mApp({
      scopes: ['import:users'],
      importUsers: { findMemberById: async (_tenantId, id) => id === member.id ? member : null },
    });
    const response = await app.request(API_PATHS.m2mImportGrants, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasetVersion: 'together-import/v1',
        records: [{
          importKey: 'grant-source',
          memberKey: 'member-native',
          productKey: 'acme-draft',
          startsAt: '1998-08-01T00:00:00.000Z',
          expiresAt: null,
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { results: [{ importKey: 'grant-source', action: 'error', error: { code: 'conflict' } }] },
    });
    expect(userMutations).toEqual([]);
  });

  it('activates the progress endpoint with the minimal completion-state schema', async () => {
    const progressCourse: Course = {
      id: 'course-native', tenantId: 't-acme', name: 'Course', description: '', imageUrl: null,
      moduleOrder: ['module-native'], legacyId: null, createdAt: '1998-08-01T00:00:00.000Z',
      publiclyVisible: false,
    };
    const progressLesson: CourseLesson = {
      id: 'lesson-native', tenantId: 't-acme', name: 'Lesson', isPreview: false, contents: [],
      legacyId: null, createdAt: '1998-08-01T00:00:00.000Z',
    };
    const progressModule: CourseModule = {
      id: 'module-native', tenantId: 't-acme', courseIds: [progressCourse.id], title: 'Module',
      prefix: null, name: 'Module', legacyId: null, createdAt: '1998-08-01T00:00:00.000Z',
      chapters: [{ id: 'chapter-native', name: 'Chapter', contents: [{
        id: 'content-native', name: 'Lesson', lessonId: progressLesson.id,
      }] }],
    };
    const member = {
      id: 'member-native', tenantId: 't-acme', userId: 'user-native',
      email: 'member@example.test', displayName: 'Member', legacyId: null,
      createdAt: '1998-08-01T00:00:00.000Z',
    };
    const base = deps({ lessons: [progressLesson] });
    const lineage = new Map<string, ImportAuditEvent>([
      ['member:member-native', {
        id: 'audit-member', tenantId: 't-acme', apiKeyId: 'import-key-id', kind: 'member',
        importKey: 'member-native', resourceId: 'member-native', action: 'created',
        payloadHash: 'a'.repeat(64), at: '1998-08-01T00:00:00.000Z',
      }],
      ['course:course-native', {
        id: 'audit-course', tenantId: 't-acme', apiKeyId: 'import-key-id', kind: 'course',
        importKey: 'course-native', resourceId: 'course-native', action: 'created',
        payloadHash: 'b'.repeat(64), at: '1998-08-01T00:00:00.000Z',
      }],
      ['lesson:lesson-native', {
        id: 'audit-lesson', tenantId: 't-acme', apiKeyId: 'import-key-id', kind: 'lesson',
        importKey: 'lesson-native', resourceId: 'lesson-native', action: 'created',
        payloadHash: 'c'.repeat(64), at: '1998-08-01T00:00:00.000Z',
      }],
    ]);
    const { app, userMutations } = importM2mApp({
      scopes: ['import:users'],
      overrides: {
        importAuditEvents: {
          append: async () => undefined,
          findLatestByImportKey: async (_tenantId, kind, importKey) =>
            lineage.get(`${kind}:${importKey}`) ?? null,
          listByApiKey: async () => ({ events: [], nextCursor: null }),
        },
        courses: {
          ...base.courses,
          list: async () => [progressCourse],
          findById: async (_tenantId, id) => id === progressCourse.id ? progressCourse : null,
        },
        modules: {
          ...base.modules,
          list: async () => [progressModule],
          findById: async (_tenantId, id) => id === progressModule.id ? progressModule : null,
        },
        lessons: base.lessons,
      },
      importUsers: { findMemberById: async (_tenantId, id) => id === member.id ? member : null },
    });
    const response = await app.request(API_PATHS.m2mImportProgress, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasetVersion: 'together-import/v1',
        records: [{
          importKey: 'progress-source',
          memberKey: member.id,
          courseKey: progressCourse.id,
          completedLessonKeys: [progressLesson.id],
          updatedAt: '1998-08-10T00:00:00.000Z',
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { results: [{ importKey: 'progress-source', action: 'created' }] },
    });
    expect(userMutations[0]).toMatchObject({
      kind: 'progress',
      resource: { completedLessonIds: ['lesson-native'], courseId: 'course-native' },
    });
  });
});

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
        identityVerifiedAt: '1998-07-22T00:00:00.000Z', identityCheckedAt: null,
        identityCheckError: null, configurationSet: null, snsTopicArn: 'topic',
        snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null,
        trackingEnabled: false, autoPauseOnCritical: false, webhookToken: 'webhook-token',
        quotaRatePerSec: 10, quotaDaily: 1000, quotaSentLast24Hours: 0,
        quotaRefreshedAt: '1998-07-22T00:00:00.000Z', inSandbox: false,
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
        scopes: null,
        createdAt: '1998-07-22T00:00:00.000Z', expiresAt: null, revokedAt: null,
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
      createdAt: '1998-07-22T00:00:00.000Z', updatedAt: '1998-07-22T00:00:00.000Z',
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

  it('accepts transactional M2M mail and replays the original outbox id', async () => {
    const { app, marketing, outbox } = transactionalM2mApp();
    const request = {
      method: 'POST',
      headers: {
        host: 'acme.localhost:48730',
        'x-api-key': 'transactional-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: 'buyer@example.test',
        subject: 'Receipt',
        text: 'Paid',
        idempotencyKey: 'order-1',
      }),
    };
    const first = await app.request('/api/m2m/transactional/messages', request);
    expect(first.status).toBe(202);
    const firstBody = z.object({
      ok: z.literal(true),
      data: z.object({ messageId: z.string().min(1), statusUrl: z.string().min(1) }),
    }).parse(await first.json());
    expect(firstBody).toMatchObject({
      ok: true,
      data: { statusUrl: expect.stringMatching(/^\/api\/m2m\/transactional\/messages\//) },
    });
    const messageId = firstBody.data.messageId;
    marketing.emailSends.findById = async () => ({
      id: messageId,
      tenantId: 't-acme',
      kind: 'transactional',
      recipient: 'buyer@example.test',
      subject: 'Receipt',
      source: 'm2m-transactional',
      sourceApp: 'orders-app',
      status: 'queued',
      skipReason: null,
      failureCode: null,
      failureMessage: null,
      deliveryStatus: null,
      deliveryOccurredAt: null,
      campaignId: null,
      campaignName: null,
      sesMessageId: null,
      transport: 'platform',
      createdAt: '1998-08-10T00:00:00.000Z',
      sentAt: null,
    });
    const status = await app.request(`/api/m2m/transactional/messages/${encodeURIComponent(messageId)}`, {
      headers: { host: 'acme.localhost:48730', 'x-api-key': 'transactional-key' },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      ok: true,
      data: { send: { id: messageId, sourceApp: 'orders-app' }, events: [{ type: 'queued' }] },
    });
    const otherAppStatus = await app.request(`/api/m2m/transactional/messages/${encodeURIComponent(messageId)}`, {
      headers: { host: 'acme.localhost:48730', 'x-api-key': 'other-transactional-key' },
    });
    expect(otherAppStatus.status).toBe(404);
    const replay = await app.request('/api/m2m/transactional/messages', request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect(outbox.items).toHaveLength(1);
    expect(outbox.items[0]).toMatchObject({ sourceApp: 'orders-app', tenantTransportRequired: true });
  });

  it.each([
    { options: { scopes: ['enrollment'] as const }, status: 403, code: 'forbidden' },
    { options: { transport: false }, status: 412, code: 'integration_not_configured' },
  ])('rejects transactional M2M mail when its prerequisite is missing', async ({ options, status, code }) => {
    const { app, outbox } = transactionalM2mApp(options);
    const response = await app.request('/api/m2m/transactional/messages', {
      method: 'POST',
      headers: {
        host: 'acme.localhost:48730',
        'x-api-key': 'transactional-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: 'buyer@example.test',
        subject: 'Receipt',
        text: 'Paid',
        idempotencyKey: 'order-1',
      }),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ ok: false, error: { code } });
    expect(outbox.items).toHaveLength(0);
  });

  it('returns suppression details and rate-limit Retry-After for transactional M2M mail', async () => {
    const suppressed = transactionalM2mApp();
    await suppressed.marketing.suppressions.record('t-acme', {
      id: 'suppression-1',
      tenantId: 't-acme',
      email: 'buyer@example.test',
      emailHmac: 't-acme:buyer@example.test',
      reason: 'complaint',
      sourceRef: null,
      meta: null,
      createdAt: '1998-08-10T00:00:00.000Z',
      liftedAt: null,
      liftedBy: null,
    });
    const headers = {
      host: 'acme.localhost:48730',
      'x-api-key': 'transactional-key',
      'content-type': 'application/json',
    };
    const body = (idempotencyKey: string) => JSON.stringify({
      to: 'buyer@example.test', subject: 'Receipt', text: 'Paid', idempotencyKey,
    });
    const blocked = await suppressed.app.request('/api/m2m/transactional/messages', {
      method: 'POST', headers, body: body('suppressed-1'),
    });
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({
      ok: false,
      error: { code: 'suppressed', details: { reason: 'complaint' } },
    });
    const limited = transactionalM2mApp({ perMinute: 1 });
    expect((await limited.app.request('/api/m2m/transactional/messages', {
      method: 'POST', headers, body: body('rate-1'),
    })).status).toBe(202);
    const rateLimited = await limited.app.request('/api/m2m/transactional/messages', {
      method: 'POST', headers, body: body('rate-2'),
    });
    expect(rateLimited.status).toBe(429);
    expect(Number(rateLimited.headers.get('retry-after'))).toBeGreaterThan(0);
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
    const now = '1998-07-22T00:00:00.000Z';
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

  it('builds unsubscribe links from the API key tenant instead of the request host', async () => {
    const marketing = await memberSurfaceMarketing();
    const sender = new FakeSesMarketingSender();
    marketing.marketingSes = sender;
    marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: '1998-07-22T00:00:00.000Z', identityCheckedAt: null,
      identityCheckError: null, configurationSet: 'marketing',
      snsTopicArn: null, snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null,
      trackingEnabled: false, autoPauseOnCritical: false,
      webhookToken: 'webhook-token-123456789012', quotaRatePerSec: 10,
      quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: '1998-07-22T00:00:00.000Z', inSandbox: false,
      webhookVerifiedAt: '1998-07-22T00:00:00.000Z', footerLegalName: 'Acme',
      footerAddress: 'Warsaw', broadcastsEnabled: true,
      reputationAlertStatus: null, reputationAlertedAt: null,
    }]);

    const response = await marketingApp(marketing).request('/api/m2m/marketing/messages', {
      method: 'POST',
      headers: {
        host: 'acme.localhost:9999',
        'x-api-key': 'marketing-key',
        'content-type': 'application/json',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ messages: [
        { to: 'member@example.test', consentDefinitionId: 'definition-news', subject: 'News', bodyHtml: '<p>News</p>' },
      ] }),
    });

    expect(response.status).toBe(202);
    expect(JSON.stringify(sender.sent)).toContain('http://acme.localhost:48730/u/');
    expect(JSON.stringify(sender.sent)).not.toContain('acme.localhost:9999');
  });

  it('returns 429 with Retry-After when the tenant SES throttle is under pressure', async () => {
    const marketing = marketingDeps();
    marketing.sesSettings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: '1998-07-22T00:00:00.000Z', identityCheckedAt: null,
      identityCheckError: null, configurationSet: 'marketing',
      snsTopicArn: null, snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null,
      trackingEnabled: false, autoPauseOnCritical: false,
      webhookToken: 'webhook-token-123456789012', quotaRatePerSec: 1,
      quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: '1998-07-22T00:00:00.000Z', inSandbox: false,
      webhookVerifiedAt: '1998-07-22T00:00:00.000Z', footerLegalName: 'Acme',
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
    expect(body).toContain('--bg:#fafafa;--surface:#fff;--ink:#09090b');
    expect(body).not.toContain('together-theme-mode');
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
      identityVerifiedAt: '1998-07-22T00:00:00.000Z', identityCheckedAt: null,
      identityCheckError: null, configurationSet: null,
      snsTopicArn: 'arn:aws:sns:eu-central-1:123:acme',
      snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null, trackingEnabled: false,
      autoPauseOnCritical: false, webhookToken: 'webhook-token',
      quotaRatePerSec: 10, quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: '1998-07-22T00:00:00.000Z',
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
    const now = '1998-07-22T00:00:00.000Z';
    const topicArn = 'arn:aws:sns:eu-central-1:123:acme';
    const settings = new InMemoryTenantSesSettingsRepository([{
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: now, identityCheckedAt: null, identityCheckError: null,
      configurationSet: 'marketing', snsTopicArn: topicArn,
      snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null,
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
    const now = '1998-07-22T00:00:00.000Z';
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
      snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null,
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
    const now = '1998-07-22T00:00:00.000Z';
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
      snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null,
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

  describe('SNS webhook diagnostics', () => {
    const topicArn = 'arn:aws:sns:eu-central-1:123:acme';
    const now = '1998-07-22T00:00:00.000Z';
    const snsSettings = (): TenantSesSettings => ({
      tenantId: 't-acme', fromAddress: 'news@acme.test', fromName: 'Acme', identity: 'acme.test',
      identityVerifiedAt: now, identityCheckedAt: null, identityCheckError: null,
      configurationSet: 'marketing', snsTopicArn: topicArn,
      snsSubscriptionEndpoint: 'https://start.localhost/api/webhooks/ses/webhook-token',
      snsSubscriptionConfirmedAt: null,
      trackingEnabled: false, autoPauseOnCritical: false, webhookToken: 'webhook-token',
      quotaRatePerSec: 10, quotaDaily: 1000, quotaSentLast24Hours: 0, quotaRefreshedAt: now,
      inSandbox: false, webhookVerifiedAt: null, footerLegalName: 'Acme', footerAddress: 'Warsaw',
      broadcastsEnabled: false, reputationAlertStatus: null, reputationAlertedAt: null,
    });

    it('records a confirm_failed diagnostic and logs instead of swallowing a failed SNS confirmation', async () => {
      const marketing = marketingDeps();
      const settings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      marketing.sesSettings = settings;
      marketing.sns = new FakeSnsVerifier(
        ok({ type: 'SubscriptionConfirmation', topicArn, message: '{}', subscribeUrl: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription' }),
        err(integrationUnavailable('SNS confirmation returned HTTP 503')),
      );
      const logger = { error: vi.fn(), warn: vi.fn() };

      const response = await marketingApp(marketing, logger).request('/api/webhooks/ses/webhook-token', {
        method: 'POST', body: '{}', headers: { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
      });

      expect(response.status).toBe(200);
      expect(await marketing.snsDeliveries.findByTenant('t-acme')).toMatchObject({
        messageType: 'SubscriptionConfirmation',
        outcome: 'confirm_failed',
        errorMessage: 'SNS confirmation returned HTTP 503',
      });
      expect((await settings.findByTenant('t-acme'))?.snsSubscriptionConfirmedAt).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('outcome=confirm_failed'));
    });

    it('persists the confirmed subscription timestamp when SNS accepts the confirmation', async () => {
      const marketing = marketingDeps();
      const settings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      marketing.sesSettings = settings;
      marketing.sns = new FakeSnsVerifier(ok({
        type: 'SubscriptionConfirmation', topicArn, message: '{}',
        subscribeUrl: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription',
      }));

      const response = await marketingApp(marketing).request('/api/webhooks/ses/webhook-token', {
        method: 'POST', body: '{}', headers: { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
      });

      expect(response.status).toBe(200);
      expect((await settings.findByTenant('t-acme'))?.snsSubscriptionConfirmedAt)
        .toBe('1998-07-12T00:00:00.000Z');
      expect(await marketing.snsDeliveries.findByTenant('t-acme')).toMatchObject({
        outcome: 'verified', errorMessage: null,
      });
    });

    it('records a signature_failed diagnostic when the SNS envelope does not verify', async () => {
      const marketing = marketingDeps();
      marketing.sesSettings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      marketing.sns = new FakeSnsVerifier(err(forbidden('Invalid SNS signature')));
      const logger = { error: vi.fn(), warn: vi.fn() };

      const response = await marketingApp(marketing, logger).request('/api/webhooks/ses/webhook-token', {
        method: 'POST', body: '{}', headers: { 'x-amz-sns-message-type': 'Notification' },
      });

      expect(response.status).toBe(403);
      expect(await marketing.snsDeliveries.findByTenant('t-acme')).toMatchObject({
        messageType: 'Notification', outcome: 'signature_failed', errorMessage: 'Invalid SNS signature',
      });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('outcome=signature_failed'));
    });

    it('logs an unknown token without writing diagnostics into the host tenant', async () => {
      const marketing = marketingDeps();
      marketing.sesSettings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      const logger = { error: vi.fn(), warn: vi.fn() };

      const response = await marketingApp(marketing, logger).request('/api/webhooks/ses/other-token', {
        method: 'POST', body: '{}',
        headers: { host: 'acme.localhost:48730', 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
      });

      expect(response.status).toBe(404);
      expect(await marketing.snsDeliveries.findByTenant('t-acme')).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('outcome=unknown_token'));
    });

    it('keeps an unrecognised message type out of the diagnostics row', async () => {
      const marketing = marketingDeps();
      marketing.sesSettings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      marketing.sns = new FakeSnsVerifier(err(forbidden('Invalid SNS signature')));

      await marketingApp(marketing).request('/api/webhooks/ses/webhook-token', {
        method: 'POST', body: '{}', headers: { 'x-amz-sns-message-type': 'x'.repeat(5000) },
      });

      expect(await marketing.snsDeliveries.findByTenant('t-acme'))
        .toMatchObject({ messageType: 'unknown' });
    });

    it('reports the verified envelope type rather than the unverified header', async () => {
      const marketing = marketingDeps();
      marketing.sesSettings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      marketing.sns = new FakeSnsVerifier(ok({
        type: 'SubscriptionConfirmation', topicArn, message: '{}',
        subscribeUrl: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription',
      }));

      await marketingApp(marketing).request('/api/webhooks/ses/webhook-token', {
        method: 'POST', body: '{}', headers: { 'x-amz-sns-message-type': 'Notification' },
      });

      expect(await marketing.snsDeliveries.findByTenant('t-acme'))
        .toMatchObject({ messageType: 'SubscriptionConfirmation', outcome: 'verified' });
    });

    it('logs a topic mismatch that it acknowledges without recording', async () => {
      const marketing = marketingDeps();
      marketing.sesSettings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      marketing.sns = new FakeSnsVerifier(ok({
        type: 'Notification', topicArn: 'arn:aws:sns:eu-central-1:123:other', message: '{}',
        subscribeUrl: null,
      }));
      const logger = { error: vi.fn(), warn: vi.fn() };

      const response = await marketingApp(marketing, logger).request('/api/webhooks/ses/webhook-token', {
        method: 'POST', body: '{}', headers: { 'x-amz-sns-message-type': 'Notification' },
      });

      expect(response.status).toBe(200);
      expect(await marketing.snsDeliveries.findByTenant('t-acme')).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('outcome=topic_mismatch'));
    });

    it('records a recorded diagnostic for a verified SES notification', async () => {
      const marketing = marketingDeps();
      marketing.sesSettings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      marketing.sns = new FakeSnsVerifier(ok({
        type: 'Notification', topicArn,
        message: JSON.stringify({
          eventType: 'Bounce',
          mail: { messageId: 'ses-simulator-message', timestamp: now },
          bounce: {
            timestamp: now, bounceType: 'Permanent',
            bouncedRecipients: [{ emailAddress: 'bounce@simulator.amazonses.com', status: '5.1.1' }],
          },
        }),
        subscribeUrl: null,
      }));

      const response = await marketingApp(marketing).request('/api/webhooks/ses/webhook-token', {
        method: 'POST', body: '{}', headers: { 'x-amz-sns-message-type': 'Notification' },
      });

      expect(response.status).toBe(200);
      expect(await marketing.snsDeliveries.findByTenant('t-acme')).toMatchObject({
        messageType: 'Notification', outcome: 'recorded',
      });
    });

    it('records an apply_failed diagnostic and logs when the event cannot be applied', async () => {
      const marketing = marketingDeps();
      const settings = new InMemoryTenantSesSettingsRepository([snsSettings()]);
      marketing.sesSettings = settings;
      vi.spyOn(settings, 'findByTenant').mockResolvedValue(null);
      marketing.sns = new FakeSnsVerifier(ok({
        type: 'Notification', topicArn,
        message: JSON.stringify({
          eventType: 'Delivery',
          mail: { messageId: 'ses-simulator-message', timestamp: now },
          delivery: { timestamp: now },
        }),
        subscribeUrl: null,
      }));
      const logger = { error: vi.fn(), warn: vi.fn() };

      const response = await marketingApp(marketing, logger).request('/api/webhooks/ses/webhook-token', {
        method: 'POST', body: '{}', headers: { 'x-amz-sns-message-type': 'Notification' },
      });

      expect(response.status).toBe(200);
      expect(await marketing.snsDeliveries.findByTenant('t-acme')).toMatchObject({
        messageType: 'Notification', outcome: 'apply_failed',
        errorMessage: 'SNS topic does not match this tenant',
      });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('outcome=apply_failed'));
    });
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

  it('purges expired rate-limit windows on the same hourly run', async () => {
    const purgeExpired = vi.fn(async () => 3);
    const app = ksefApp(
      async () => ok({ processed: false, invoiceId: null, processedCount: 0 }),
      { claim: async () => true, purgeExpired },
    );

    const response = await app.request(API_PATHS.ksefDispatch, {
      headers: { authorization: 'Bearer test-ksef-cron-secret' },
    });

    expect(response.status).toBe(200);
    expect(purgeExpired).toHaveBeenCalledOnce();
  });
});

describe('public rate limiting', () => {
  const exhausted: AppDeps['rateLimitBuckets'] = {
    claim: async () => false,
    purgeExpired: async () => 0,
  };

  it('answers a throttled checkout with 429 and Retry-After', async () => {
    const app = buildApp(deps({ rateLimitBuckets: exhausted }));

    const response = await app.request(API_PATHS.checkoutSession, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'acme' },
      body: JSON.stringify({ productId: 'acme-published', email: 'buyer@together.dev' }),
    });

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', message: 'Too many requests' },
    });
  });

  it('answers a throttled sign-in method lookup with 429 and Retry-After', async () => {
    const app = buildApp(deps({ rateLimitBuckets: exhausted }));

    const response = await app.request(API_PATHS.authResolve, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'acme' },
      body: JSON.stringify({ email: 'buyer@together.dev' }),
    });

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });

  it('spends dedicated lookup buckets so checkout keeps its own budget', async () => {
    const scopes: string[] = [];
    const app = buildApp(deps({
      rateLimitBuckets: {
        claim: async (input) => { scopes.push(input.scope); return true; },
        purgeExpired: async () => 0,
      },
    }));

    expect((await app.request(API_PATHS.authResolve, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'acme' },
      body: JSON.stringify({ email: 'buyer@together.dev' }),
    })).status).toBe(200);

    expect(scopes).toEqual(['auth-resolve:ip', 'auth-resolve:tenant']);
  });

  it('keeps an exhausted lookup budget away from checkout and the other way round', async () => {
    const drained = (exhaustedScopes: readonly string[]): AppDeps['rateLimitBuckets'] => ({
      claim: async (input) => !exhaustedScopes.includes(input.scope),
      purgeExpired: async () => 0,
    });
    const lookup = (app: ReturnType<typeof buildApp>) => app.request(API_PATHS.authResolve, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'acme' },
      body: JSON.stringify({ email: 'buyer@together.dev' }),
    });
    const checkout = (app: ReturnType<typeof buildApp>) => app.request(API_PATHS.checkoutSession, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'acme' },
      body: JSON.stringify({ productId: 'acme-published', email: 'buyer@together.dev' }),
    });

    const lookupDrained = buildApp(deps({ rateLimitBuckets: drained(['auth-resolve:ip']) }));
    expect((await lookup(lookupDrained)).status).toBe(429);
    expect((await checkout(lookupDrained)).status).not.toBe(429);

    const writesDrained = buildApp(deps({ rateLimitBuckets: drained(['public-write:ip']) }));
    expect((await checkout(writesDrained)).status).toBe(429);
    expect((await lookup(writesDrained)).status).toBe(200);
  });

  it('answers a throttled magic-link request with 429 without sending a link', async () => {
    const configured = deps({ rateLimitBuckets: exhausted });
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    configured.auth = { ...configured.auth, handler };
    const app = buildApp(configured);

    const response = await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'acme' },
      body: JSON.stringify({ email: 'buyer@together.dev' }),
    });

    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it('forwards an allowed magic-link request body to the auth handler', async () => {
    const keys: string[] = [];
    const configured = deps({
      rateLimitBuckets: {
        claim: async (input) => { keys.push(`${input.scope}:${input.key}`); return true; },
        purgeExpired: async () => 0,
      },
    });
    const handler = vi.fn(async (request: Request) => new Response(await request.text(), { status: 200 }));
    configured.auth = { ...configured.auth, handler };
    const app = buildApp(configured);

    const response = await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'acme' },
      body: JSON.stringify({ email: 'Buyer@Together.dev' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'Buyer@Together.dev' });
    expect(keys).toEqual(['public-write:ip:unattributed', 'auth-link:email:buyer@together.dev']);
  });

  it('leaves public reads and unthrottled writes alone', async () => {
    const scopes: string[] = [];
    const app = buildApp(deps({
      rateLimitBuckets: {
        claim: async (input) => { scopes.push(input.scope); return true; },
        purgeExpired: async () => 0,
      },
    }));

    expect((await app.request(API_PATHS.publicOffer, {
      headers: { [TENANT_HEADER]: 'acme' },
    })).status).toBe(200);
    expect(scopes).toEqual([]);

    expect((await app.request(API_PATHS.couponCheckoutValidation, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'acme' },
      body: JSON.stringify({ productId: 'acme-published', couponCode: 'SAVE' }),
    })).status).not.toBe(429);
    expect(scopes).toEqual(['public-write:ip', 'public-write:tenant']);
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

  it('drains the outbox for a scheduler GET carrying the cron bearer token', async () => {
    const dispatchEmails = vi.fn(async () => ok({ attemptsMade: 0, sentCount: 0, failedCount: 0 }));
    const app = buildApp(deps({ dispatchEmails }));

    expect((await app.request(API_PATHS.emailDispatch)).status).toBe(401);
    expect((await app.request(API_PATHS.emailDispatch, {
      headers: { authorization: 'Bearer test-email-dispatch-secret' },
    })).status).toBe(401);
    expect(dispatchEmails).not.toHaveBeenCalled();

    const response = await app.request(API_PATHS.emailDispatch, {
      headers: { authorization: 'Bearer test-email-dispatch-cron-secret' },
    });

    expect(response.status).toBe(200);
    expect(dispatchEmails).toHaveBeenCalledOnce();
    expect(dispatchEmails).toHaveBeenCalledWith('cron');
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

describe('automatic invoice dispatch route', () => {
  it('runs the durable dispatcher only for the configured cron bearer', async () => {
    const dispatchAutoInvoices = vi.fn(async () => ok({
      processed: true,
      processedCount: 1,
      orderId: 'order-1',
    }));
    const app = buildApp(deps({ dispatchAutoInvoices }));

    expect((await app.request(API_PATHS.autoInvoiceDispatch)).status).toBe(401);
    const response = await app.request(API_PATHS.autoInvoiceDispatch, {
      headers: { authorization: 'Bearer test-auto-invoice-dispatch-secret' },
    });

    expect(response.status).toBe(200);
    expect(dispatchAutoInvoices).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      ok: true,
      data: { processed: true, processedCount: 1, orderId: 'order-1' },
    });
  });
});

describe('health route', () => {
  it('keeps the compatibility endpoint and exposes deploy attestation', async () => {
    const up = await buildApp(deps()).request(API_PATHS.health);
    expect(await up.json()).toEqual({
      ok: true,
      data: {
        status: 'ok',
        database: 'up',
        version: '0.1.0-test',
        sha: 'test-sha',
        environment: 'preview',
        production: false,
        commit: 'test-sha',
        databaseFingerprint: 'b1bfbb98b4f7',
        expectedMigrations: 82,
        appliedMigrations: 82,
        schemaCurrent: true,
        schemaFingerprint: 'c087b16a6bb6',
        schemaFingerprintMatch: true,
      },
    });

    const down = await buildApp(deps({ databaseUp: false })).request(API_PATHS.health);
    expect(await down.json()).toMatchObject({ ok: true, data: { database: 'down' } });
  });

  it('surfaces schema drift without flipping health status', async () => {
    const response = await buildApp(deps({
      schemaStatus: {
        expectedMigrations: 82,
        appliedMigrations: 80,
        schemaCurrent: false,
        schemaFingerprint: '4d5e6f708192',
        schemaFingerprintMatch: false,
      },
    })).request(API_PATHS.health);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        status: 'ok',
        database: 'up',
        schemaCurrent: false,
        expectedMigrations: 82,
        appliedMigrations: 80,
        schemaFingerprint: '4d5e6f708192',
        schemaFingerprintMatch: false,
      },
    });
  });

  it('serves liveness without touching the database', async () => {
    let databasePings = 0;
    const configured = deps();
    configured.health = {
      pingDatabase: async () => {
        databasePings += 1;
        return false;
      },
      schemaStatus: async () => ({
        expectedMigrations: 82,
        appliedMigrations: 82,
        schemaCurrent: true,
        schemaFingerprint: 'c087b16a6bb6',
        schemaFingerprintMatch: true,
      }),
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
    isPreview: false,
    contents: [],
    legacyId: null,
    createdAt: '1998-07-12T00:00:00.000Z',
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
    createdAt: '1998-07-12T00:00:00.000Z',
  };
  const app = scopedApp('owner', {
    overrides: {
      lessons: {
        list: async () => [lesson],
        listPreviews: async () => [],
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

describe('student lesson playback route', () => {
  it('returns contract-checked signed playback URLs without caching', async () => {
    const playbackLesson: CourseLesson = {
      id: 'lesson-playback',
      tenantId: acme.id,
      name: 'Playback lesson',
      isPreview: false,
      contents: [{
        type: 'video',
        storageKey: 'videos/playback',
        streamLibraryId: 'library-1',
        streamVideoId: 'video-1',
      }],
      legacyId: null,
      createdAt: '1998-08-07T00:00:00.000Z',
    };
    const base = deps();
    const app = scopedApp('owner', {
      overrides: {
        lessons: {
          ...base.lessons,
          findById: async () => playbackLesson,
        },
        tenants: {
          ...base.tenants,
          findSettings: async () => ({
            name: acme.name,
            socialLinks: [],
            billingPortalUrl: null,
            bunnyStreamLibraryId: 'library-1',
            bunnyStreamCdnHostname: 'vz-demo.b-cdn.net',
            logoUrl: null,
            logoDarkUrl: null,
            accentColor: null,
            faviconUrl: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            supportEmail: null,
            supportUrl: null,
            termsUrl: null,
            privacyUrl: null,
            defaultHomeSpaceId: null,
          }),
        },
        secretResolver: { resolve: async () => ok('security-key') },
      },
    });
    const response = await app.request(
      API_PATHS.studentLessonPlayback.replace(':lessonId', playbackLesson.id),
      { headers: { host: 'acme.localhost:48730' } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        lessonId: playbackLesson.id,
        videos: [{
          kind: 'bunny',
          storageKey: 'videos/playback',
          videoId: 'video-1',
          libraryId: 'library-1',
          hlsUrl: expect.stringContaining('https://vz-demo.b-cdn.net/video-1/playlist.m3u8'),
          signed: true,
        }],
      },
    });
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
    createdAt: '1998-07-12T00:00:00.000Z',
  };
  const grant: ProductGrant = {
    id: 'download-grant',
    tenantId: acme.id,
    memberId: 'member-1',
    productId: downloadProduct.id,
    source: 'stripe',
    startsAt: '1998-07-01T00:00:00.000Z',
    expiresAt: null,
    legacyId: null,
    createdAt: '1998-07-01T00:00:00.000Z',
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

describe('public tenant image asset route', () => {
  const file = '00000000-0000-4000-8000-000000000001.png';
  const path = API_PATHS.publicImageAsset
    .replace(':kind', 'logo')
    .replace(':file', file);
  const storageSecret = JSON.stringify({
    provider: 'minio',
    endpoint: 'https://storage.example.test',
    region: 'eu-central-1',
    bucket: 'private-assets',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
  });

  it('redirects to a signed private object with short public caching', async () => {
    const base = deps();
    const app = scopedApp('none', {
      overrides: {
        secretResolver: { resolve: async () => ok(storageSecret) },
        storage: {
          ...base.storage,
          presignGet: () => ok('https://storage.example.test/signed-private-image'),
        },
      },
    });
    const response = await app.request(path, { headers: { host: 'acme.localhost:48730' } });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://storage.example.test/signed-private-image');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('returns only a not-found envelope when storage is unconfigured', async () => {
    const app = scopedApp('none', {
      overrides: {
        secretResolver: { resolve: async () => err(notFound('private bucket configuration missing')) },
      },
    });
    const response = await app.request(path, { headers: { host: 'acme.localhost:48730' } });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(JSON.parse(body)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(body).not.toContain('bucket');
    expect(body).not.toContain('configuration');
  });

  it.each([
    API_PATHS.publicImageAsset.replace(':kind', 'downloads').replace(':file', file),
    API_PATHS.publicImageAsset.replace(':kind', 'logo').replace(':file', 'invalid.gif'),
  ])('returns not found for malformed public asset parameters', async (invalidPath) => {
    const response = await scopedApp('none').request(invalidPath, {
      headers: { host: 'acme.localhost:48730' },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('does not leak a private bucket signing failure', async () => {
    const base = deps();
    const app = scopedApp('none', {
      overrides: {
        secretResolver: { resolve: async () => ok(storageSecret) },
        storage: {
          ...base.storage,
          presignGet: () => err(internal('private bucket returned HTTP 403')),
        },
      },
    });
    const response = await app.request(path, { headers: { host: 'acme.localhost:48730' } });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain('403');
    expect(body).not.toContain('bucket');
  });
});

describe('new route authorization', () => {
  const headers = {
    host: 'acme.localhost:48730',
    'content-type': 'application/json',
  };

  it('serves a tenant-scoped import audit only to the owner', async () => {
    const base = deps();
    const key: TenantApiKey = {
      id: 'audit-key', tenantId: 't-acme', name: 'Migration', keyHash: 'hash:audit',
      scopes: ['import:users'], createdAt: '1998-08-01T00:00:00.000Z',
      expiresAt: '1998-08-20T00:00:00.000Z', revokedAt: null,
    };
    const event: ImportAuditEvent = {
      id: 'audit-event', tenantId: 't-acme', apiKeyId: key.id, kind: 'member',
      importKey: 'member-source', resourceId: 'member-source', action: 'created',
      payloadHash: 'a'.repeat(64), at: '1998-08-14T00:00:00.000Z',
    };
    const overrides: Partial<AppDeps> = {
      tenantApiKeys: {
        ...base.tenantApiKeys,
        listByTenant: async () => [key],
      },
      importAuditEvents: {
        ...base.importAuditEvents,
        listByApiKey: async () => ({ events: [event], nextCursor: null }),
      },
    };
    const path = API_PATHS.apiKeyImportAudit.replace(':id', key.id);
    const owner = await scopedApp('owner', { overrides }).request(path, { headers });
    const admin = await scopedApp('staff', { overrides }).request(path, { headers });

    expect(owner.status).toBe(200);
    expect(await owner.json()).toMatchObject({
      ok: true,
      data: { events: [{ importKey: 'member-source' }], nextCursor: null },
    });
    expect(admin.status).toBe(403);
  });

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

  it('keeps branding image uploads owner-only', async () => {
    const base = deps();
    const overrides: Partial<AppDeps> = {
      ids: { nextId: () => '00000000-0000-4000-8000-000000000001' },
      secretResolver: {
        resolve: async () => ok(JSON.stringify({
          provider: 'minio',
          endpoint: 'https://storage.example.test',
          region: 'eu-central-1',
          bucket: 'private-assets',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        })),
      },
      storage: {
        ...base.storage,
        presignPut: () => ok('https://storage.example.test/signed-upload'),
      },
    };
    const request = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind: 'logo',
        fileName: 'logo.png',
        contentType: 'image/png',
        sizeBytes: 1024,
      }),
    };
    const owner = await scopedApp('owner', { overrides }).request(API_PATHS.brandingAssetUpload, request);
    const staff = await scopedApp('staff', { overrides }).request(API_PATHS.brandingAssetUpload, request);

    expect(owner.status).toBe(200);
    expect(await owner.json()).toMatchObject({
      ok: true,
      data: {
        servePath: '/api/public/assets/logo/00000000-0000-4000-8000-000000000001.png',
      },
    });
    expect(staff.status).toBe(403);
  });

  it('keeps cover uploads open to staff and closed to members', async () => {
    const base = deps();
    const overrides: Partial<AppDeps> = {
      ids: { nextId: () => '00000000-0000-4000-8000-000000000001' },
      secretResolver: {
        resolve: async () => ok(JSON.stringify({
          provider: 'minio',
          endpoint: 'https://storage.example.test',
          region: 'eu-central-1',
          bucket: 'private-assets',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        })),
      },
      storage: {
        ...base.storage,
        presignPut: () => ok('https://storage.example.test/signed-upload'),
      },
    };
    const request = (kind: string) => ({
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind,
        fileName: 'cover.png',
        contentType: 'image/png',
        sizeBytes: 1024,
      }),
    });
    const staffCover = await scopedApp('staff', { overrides })
      .request(API_PATHS.courseCoverUpload, request('course-cover'));
    const memberCover = await scopedApp('member', { overrides })
      .request(API_PATHS.productCoverUpload, request('product-cover'));
    const mismatchedKind = await scopedApp('staff', { overrides })
      .request(API_PATHS.courseCoverUpload, request('logo'));

    expect(staffCover.status).toBe(200);
    expect(await staffCover.json()).toMatchObject({
      ok: true,
      data: {
        servePath: '/api/public/assets/course-cover/00000000-0000-4000-8000-000000000001.png',
      },
    });
    expect(memberCover.status).toBe(403);
    expect(mismatchedKind.status).toBe(400);
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
      memberDeletedAt: '1998-07-12T00:00:00.000Z',
    }).request(API_PATHS.grantsCreate, {
      method: 'POST',
      headers,
      body: JSON.stringify({ memberId: 'member-1', productId: 'acme-published' }),
    });

    expect(response.status).toBe(409);
  });

  it('serves and revokes only the caller own account sessions', async () => {
    const base = deps();
    const revokeSessions = vi.fn(async () => undefined);
    const authPort: AppDeps['authPort'] = {
      ...base.authPort,
      getAuthenticatedUser: async () => ({
        sessionId: 'session-1',
        userId: 'user-1',
        email: 'user@acme.test',
        name: 'User',
        emailVerified: true,
        image: null,
      }),
      listSessions: async () => [
        {
          id: 'session-1',
          createdAt: '1998-07-12T00:00:00.000Z',
          lastActiveAt: '1998-07-12T00:00:00.000Z',
          userAgent: 'Chrome/140',
        },
        {
          id: 'session-2',
          createdAt: '1998-07-11T00:00:00.000Z',
          lastActiveAt: '1998-07-11T00:00:00.000Z',
          userAgent: null,
        },
      ],
      revokeSessions,
    };

    const listed = await scopedApp('member', { overrides: { authPort } })
      .request(API_PATHS.accountSessions, { headers });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: { sessions: [{ id: 'session-1', current: true }, { id: 'session-2', current: false }] },
    });

    const revoked = await scopedApp('staff', { overrides: { authPort } })
      .request(API_PATHS.accountSessionsRevokeOthers, { method: 'POST', headers });
    expect(revoked.status).toBe(200);
    expect(revokeSessions).toHaveBeenCalledExactlyOnceWith('user-1', ['session-2']);

    expect(
      (await scopedApp('none', { overrides: { authPort } })
        .request(API_PATHS.accountSessions, { headers })).status,
    ).toBe(403);
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

  it('probes storage CORS on the resolved tenant origin instead of the request host', async () => {
    const base = deps();
    const probedOrigins: string[][] = [];
    const overrides: Partial<AppDeps> = {
      storage: {
        ...base.storage,
        probe: async (_configuration, corsOrigins) => {
          probedOrigins.push(corsOrigins ?? []);
          return ok({ code: 'storage.available', message: 'Storage is available.' });
        },
      },
    };
    const request = {
      method: 'POST',
      body: JSON.stringify({
        provider: 'minio',
        endpoint: 'http://127.0.0.1:19000',
        region: 'us-east-1',
        bucket: 'together-test',
        accessKeyId: 'minio-access',
        secretAccessKey: 'minio-secret',
      }),
    };

    const spoofed = await scopedApp('owner', { overrides }).request(API_PATHS.storageProbe, {
      ...request,
      headers: { ...headers, host: 'acme.localhost:9999', 'x-forwarded-proto': 'https' },
    });
    const routed = await scopedApp('owner', { overrides }).request(API_PATHS.storageProbe, {
      ...request,
      headers: { ...headers, host: 'localhost:48730', [TENANT_HEADER]: 'acme' },
    });

    expect(spoofed.status).toBe(200);
    expect(routed.status).toBe(200);
    expect(probedOrigins).toEqual([
      ['http://acme.localhost:48730', 'http://localhost:48730'],
      ['http://localhost:48730'],
    ]);
  });
});

describe('notifications stream route', () => {
  const headers = { host: 'acme.localhost:48730' };

  const missed: Notification = {
    id: 'n-missed',
    tenantId: acme.id,
    recipientUserId: 'user-1',
    kind: 'thread-reply',
    payload: {
      rootPostId: 'post-1',
      postId: 'post-2',
      contextKind: 'lesson',
      contextId: 'lesson-1',
      courseId: 'course-1',
      eventId: null,
      lessonName: 'Lesson',
      authorDisplay: 'Author',
      authorAvatarUrl: null,
      snippet: 'hello',
    },
    sourceKey: null,
    readAt: null,
    createdAt: '1998-07-12T00:00:01.000Z',
  };

  interface ReplayScope {
    tenantId: string;
    recipientUserId: string;
  }

  const streamApp = (scopes: ReplayScope[]) => {
    const base = deps();
    return scopedApp('member', {
      overrides: {
        notifications: {
          ...base.notifications,
          listForRecipient: async (tenantId, query) => {
            scopes.push({ tenantId, recipientUserId: query.recipientUserId });
            return { notifications: [missed], nextCursor: null };
          },
        },
      },
    });
  };

  const readChunks = async (response: Response, count: number): Promise<string[]> => {
    const body = response.body;
    if (body === null) throw new Error('stream response had no body');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    while (chunks.length < count) {
      const { value, done } = await reader.read();
      if (done || value === undefined) break;
      chunks.push(decoder.decode(value));
    }
    await reader.cancel();
    return chunks;
  };

  it('replays from Last-Event-ID scoped to the authenticated identity', async () => {
    const scopes: ReplayScope[] = [];

    const response = await streamApp(scopes).request(API_PATHS.notificationsStream, {
      headers: { ...headers, 'last-event-id': '1998-07-12T00:00:00.000Z|n-seen' },
    });

    expect(response.status).toBe(200);
    expect(await readChunks(response, 3)).toEqual([
      'retry: 1000\n\n',
      'event: unread\ndata: {"unread":0}\n\n',
      'id: 1998-07-12T00:00:01.000Z|n-missed\nevent: notification\ndata: {"id":"n-missed"}\n\n',
    ]);
    expect(scopes).toEqual([{ tenantId: acme.id, recipientUserId: 'user-1' }]);
  });

  it('ignores a malformed Last-Event-ID instead of replaying', async () => {
    const scopes: ReplayScope[] = [];

    const response = await streamApp(scopes).request(API_PATHS.notificationsStream, {
      headers: { ...headers, 'last-event-id': 'n-seen' },
    });

    expect(await readChunks(response, 2)).toEqual([
      'retry: 1000\n\n',
      'event: unread\ndata: {"unread":0}\n\n',
    ]);
    expect(scopes).toEqual([]);
  });
});

describe('post search route', () => {
  it('parses repeated lesson and space filters out of the query string', async () => {
    const base = deps();
    const searches: Array<{ query: string; lessonIds: string[]; spaceIds: string[]; limit: number }> = [];
    const overrides: Partial<AppDeps> = {
      posts: {
        ...base.posts,
        search: async (_tenantId, query) => {
          searches.push(query);
          return [];
        },
      },
      spaces: {
        ...base.spaces,
        list: async () => [
          {
            id: 'space-1',
            tenantId: acme.id,
            slug: 'general',
            name: 'General',
            description: null,
            visibility: 'members',
            productIds: [],
            publicReadOnly: false,
            position: 0,
            archivedAt: null,
            createdAt: '1998-07-12T00:00:00.000Z',
          },
        ],
      },
    };
    const path = `${API_PATHS.postsSearch}?query=silnik&spaceId=space-1&spaceId=space-9`;

    const response = await scopedApp('staff', { overrides }).request(path, {
      headers: { host: 'acme.localhost:48730' },
    });

    expect(response.status).toBe(200);
    expect(searches).toEqual([
      { query: 'silnik', lessonIds: [], spaceIds: ['space-1'], limit: 20 },
    ]);
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

describe('platform data reset route', () => {
  const platformReset = (overrides: Partial<NonNullable<AppDeps['platformReset']>> = {}) => ({
    environment: 'staging' as const,
    ownerEmails: ['user@acme.test'],
    productionDatabaseFingerprint: null,
    dataReset: { run: async () => ({ wiped: [{ table: 'members', rows: 3 }] }) },
    audit: { record: async () => undefined },
    ...overrides,
  });

  const postReset = (overrides: Partial<AppDeps>, confirmation = 'staging') =>
    scopedApp('none', { overrides }).request(API_PATHS.platformDataReset, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation }),
    });

  it('is absent when the deployment composes no reset surface', async () => {
    const response = await postReset({});

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('is absent from the route table when no reset surface is composed', () => {
    const paths = buildApp(deps()).routes.map((route) => route.path);

    expect(paths).not.toContain(API_PATHS.platformDataReset);
  });

  const routeTableFor = (environment: { NODE_ENV: string; APP_ENV: string }) => {
    const composed = selectPlatformReset(
      {
        ...environment,
        PLATFORM_OWNER_EMAILS: 'user@acme.test',
        PRODUCTION_DATABASE_FINGERPRINT: undefined,
      },
      () => {
        const { dataReset, audit } = platformReset();
        return { dataReset, audit };
      },
    );
    return buildApp(composed === undefined ? deps() : { ...deps(), platformReset: composed })
      .routes
      .map((route) => route.path);
  };

  it('is absent from the route table when APP_ENV is production', () => {
    expect(routeTableFor({ NODE_ENV: 'production', APP_ENV: 'production' }))
      .not.toContain(API_PATHS.platformDataReset);
  });

  it.each(['staging', 'preview'])('is registered when APP_ENV is %s', (appEnv) => {
    expect(routeTableFor({ NODE_ENV: 'production', APP_ENV: appEnv }))
      .toContain(API_PATHS.platformDataReset);
  });

  it('forbids an authenticated caller outside the owner allowlist', async () => {
    const response = await postReset({
      platformReset: platformReset({ ownerEmails: ['someone-else@acme.test'] }),
    });

    expect(response.status).toBe(403);
  });

  it('reseeds for a platform owner who confirms the environment name', async () => {
    const response = await postReset({ platformReset: platformReset() });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { environment: 'staging', wiped: [{ table: 'members', rows: 3 }] },
    });
  });

  it('rejects a confirmation that is not the environment name', async () => {
    const response = await postReset({ platformReset: platformReset() }, 'production');

    expect(response.status).toBe(400);
  });
});

describe('development-only route table', () => {
  const devRoutesFor = (environment: { NODE_ENV: string; APP_ENV: string }) =>
    buildApp({
      ...deps(),
      devEndpoints: selectDevEndpoints({
        ...environment,
        SIMULATED_PAYMENTS: true,
        AUTH_DEV_EXPOSE_MAGIC_LINKS: true,
      }),
    })
      .routes
      .filter((route) => route.path.startsWith('/api/dev/'))
      .map((route) => `${route.method} ${route.path}`);

  it.each([
    ['production', { NODE_ENV: 'production', APP_ENV: 'production' }],
    ['staging', { NODE_ENV: 'production', APP_ENV: 'staging' }],
    ['preview', { NODE_ENV: 'production', APP_ENV: 'preview' }],
    ['self-host', { NODE_ENV: 'production', APP_ENV: 'self-host' }],
  ])('mounts no /api/dev route on %s even when the flags are set', (_name, environment) => {
    expect(devRoutesFor(environment)).toEqual([]);
  });

  it('mounts the full /api/dev block in local development', () => {
    expect(new Set(devRoutesFor({ NODE_ENV: 'development', APP_ENV: 'development' }))).toEqual(new Set([
      `POST ${API_PATHS.devSimulatePurchase}`,
      `GET ${API_PATHS.devMagicLink}`,
      `GET ${API_PATHS.devEmail}`,
      `POST ${API_PATHS.devGrant}`,
      `POST ${API_PATHS.devSubscriptionSimulateCycle}`,
      `POST ${API_PATHS.devSubscriptionSimulateFailure}`,
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
        getAuthenticatedUser: async () => ({ sessionId: 'session-1', userId: 'user-1', email: 'owner@acme.test', name: 'Owner', emailVerified: true, image: null }),
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

describe('free lesson preview route', () => {
  const lesson = (id: string, isPreview: boolean): CourseLesson => ({
    id,
    tenantId: acme.id,
    name: `Lesson ${id}`,
    isPreview,
    contents: [{ type: 'html', html: `<p>${id}</p>` }],
    legacyId: null,
    createdAt: '1998-07-12T00:00:00.000Z',
  });

  const courseFor = (courseId: string, publiclyVisible: boolean): Course => ({
    id: courseId,
    tenantId: acme.id,
    name: `Course ${courseId}`,
    description: '',
    imageUrl: null,
    moduleOrder: [`module-${courseId}`],
    publiclyVisible,
    legacyId: null,
    createdAt: '1998-07-12T00:00:00.000Z',
  });

  const moduleFor = (courseId: string, lessonId: string): CourseModule => ({
    id: `module-${courseId}`,
    tenantId: acme.id,
    courseIds: [courseId],
    title: `Module ${courseId}`,
    prefix: null,
    name: `Module ${courseId}`,
    chapters: [{
      id: `chapter-${courseId}`,
      name: `Chapter ${courseId}`,
      contents: [{ id: `content-${lessonId}`, name: `Lesson ${lessonId}`, lessonId }],
    }],
    legacyId: null,
    createdAt: '1998-07-12T00:00:00.000Z',
  });

  const appWithCourse = (
    base: AppDeps,
    course: Course,
    lessonId: string,
  ) => buildApp({
    ...base,
    courses: { ...base.courses, list: async () => [course] },
    modules: { ...base.modules, list: async () => [moduleFor(course.id, lessonId)] },
  });

  it('serves an anonymous preview and returns 401 for a non-preview lesson', async () => {
    const preview = lesson('preview', true);
    const paid = lesson('paid', false);
    const getAuthenticatedUser = vi.fn(async () => null);
    const app = appWithCourse(
      deps({ lessons: [preview, paid], getAuthenticatedUser }),
      courseFor('course-open', true),
      preview.id,
    );
    const request = (lessonId: string) => app.request(
      API_PATHS.studentLesson.replace(':lessonId', lessonId),
      { headers: { [TENANT_HEADER]: acme.slug } },
    );

    const previewResponse = await request(preview.id);
    expect(previewResponse.status).toBe(200);
    expect(await previewResponse.json()).toMatchObject({
      ok: true,
      data: { lesson: { id: preview.id, isPreview: true }, authenticated: false },
    });

    const paidResponse = await request(paid.id);
    expect(paidResponse.status).toBe(401);
    expect(await paidResponse.json()).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
    expect(getAuthenticatedUser).toHaveBeenCalledTimes(2);

    const nextResponse = await buildApp(deps({ authenticated: true })).request(API_PATHS.studentLessonNext, {
      headers: { [TENANT_HEADER]: acme.slug },
    });
    expect(nextResponse.status).toBe(401);
    expect(await nextResponse.json()).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
    expect(nextResponse.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns 403 for an authenticated member without a lesson entitlement', async () => {
    const paid = lesson('paid', false);
    const course: Course = {
      id: 'course-paid',
      tenantId: acme.id,
      name: 'Paid course',
      description: '',
      imageUrl: null,
      moduleOrder: ['module-paid'],
      publiclyVisible: false,
      legacyId: null,
      createdAt: '1998-07-12T00:00:00.000Z',
    };
    const courseModule: CourseModule = {
      id: 'module-paid',
      tenantId: acme.id,
      courseIds: [course.id],
      title: 'Paid module',
      prefix: null,
      name: 'Paid module',
      chapters: [{
        id: 'chapter-paid',
        name: 'Paid chapter',
        contents: [{ id: 'content-paid', name: paid.name, lessonId: paid.id }],
      }],
      legacyId: null,
      createdAt: '1998-07-12T00:00:00.000Z',
    };
    const base = deps({ lessons: [paid] });
    const app = scopedApp('member', {
      overrides: {
        lessons: base.lessons,
        courses: { ...base.courses, list: async () => [course] },
        modules: { ...base.modules, list: async () => [courseModule] },
      },
    });

    const response = await app.request(
      API_PATHS.studentLesson.replace(':lessonId', paid.id),
      { headers: { [TENANT_HEADER]: acme.slug } },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('returns 401 for a preview lesson outside a publicly visible course', async () => {
    const preview = lesson('preview', true);
    const app = appWithCourse(
      deps({ lessons: [preview], getAuthenticatedUser: async () => null }),
      courseFor('course-hidden', false),
      preview.id,
    );

    const response = await app.request(
      API_PATHS.studentLesson.replace(':lessonId', preview.id),
      { headers: { [TENANT_HEADER]: acme.slug } },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('serves a preview as public to a user authenticated in another tenant', async () => {
    const preview = lesson('preview', true);
    const paid = lesson('paid', false);
    const app = appWithCourse(
      deps({
        lessons: [preview, paid],
        getAuthenticatedUser: async () => ({
          sessionId: 'session-other',
          userId: 'other-tenant-user',
          email: 'other@example.com',
          name: 'Other Tenant User',
          emailVerified: true,
          image: null,
        }),
      }),
      courseFor('course-open', true),
      preview.id,
    );
    const request = (lessonId: string) => app.request(
      API_PATHS.studentLesson.replace(':lessonId', lessonId),
      { headers: { [TENANT_HEADER]: acme.slug } },
    );

    const previewResponse = await request(preview.id);
    expect(previewResponse.status).toBe(200);
    expect(await previewResponse.json()).toMatchObject({
      ok: true,
      data: { lesson: { id: preview.id, isPreview: true }, authenticated: false },
    });

    const paidResponse = await request(paid.id);
    expect(paidResponse.status).toBe(403);
    expect(await paidResponse.json()).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});

describe('anonymous public surface routes', () => {
  const space = (input: {
    id: string;
    publicReadOnly: boolean;
    visibility?: Space['visibility'];
    productIds?: string[];
    position?: number;
    archivedAt?: string | null;
  }): Space => ({
    id: input.id,
    tenantId: acme.id,
    slug: input.id,
    name: `Space ${input.id}`,
    description: `About ${input.id}`,
    visibility: input.visibility ?? 'members',
    productIds: input.productIds ?? [],
    publicReadOnly: input.publicReadOnly,
    position: input.position ?? 0,
    archivedAt: input.archivedAt ?? null,
    createdAt: '1998-07-12T00:00:00.000Z',
  });

  const rootPost = (id: string, contextId: string): Post => ({
    id,
    tenantId: acme.id,
    contextKind: 'space',
    contextId,
    rootPostId: id,
    parentPostId: null,
    authorUserId: 'user-author',
    authorDisplay: 'Author',
    authorIsStaff: false,
    body: `Body ${id}`,
    createdAt: '1998-07-12T00:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
  });

  const spaceEvent = (id: string, spaceId: string): SpaceEvent => ({
    id,
    tenantId: acme.id,
    spaceId,
    title: `Event ${id}`,
    description: null,
    startsAt: '2099-07-12T18:00:00.000Z',
    endsAt: '2099-07-12T20:00:00.000Z',
    location: null,
    url: null,
    liveEmbedUrl: null,
    replayUrl: null,
    discussionRootPostId: null,
    createdByUserId: 'user-staff-hidden',
    createdAt: '1998-07-12T00:00:00.000Z',
    updatedAt: null,
    deletedAt: null,
  });

  const publicCourse: Course = {
    id: 'course-open',
    tenantId: acme.id,
    name: 'Open course',
    description: 'Open',
    imageUrl: null,
    moduleOrder: ['module-open'],
    publiclyVisible: true,
    legacyId: null,
    createdAt: '1998-07-12T00:00:00.000Z',
  };

  const hiddenCourse: Course = { ...publicCourse, id: 'course-hidden', publiclyVisible: false };

  const previewLesson: CourseLesson = {
    id: 'lesson-preview',
    tenantId: acme.id,
    name: 'Preview lesson',
    isPreview: true,
    contents: [{ type: 'html', html: '<p>free</p>' }],
    legacyId: null,
    createdAt: '1998-07-12T00:00:00.000Z',
  };

  const paidLesson: CourseLesson = { ...previewLesson, id: 'lesson-paid', name: 'Paid lesson', isPreview: false };

  const openModule: CourseModule = {
    id: 'module-open',
    tenantId: acme.id,
    courseIds: [publicCourse.id],
    title: 'Open module',
    prefix: null,
    name: 'Open module',
    chapters: [{
      id: 'chapter-open',
      name: 'Open chapter',
      contents: [
        { id: 'content-preview', name: previewLesson.name, lessonId: previewLesson.id },
        { id: 'content-paid', name: paidLesson.name, lessonId: paidLesson.id },
      ],
    }],
    legacyId: null,
    createdAt: '1998-07-12T00:00:00.000Z',
  };

  const publicApp = (input: {
    spaces?: Space[];
    posts?: Post[];
    courses?: Course[];
    events?: SpaceEvent[];
    defaultHomeSpaceId?: string | null;
  } = {}) => {
    const spaceRows = input.spaces ?? [];
    const postRows = input.posts ?? [];
    const eventRows = input.events ?? [];
    const base = deps({ lessons: [previewLesson, paidLesson] });
    return buildApp({
      ...base,
      events: {
        ...base.events,
        findById: async (_tenantId, id) => eventRows.find((row) => row.id === id) ?? null,
        listForSpace: async (_tenantId, query) => ({
          events: eventRows.filter(
            (row) => row.spaceId === query.spaceId && row.deletedAt === null,
          ),
          nextCursor: null,
        }),
      },
      eventRsvps: {
        ...base.eventRsvps,
        countsForEvents: async (_tenantId, eventIds) =>
          new Map(eventIds.map((id) => [id, { going: 2, notGoing: 1 }])),
      },
      spaces: {
        ...base.spaces,
        list: async () => spaceRows.filter((row) => row.archivedAt === null),
        findById: async (_tenantId, id) => spaceRows.find((row) => row.id === id) ?? null,
      },
      posts: {
        ...base.posts,
        findById: async (_tenantId, id) => postRows.find((row) => row.id === id) ?? null,
        listThreadsForContext: async (_tenantId, query) => ({
          threads: postRows
            .filter((row) => row.contextId === query.contextId)
            .map((post) => ({ post, replyCount: 0 })),
          nextCursor: null,
        }),
        listReplies: async () => [],
      },
      courses: {
        ...base.courses,
        list: async () => input.courses ?? [],
        findById: async (_tenantId, id) => (input.courses ?? []).find((row) => row.id === id) ?? null,
      },
      modules: { ...base.modules, list: async () => [openModule] },
      tenants: {
        ...base.tenants,
        findSettings: async (tenantId) => {
          const settings = await base.tenants.findSettings(tenantId);
          return settings === null
            ? null
            : { ...settings, defaultHomeSpaceId: input.defaultHomeSpaceId ?? null };
        },
      },
    });
  };

  const anonymousRequest = (app: ReturnType<typeof buildApp>, path: string, headers: HeadersInit = {}) =>
    app.request(path, { headers: { [TENANT_HEADER]: acme.slug, ...headers } });

  it('lists public spaces, public courses and sellable locked spaces', async () => {
    const app = publicApp({
      spaces: [
        space({ id: 'open', publicReadOnly: true, position: 1 }),
        space({ id: 'home', publicReadOnly: true, position: 0 }),
        space({ id: 'members-only', publicReadOnly: false }),
        space({ id: 'sellable', publicReadOnly: false, visibility: 'product', productIds: ['acme-published'] }),
        space({ id: 'draft-gated', publicReadOnly: false, visibility: 'product', productIds: ['acme-draft'] }),
      ],
      courses: [publicCourse, hiddenCourse],
    });

    const response = await anonymousRequest(app, API_PATHS.publicNavigation);

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`W/"pubnav-${acme.id}-${acme.contentVersion}"`);
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(response.headers.get('vary')).toBe(`Host, ${TENANT_HEADER}`);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        navigation: {
          defaultHomeSpaceId: 'home',
          spaces: [{ id: 'home' }, { id: 'open' }],
          courses: [{ id: publicCourse.id, name: publicCourse.name }],
          lockedSpaces: [{ id: 'sellable', productIds: ['acme-published'] }],
        },
      },
    });
  });

  it('revalidates navigation with the content-version ETag', async () => {
    const app = publicApp({ spaces: [space({ id: 'open', publicReadOnly: true })] });
    const etag = `W/"pubnav-${acme.id}-${acme.contentVersion}"`;

    const response = await anonymousRequest(app, API_PATHS.publicNavigation, { 'if-none-match': etag });

    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe(etag);
  });

  it('serves a publicly visible course program with previews unlocked', async () => {
    const app = publicApp({ courses: [publicCourse] });

    const response = await anonymousRequest(
      app,
      API_PATHS.publicCourseStructure.replace(':courseId', publicCourse.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(
      `W/"pubcourse-${acme.id}-${publicCourse.id}-${acme.contentVersion}"`,
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        structure: {
          courseId: publicCourse.id,
          modules: [{
            chapters: [{
              lessons: [
                { lessonId: previewLesson.id, accessStatus: 'fully-accessible' },
                { lessonId: paidLesson.id, accessStatus: 'not-accessible' },
              ],
            }],
          }],
        },
      },
    });
  });

  it('answers not_found for a course that is not publicly visible', async () => {
    const app = publicApp({ courses: [hiddenCourse] });

    const response = await anonymousRequest(
      app,
      API_PATHS.publicCourseStructure.replace(':courseId', hiddenCourse.id),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('serves a viewerless feed and thread for a publicly readable space', async () => {
    const post = rootPost('post-open', 'open');
    const app = publicApp({ spaces: [space({ id: 'open', publicReadOnly: true })], posts: [post] });

    const feed = await anonymousRequest(
      app,
      API_PATHS.publicSpaceFeed.replace(':spaceId', 'open'),
    );
    expect(feed.status).toBe(200);
    expect(feed.headers.get('cache-control')).toBe('no-store');
    expect(await feed.json()).toMatchObject({
      ok: true,
      data: { feed: { spaceId: 'open', isFollowing: false, items: [{ id: post.id, isOwn: false }] } },
    });

    const thread = await anonymousRequest(
      app,
      API_PATHS.publicSpaceThread.replace(':spaceId', 'open').replace(':postId', post.id),
    );
    expect(thread.status).toBe(200);
    expect(await thread.json()).toMatchObject({
      ok: true,
      data: {
        discussion: {
          threads: [{ id: post.id, isOwn: false, replyCount: 0, replies: [] }],
          viewerSubscriptions: {},
        },
      },
    });
  });

  it('answers not_found for spaces that are not publicly readable', async () => {
    const post = rootPost('post-private', 'private');
    const app = publicApp({
      spaces: [
        space({ id: 'private', publicReadOnly: false }),
        space({ id: 'retired', publicReadOnly: true, archivedAt: '1998-07-12T00:00:00.000Z' }),
      ],
      posts: [post],
    });

    for (const spaceId of ['private', 'retired', 'missing']) {
      const feed = await anonymousRequest(app, API_PATHS.publicSpaceFeed.replace(':spaceId', spaceId));
      expect(feed.status).toBe(404);
      expect(await feed.json()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }

    const thread = await anonymousRequest(
      app,
      API_PATHS.publicSpaceThread.replace(':spaceId', 'private').replace(':postId', post.id),
    );
    expect(thread.status).toBe(404);
  });

  it('answers not_found for a post outside the requested public space', async () => {
    const app = publicApp({
      spaces: [space({ id: 'open', publicReadOnly: true }), space({ id: 'other', publicReadOnly: true })],
      posts: [rootPost('post-other', 'other')],
    });

    const response = await anonymousRequest(
      app,
      API_PATHS.publicSpaceThread.replace(':spaceId', 'open').replace(':postId', 'post-other'),
    );

    expect(response.status).toBe(404);
  });

  it('serves read-only events of a publicly readable space without the creating account', async () => {
    const open = space({ id: 'open', publicReadOnly: true });
    const app = publicApp({ spaces: [open], events: [spaceEvent('event-open', open.id)] });

    const list = await anonymousRequest(app, API_PATHS.publicSpaceEvents.replace(':spaceId', 'open'));
    const detail = await anonymousRequest(
      app,
      API_PATHS.publicSpaceEvent.replace(':spaceId', 'open').replace(':eventId', 'event-open'),
    );

    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      ok: true,
      data: {
        events: [{ id: 'event-open', goingCount: 2, notGoingCount: 1, viewerRsvp: null, liveNow: false }],
      },
    });
    expect(detail.status).toBe(200);
    expect(await detail.text()).not.toContain('user-staff-hidden');
  });

  it('answers not_found for events of spaces that are not publicly readable', async () => {
    const closed = space({ id: 'private', publicReadOnly: false });
    const app = publicApp({ spaces: [closed], events: [spaceEvent('event-private', closed.id)] });

    for (const path of [
      API_PATHS.publicSpaceEvents.replace(':spaceId', 'private'),
      API_PATHS.publicSpaceEvent.replace(':spaceId', 'private').replace(':eventId', 'event-private'),
      API_PATHS.publicSpaceEvent.replace(':spaceId', 'missing').replace(':eventId', 'event-private'),
    ]) {
      const response = await anonymousRequest(app, path);
      expect([path, response.status]).toEqual([path, 404]);
      expect([path, await response.json()]).toMatchObject([path, { ok: false, error: { code: 'not_found' } }]);
    }
  });

  it('answers OPTIONS preflight for every public surface route', async () => {
    const app = publicApp();

    for (const path of [
      API_PATHS.publicNavigation,
      API_PATHS.publicCourseStructure.replace(':courseId', publicCourse.id),
      API_PATHS.publicSpaceFeed.replace(':spaceId', 'open'),
      API_PATHS.publicSpaceThread.replace(':spaceId', 'open').replace(':postId', 'post-open'),
      API_PATHS.publicSpaceEvents.replace(':spaceId', 'open'),
      API_PATHS.publicSpaceEvent.replace(':spaceId', 'open').replace(':eventId', 'event-open'),
    ]) {
      const response = await app.request(path, { method: 'OPTIONS' });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    }
  });

  it('returns a tenant_not_found envelope for an unknown host', async () => {
    const app = publicApp();

    const response = await app.request(API_PATHS.publicNavigation, {
      headers: { host: 'missing.localhost:48730' },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  describe('anonymous threat model', () => {
    const errorCodeSchema = z.object({ error: z.object({ code: z.string() }) });
    const memberRoutes = Object.values(API_ROUTES).filter((route) =>
      route.path.startsWith('/api/')
      && publicRouteManifestEntry(route) === undefined
      && selfAuthenticatingRouteManifestEntry(route) === undefined);

    it('answers unauthorized on every member API route without a session', async () => {
      const app = buildApp({
        ...deps({ authenticated: true }),
        platformReset: {
          environment: 'staging',
          ownerEmails: [],
          productionDatabaseFingerprint: null,
          dataReset: { run: async () => ({ wiped: [] }) },
          audit: { record: async () => undefined },
        },
      });

      const verdicts = await Promise.all(memberRoutes.map(async (route) => {
        const response = await app.request(route.path.replace(/:[^/]+/g, 'probe'), {
          method: route.method,
          headers: { host: 'acme.localhost:48730' },
        });
        const body = errorCodeSchema.safeParse(await response.json());
        return `${route.method} ${route.path} ${response.status} ${body.success ? body.data.error.code : 'ok'}`;
      }));

      expect(memberRoutes.length).toBeGreaterThan(150);
      expect(verdicts.filter((verdict) => !verdict.endsWith('401 unauthorized'))).toEqual([]);
    });

    it('varies every anonymous surface on the tenant and keeps hits and misses cached honestly', async () => {
      const openPost = rootPost('post-open', 'open');
      const app = publicApp({
        spaces: [space({ id: 'open', publicReadOnly: true }), space({ id: 'private', publicReadOnly: false })],
        posts: [openPost],
        courses: [publicCourse, hiddenCourse],
      });
      const thread = (spaceId: string) => API_PATHS.publicSpaceThread
        .replace(':spaceId', spaceId)
        .replace(':postId', openPost.id);

      for (const surface of [
        { path: API_PATHS.publicOffer, status: 200, cacheControl: 'public, no-cache' },
        { path: API_PATHS.publicNavigation, status: 200, cacheControl: 'public, no-cache' },
        {
          path: API_PATHS.publicCourseStructure.replace(':courseId', publicCourse.id),
          status: 200,
          cacheControl: 'public, no-cache',
        },
        {
          path: API_PATHS.publicCourseStructure.replace(':courseId', hiddenCourse.id),
          status: 404,
          cacheControl: 'no-store',
        },
        { path: API_PATHS.publicSpaceFeed.replace(':spaceId', 'open'), status: 200, cacheControl: 'no-store' },
        { path: API_PATHS.publicSpaceFeed.replace(':spaceId', 'private'), status: 404, cacheControl: 'no-store' },
        { path: thread('open'), status: 200, cacheControl: 'no-store' },
        { path: thread('private'), status: 404, cacheControl: 'no-store' },
        { path: API_PATHS.publicSpaceEvents.replace(':spaceId', 'open'), status: 200, cacheControl: 'no-store' },
        { path: API_PATHS.publicSpaceEvents.replace(':spaceId', 'private'), status: 404, cacheControl: 'no-store' },
      ]) {
        const response = await anonymousRequest(app, surface.path);
        expect([
          surface.path,
          response.status,
          response.headers.get('vary'),
          response.headers.get('cache-control'),
        ]).toEqual([surface.path, surface.status, `Host, ${TENANT_HEADER}`, surface.cacheControl]);
      }
    });

    it('keeps author accounts and viewer state out of public post payloads', async () => {
      const post = {
        ...rootPost('post-open', 'open'),
        authorUserId: 'user-hidden-account',
        authorDisplay: 'Pseudonym',
      };
      const app = publicApp({ spaces: [space({ id: 'open', publicReadOnly: true })], posts: [post] });

      const feed = await anonymousRequest(app, API_PATHS.publicSpaceFeed.replace(':spaceId', 'open'));
      const thread = await anonymousRequest(
        app,
        API_PATHS.publicSpaceThread.replace(':spaceId', 'open').replace(':postId', post.id),
      );

      for (const response of [feed, thread]) {
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).not.toContain(post.authorUserId);
        expect(body).toContain(post.authorDisplay);
      }
    });

    it('rejects a public feed page above the clamped limit', async () => {
      const app = publicApp({ spaces: [space({ id: 'open', publicReadOnly: true })] });

      const response = await anonymousRequest(
        app,
        `${API_PATHS.publicSpaceFeed.replace(':spaceId', 'open')}?limit=1000`,
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: 'validation' } });
    });

    it('reads the public surface through the resolved tenant only', async () => {
      const openSpace = space({ id: 'open', publicReadOnly: true });
      const post = rootPost('post-open', openSpace.id);
      const base = deps({ lessons: [previewLesson, paidLesson] });
      const forAcme = <T>(tenantId: string, rows: T[]): T[] => (tenantId === acme.id ? rows : []);
      const app = buildApp({
        ...base,
        spaces: {
          ...base.spaces,
          list: async (tenantId) => forAcme(tenantId, [openSpace]),
          findById: async (tenantId, id) => forAcme(tenantId, [openSpace]).find((row) => row.id === id) ?? null,
        },
        posts: {
          ...base.posts,
          findById: async (tenantId, id) => forAcme(tenantId, [post]).find((row) => row.id === id) ?? null,
          listThreadsForContext: async (tenantId) => ({
            threads: forAcme(tenantId, [{ post, replyCount: 0 }]),
            nextCursor: null,
          }),
          listReplies: async () => [],
        },
        courses: {
          ...base.courses,
          list: async (tenantId) => forAcme(tenantId, [publicCourse]),
          findById: async (tenantId, id) => forAcme(tenantId, [publicCourse]).find((row) => row.id === id) ?? null,
        },
        modules: { ...base.modules, list: async () => [openModule] },
      });
      const asGlobex = (path: string) => app.request(path, { headers: { [TENANT_HEADER]: globex.slug } });

      const navigation = await asGlobex(API_PATHS.publicNavigation);
      expect(navigation.status).toBe(200);
      expect(await navigation.json()).toMatchObject({
        ok: true,
        data: { navigation: { defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] } },
      });

      for (const path of [
        API_PATHS.publicCourseStructure.replace(':courseId', publicCourse.id),
        API_PATHS.publicSpaceFeed.replace(':spaceId', openSpace.id),
        API_PATHS.publicSpaceThread.replace(':spaceId', openSpace.id).replace(':postId', post.id),
      ]) {
        const response = await asGlobex(path);
        expect([path, response.status]).toEqual([path, 404]);
        expect([path, await response.json()]).toMatchObject([path, { ok: false, error: { code: 'not_found' } }]);
      }
    });
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

  it('hides Google on a verified custom domain the OAuth callback cannot return to', async () => {
    const app = buildApp({
      ...deps({
        domains: [{
          id: 'domain-acme',
          tenantId: acme.id,
          domain: 'learn.acme.example',
          kind: 'custom',
          verified: true,
        }],
      }),
      authConfig: { googleEnabled: true },
    });

    const response = await app.request(API_PATHS.authConfig, { headers: { host: 'learn.acme.example' } });
    const body: unknown = await response.json();

    expect(body).toMatchObject({ ok: true, data: { googleEnabled: false, passkeysEnabled: true } });
  });

});

describe('public auth-resolve route', () => {
  const resolve = (app: ReturnType<typeof buildApp>, email: string) =>
    app.request(API_PATHS.authResolve, {
      method: 'POST',
      headers: { host: 'acme.localhost:48730', 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });

  it('offers the password step to an account holding a credential', async () => {
    const app = buildApp(deps({ passwordAccounts: ['creator@together.dev'] }));

    const response = await resolve(app, 'creator@together.dev');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { methods: ['password', 'magic-link'] },
    });
  });

  it('answers a passwordless member and an unknown address identically', async () => {
    const app = buildApp(deps({ passwordAccounts: ['creator@together.dev'] }));

    const passwordless = await resolve(app, 'kursant@together.dev');
    const unknown = await resolve(app, 'nobody@example.com');

    expect(await passwordless.json()).toEqual({ ok: true, data: { methods: ['magic-link'] } });
    expect(await unknown.json()).toEqual({ ok: true, data: { methods: ['magic-link'] } });
  });

  it('rejects a payload without a usable identifier', async () => {
    const app = buildApp(deps());

    const response = await resolve(app, 'not-an-email');

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('handles auth-resolve preflight before auth middleware', async () => {
    const response = await buildApp(deps()).request(API_PATHS.authResolve, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://creator.example',
        'access-control-request-method': 'POST',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('tenant creation verdict route', () => {
  it.each([
    { tenantCreationMode: 'open' as const, canCreateTenant: true },
    { tenantCreationMode: 'closed' as const, canCreateTenant: false },
  ])('exposes $canCreateTenant in $tenantCreationMode mode', async (input) => {
    const response = await scopedApp('none', {
      overrides: { tenantCreationMode: input.tenantCreationMode },
    }).request(API_PATHS.tenants);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: { canCreateTenant: input.canCreateTenant },
    });
  });
});

type RequestMagicLinkInput = Parameters<AppDeps['authPort']['requestMagicLink']>[0];
type DeliveryContext = Parameters<AppDeps['auth']['setMagicLinkDeliveryContext']>[1];
type ResetDeliveryContext = Parameters<AppDeps['auth']['setResetPasswordDeliveryContext']>[1];
type VerificationDeliveryContext = Parameters<AppDeps['auth']['setEmailVerificationDeliveryContext']>[1];

interface Captured {
  request: RequestMagicLinkInput | null;
  context: { email: string; context: DeliveryContext } | null;
  resetContext: { email: string; context: ResetDeliveryContext } | null;
  verificationContext: { email: string; context: VerificationDeliveryContext } | null;
}

const capturingApp = (
  input: Parameters<typeof deps>[0] = {},
): { app: ReturnType<typeof buildApp>; captured: Captured } => {
  const captured: Captured = {
    request: null,
    context: null,
    resetContext: null,
    verificationContext: null,
  };
  const base = deps(input);
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
      setResetPasswordDeliveryContext: (email, context) => {
        captured.resetContext = { email, context };
      },
      setEmailVerificationDeliveryContext: (email, context) => {
        captured.verificationContext = { email, context };
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

const consentApp = (simulatedPayments: boolean, authTrustedProxyHeader: string | null = null) => {
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
              bunnyStreamCdnHostname: null,
              logoUrl: null,
              logoDarkUrl: null,
              accentColor: null,
              faviconUrl: null,
              ogTitle: null,
              ogDescription: null,
              ogImageUrl: null,
              supportEmail: null,
              supportUrl: null,
              termsUrl: 'https://acme.example/terms-v2',
              privacyUrl: 'https://acme.example/privacy-v3',
              defaultHomeSpaceId: null,
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
        updatedAt: '1998-07-12T00:00:00.000Z',
      }),
    },
    devEndpoints: { simulatedPayments, exposeMagicLinks: false },
    authTrustedProxyHeader,
  });
  return { app, captures, checkoutSessions, recorded };
};

describe('checkout consent evidence attribution', () => {
  const startCheckout = (
    app: ReturnType<typeof buildApp>,
    headers: Record<string, string>,
  ) =>
    app.request(API_PATHS.checkoutSession, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'acme.localhost:48730',
        'user-agent': 'Checkout Browser/1.0',
        ...headers,
      },
      body: JSON.stringify({
        email: 'buyer@together.dev',
        productId: 'acme-published',
        termsAccepted: true,
      }),
    });

  it('takes the client IP from the configured trusted proxy header', async () => {
    const { app, captures } = consentApp(false, 'x-forwarded-for');

    expect((await startCheckout(app, { 'x-forwarded-for': '203.0.113.8' })).status).toBe(200);
    expect(captures.get('id-1')?.capture).toMatchObject({
      ip: '203.0.113.8',
      userAgent: 'Checkout Browser/1.0',
    });
  });

  it('drops a spoofed forwarding header when no proxy header is trusted', async () => {
    const { app, captures } = consentApp(false);

    expect((await startCheckout(app, { 'x-forwarded-for': '203.0.113.8' })).status).toBe(200);
    const capture = captures.get('id-1')?.capture;
    expect(capture).toMatchObject({ userAgent: 'Checkout Browser/1.0' });
    expect(capture).not.toHaveProperty('ip');
  });
});

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
      collectedAt: '1998-07-12T00:00:00.000Z',
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
        acceptedAt: '1998-07-12T00:00:00.000Z',
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
        createdAt: '1998-07-12T00:00:00.000Z',
        updatedAt: '1998-07-12T00:00:00.000Z',
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
        createdAt: '1998-07-12T00:00:00.000Z',
        createdBy: null,
      },
    );
    const durableJobs: AutoInvoiceJob[] = [];
    const autoInvoiceJobs = {
      enqueue: async (_tenantId: string, job: AutoInvoiceJob) => {
        if (durableJobs.some((candidate) => candidate.webhookEventId === job.webhookEventId)) {
          return false;
        }
        durableJobs.push(job);
        return true;
      },
      claimDue: async () => {
        const index = durableJobs.findIndex((job) => job.status === 'queued');
        const job = durableJobs[index];
        if (job === undefined) return null;
        const claimed: AutoInvoiceJob = {
          ...job,
          status: 'running',
          attempts: job.attempts + 1,
          lockedAt: '1998-07-12T00:00:00.000Z',
        };
        durableJobs[index] = claimed;
        return claimed;
      },
      reschedule: async (_tenantId: string, jobId: string, input: { nextAttemptAt: string; error: string }) => {
        const index = durableJobs.findIndex((job) => job.id === jobId);
        const job = durableJobs[index];
        if (job !== undefined) {
          durableJobs[index] = {
            ...job,
            status: 'queued',
            nextAttemptAt: input.nextAttemptAt,
            lockedAt: null,
            lastError: input.error,
          };
        }
      },
      complete: async (_tenantId: string, jobId: string) => {
        const index = durableJobs.findIndex((job) => job.id === jobId);
        const job = durableJobs[index];
        if (job !== undefined) {
          durableJobs[index] = { ...job, status: 'completed', lockedAt: null, lastError: null };
        }
      },
    };
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
      createdAt: '1998-07-12T00:00:00.000Z',
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
    const logger = { error: vi.fn(), warn: vi.fn() };
    const base = deps({
      products: [attached],
      autoInvoiceJobs,
      paymentRefunds: {
        findOrderByProviderObjectIds: async () => orderResult,
        findLatestSubscriptionOrder: async () => null,
        listAccessRetainingOrdersForMemberProduct: async () => [],
        markOrderRefunded: async () => null,
        markOrderPartiallyRefunded: async () => null,
      },
    });
    let invoiceRequests = 0;
    const webhookDeps = {
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
                bunnyStreamCdnHostname: null,
                logoUrl: null,
                logoDarkUrl: null,
                accentColor: null,
                faviconUrl: null,
                ogTitle: null,
                ogDescription: null,
                ogImageUrl: null,
                supportEmail: null,
                supportUrl: null,
                termsUrl: 'https://acme.example/terms-v2',
                privacyUrl: 'https://acme.example/privacy-v3',
                defaultHomeSpaceId: null,
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
                collectedAt: '1998-07-12T00:00:00.000Z',
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
          if (claimedEvents.has(paymentEvent.id)) return 'processed';
          claimedEvents.add(paymentEvent.id);
          return 'claimed';
        },
        finalize: async () => undefined,
        release: async () => undefined,
      },
      paymentRefunds: {
        ...base.paymentRefunds,
        findOrderByProviderObjectIds: async (_tenantId, providerObjectIds) => {
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
                createdAt: '1998-07-12T00:00:00.000Z',
              }
            : null,
      },
      devEndpoints: { simulatedPayments: false, exposeMagicLinks: false },
    } satisfies AppDeps;
    const app = buildApp(webhookDeps);
    const deliver = () =>
      app.request('/api/webhooks/stripe/t-acme', {
        method: 'POST',
        headers: { 'stripe-signature': 'test-signature' },
        body: '{}',
      });

    expect((await deliver()).status).toBe(200);
    expect(invoiceRequests).toBe(0);
    expect(orderLookups).toEqual([{ checkoutSession: 'cs_webhook' }]);
    expect(durableJobs).toMatchObject([{ webhookEventId: 'evt_webhook', status: 'queued' }]);
    orderLookups.length = 0;
    expect((await deliver()).status).toBe(200);
    expect(invoiceRequests).toBe(0);
    expect(durableJobs).toHaveLength(1);
    expect(await dispatchAutoInvoiceJobs({
      jobs: autoInvoiceJobs,
      invoices: webhookDeps.invoices,
      invoicing: webhookDeps.invoicing,
      orderDetails: webhookDeps.orderDetails,
      tenants: webhookDeps.tenants,
      tenantSecrets: webhookDeps.tenantSecrets,
      secretCrypto: webhookDeps.secretCrypto,
      ids: webhookDeps.ids,
      clock: webhookDeps.clock,
      ...(webhookDeps.ksef === undefined ? {} : { ksef: webhookDeps.ksef }),
    })).toMatchObject({ ok: true, value: { processedCount: 1 } });
    expect(invoiceRequests).toBe(1);
    expect(durableJobs).toMatchObject([{ webhookEventId: 'evt_webhook', status: 'completed' }]);
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
  });

  it('acknowledges a stripe webhook for a suspended tenant without verifying or fulfilling it', async () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const verifyWebhookEvent = vi.fn();
    const base = deps({ tenants: [{ ...acme, status: 'suspended' }] });
    const app = buildApp({
      ...base,
      logger,
      payment: { ...base.payment, verifyWebhookEvent },
    } satisfies AppDeps);

    const response = await app.request('/api/webhooks/stripe/t-acme', {
      method: 'POST',
      headers: { 'stripe-signature': 'test-signature' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { received: true, processed: false },
    });
    expect(verifyWebhookEvent).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[stripe-webhook] ignored tenant=t-acme status=suspended',
    );
  });

  it('asks stripe to retry while another worker holds the payment event lease', async () => {
    const base = deps({ tenants: [acme] });
    const app = buildApp({
      ...base,
      payment: {
        ...base.payment,
        verifyWebhookEvent: async () => ok({
          id: 'evt_leased',
          type: 'checkout.session.completed',
          objectId: 'cs_leased',
          checkoutSession: {
            email: 'buyer@together.dev',
            subscriptionId: null,
            paymentIntentId: null,
            metadata: {
              tenantId: acme.id,
              productId: 'product-1',
              priceId: null,
              memberEmail: null,
              language: 'pl',
            },
          },
        }),
      },
      processedPaymentEvents: {
        ...base.processedPaymentEvents,
        claim: async () => 'in_progress',
      },
    } satisfies AppDeps);

    const response = await app.request('/api/webhooks/stripe/t-acme', {
      method: 'POST',
      headers: { 'stripe-signature': 'test-signature' },
      body: '{}',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
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
      createdAt: '1998-07-12T00:00:00.000Z',
      updatedAt: '1998-07-12T00:00:00.000Z',
    }, {
      id: 'checkout-news-v1',
      tenantId: acme.id,
      definitionId,
      version: 1,
      label: 'Send me product news',
      documentVersionRef: { mode: 'url', url: 'https://acme.example/newsletter' },
      createdAt: '1998-07-12T00:00:00.000Z',
      createdBy: null,
    });
    const logger = { error: vi.fn(), warn: vi.fn() };
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
          updatedAt: '1998-07-12T00:00:00.000Z',
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
      authTrustedProxyHeader: 'x-forwarded-for',
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
      'x-forwarded-for': '203.0.113.8',
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

describe('tenant-host email verification', () => {
  it.each([BETTER_AUTH_SIGN_UP_PATH, BETTER_AUTH_EMAIL_VERIFICATION_PATH])(
    'rebases %s delivery to the requesting host',
    async (path) => {
      const { app, captured } = capturingApp();

      await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: 'acme.localhost:48730',
          [MAGIC_LINK_LANGUAGE_HEADER]: 'en',
        },
        body: JSON.stringify({ email: 'account@together.dev' }),
      });

      expect(captured.verificationContext).toEqual({
        email: 'account@together.dev',
        context: { language: 'en', baseUrl: 'http://acme.localhost:48730' },
      });
    },
  );

  it.each([BETTER_AUTH_SIGN_UP_PATH, BETTER_AUTH_EMAIL_VERIFICATION_PATH])(
    'rebases %s delivery to a verified custom domain',
    async (path) => {
      const { app, captured } = capturingApp({
        domains: [{
          id: 'domain-acme',
          tenantId: acme.id,
          domain: 'learn.acme.example',
          kind: 'custom',
          verified: true,
        }],
      });

      await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: 'learn.acme.example',
          'x-forwarded-proto': 'https',
          [MAGIC_LINK_LANGUAGE_HEADER]: 'en',
        },
        body: JSON.stringify({ email: 'custom-domain@together.dev' }),
      });

      expect(captured.verificationContext).toEqual({
        email: 'custom-domain@together.dev',
        context: { language: 'en', baseUrl: 'https://learn.acme.example' },
      });
    },
  );

  it.each([BETTER_AUTH_SIGN_UP_PATH, BETTER_AUTH_EMAIL_VERIFICATION_PATH])(
    'keeps %s delivery on the configured base URL for tenant-header routing',
    async (path) => {
      const { app, captured } = capturingApp();

      await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: 'localhost:48730',
          [TENANT_HEADER]: 'globex',
        },
        body: JSON.stringify({ email: 'tenant-header@together.dev' }),
      });

      expect(captured.verificationContext).toEqual({
        email: 'tenant-header@together.dev',
        context: { language: 'pl', baseUrl: 'http://localhost:48730' },
      });
    },
  );
});

describe('auth link host trust', () => {
  const attackerHeaders = {
    'content-type': 'application/json',
    host: 'attacker.example',
    'x-forwarded-proto': 'https',
    origin: 'http://acme.localhost:48730',
  };

  it('keeps the magic-link base on APP_BASE_URL for an unknown host', async () => {
    const { app, captured } = capturingApp();

    await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: attackerHeaders,
      body: JSON.stringify({ email: 'login@together.dev' }),
    });

    expect(captured.context?.context.baseUrl).toBe('http://localhost:48730');
  });

  it('keeps the reset base on APP_BASE_URL for an unknown host', async () => {
    const { app, captured } = capturingApp();

    await app.request(BETTER_AUTH_PASSWORD_RESET_PATH, {
      method: 'POST',
      headers: attackerHeaders,
      body: JSON.stringify({ email: 'login@together.dev' }),
    });

    expect(captured.resetContext?.context.baseUrl).toBe('http://localhost:48730');
  });

  it.each([BETTER_AUTH_SIGN_UP_PATH, BETTER_AUTH_EMAIL_VERIFICATION_PATH])(
    'keeps %s delivery on APP_BASE_URL for an unknown host',
    async (path) => {
      const { app, captured } = capturingApp();

      await app.request(path, {
        method: 'POST',
        headers: attackerHeaders,
        body: JSON.stringify({ email: 'account@together.dev' }),
      });

      expect(captured.verificationContext?.context.baseUrl).toBe('http://localhost:48730');
    },
  );

  it('keeps the magic-link base on APP_BASE_URL for an unknown slug under the base domain', async () => {
    const { app, captured } = capturingApp();

    await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'missing.localhost:48730' },
      body: JSON.stringify({ email: 'login@together.dev' }),
    });

    expect(captured.context?.context.baseUrl).toBe('http://localhost:48730');
    expect(captured.context?.context.tenantName).toBeUndefined();
  });

  it('keeps the reset base on APP_BASE_URL for tenant-header routing', async () => {
    const { app, captured } = capturingApp();

    await app.request(BETTER_AUTH_PASSWORD_RESET_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'localhost:48730',
        [TENANT_HEADER]: 'globex',
      },
      body: JSON.stringify({ email: 'login@together.dev' }),
    });

    expect(captured.resetContext?.context.baseUrl).toBe('http://localhost:48730');
  });

  it('still builds the reset base on the requesting tenant subdomain', async () => {
    const { app, captured } = capturingApp();

    await app.request(BETTER_AUTH_PASSWORD_RESET_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'acme.localhost:48730' },
      body: JSON.stringify({ email: 'login@together.dev' }),
    });

    expect(captured.resetContext?.context.baseUrl).toBe('http://acme.localhost:48730');
  });

  it('keeps the scheme and port of the seeded subdomain domain row', async () => {
    const { app, captured } = capturingApp({
      domains: [
        { id: 'domain-acme', tenantId: acme.id, domain: 'acme.localhost', kind: 'subdomain', verified: true },
      ],
    });

    await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'acme.localhost:48730' },
      body: JSON.stringify({ email: 'login@together.dev' }),
    });

    expect(captured.context?.context.baseUrl).toBe('http://acme.localhost:48730');
  });

  it('builds the magic-link base on a verified custom domain over HTTPS', async () => {
    const { app, captured } = capturingApp({
      domains: [
        { id: 'domain-learn', tenantId: acme.id, domain: 'learn.acme.example', kind: 'custom', verified: true },
      ],
    });

    await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'learn.acme.example' },
      body: JSON.stringify({ email: 'login@together.dev' }),
    });

    expect(captured.context?.context.baseUrl).toBe('https://learn.acme.example');
  });

  it('leaves no delivery-context residue when Better Auth rejects the request', async () => {
    const contexts = new Map<string, DeliveryContext>();
    const base = deps();
    const app = buildApp({
      ...base,
      auth: {
        ...base.auth,
        setMagicLinkDeliveryContext: (email, context) => { contexts.set(email, context); },
        clearMagicLinkDeliveryContext: (email) => { contexts.delete(email); },
      },
    });

    const response = await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'acme.localhost:48730' },
      body: JSON.stringify({ email: 'login@together.dev' }),
    });

    expect(response.status).toBe(404);
    expect(contexts.size).toBe(0);
  });

  it('rejects an over-long e-mail before resolving the tenant', async () => {
    const base = deps();
    let resolvedTenants = 0;
    const app = buildApp({
      ...base,
      tenants: {
        ...base.tenants,
        findBySlug: async (slug) => {
          resolvedTenants += 1;
          return base.tenants.findBySlug(slug);
        },
      },
    });

    await app.request(BETTER_AUTH_MAGIC_LINK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'acme.localhost:48730' },
      body: JSON.stringify({ email: `${'a'.repeat(250)}@together.dev` }),
    });

    expect(resolvedTenants).toBe(0);
  });
});

describe('scheduler operator routes', () => {
  it('requires the operator secret and returns global totals with the per-tenant detail', async () => {
    const marketing = marketingDeps();
    await marketing.runs.start({
      id: 'run-global',
      kind: 'outbox_dispatch',
      trigger: 'cron',
      startedAt: '1998-07-26T10:00:00.000Z',
      finishedAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      totals: {
        campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0, reEnqueued: false,
      },
      createdAt: '1998-07-26T10:00:00.000Z',
    });
    await marketing.runs.finalize('run-global', {
      finishedAt: '1998-07-26T10:00:01.000Z',
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
        createdAt: '1998-07-26T10:00:01.000Z',
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
