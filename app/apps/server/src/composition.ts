import { randomBytes, randomUUID } from 'node:crypto';

import { createDb } from '@adapters/db/client.js';
import { createEmailOutboxRepository, createEnrollmentTransactionPort } from '@adapters/db/email-outbox.js';
import { createEmailEventRepository } from '@adapters/db/email-events.js';
import { createEmailSendRepository } from '@adapters/db/email-sends.js';
import { createSchedulerRunRepository } from '@adapters/db/scheduler-runs.js';
import {
  createAutomationIdempotencyRepository,
  createCampaignRepository,
  createCampaignSendRepository,
  createConsentConfirmationTokenRepository,
  createConsentDefinitionRepository,
  createEmailLayoutRepository,
  createMarketingAudienceRepository,
  createMarketingConsentRepository,
  createMarketingJobRepository,
  createMarketingThrottleRepository,
  createSuppressionRepository,
  createTenantDocumentRepository,
  createTenantSesSettingsRepository,
  createUnsubscribeTokenRepository,
} from '@adapters/db/marketing-repositories.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createDevEmailReader,
  createDevMagicLinkReader,
  createEntityVersionRepository,
  createHealthPort,
  createMemberCourseProgressRepository,
  createMemberErasureRepository,
  createMemberRepository,
  createMemberSubscriptionRepository,
  createNotificationRepository,
  createOrderRepository,
  createPaymentRefundRepository,
  createPostReactionRepository,
  createPostRepository,
  createSpaceRepository,
  createSpaceSubscriptionRepository,
  createPurchaseRepository,
  createProductGrantRepository,
  createProductPriceRepository,
  createProcessedPaymentEventRepository,
  createProductRepository,
  createOnboardingStateRepository,
  createTenantAccessReader,
  createTenantApiKeyRepository,
  createTenantDomainRepository,
  createTenantRepository,
  createTenantSecretRepository,
  createTermsConsentRepository,
  createThreadSubscriptionRepository,
  createUserDisplayReader,
} from '@adapters/db/repositories.js';
import { createAuth, createAuthPort, type Auth } from '@adapters/auth/create-auth.js';
import { createApiKeyCrypto } from '@adapters/auth/api-key-crypto.js';
import { createSecretCrypto } from '@adapters/crypto/secret-crypto.js';
import { createEmailHmac } from '@adapters/crypto/email-hmac.js';
import { createTenantSecretResolver } from '@adapters/crypto/tenant-secret-resolver.js';
import { createStripePaymentProvider } from '@adapters/payment/stripe.js';
import { createFakePaymentProvider } from '@adapters/payment/fake.js';
import { createBunnyVideoLibrary } from '@adapters/video/bunny.js';
import { createBunnyEmbedTokenSigner } from '@adapters/crypto/bunny-embed-token-signer.js';
import { createS3UrlSigner } from '@adapters/storage/s3-url-signer.js';
import { createDevEmailPort } from '@adapters/email/dev.js';
import { createEmailNotificationChannel } from '@adapters/notifications/email.js';
import { createInAppNotificationChannel, createRealtimeBus } from '@adapters/notifications/in-app.js';
import { createSesEmailPort } from '@adapters/email/ses.js';
import { createSesMarketingSender, readSesQuota } from '@adapters/email/marketing-ses.js';
import { createDevMarketingSender } from '@adapters/email/dev-marketing.js';
import { createMarketingSesCredentialResolver } from '@adapters/email/marketing-credentials.js';
import { createSnsVerifier } from '@adapters/crypto/sns.js';
import { createCronMarketingScheduler, createDevMarketingScheduler } from '@adapters/scheduler/marketing.js';
import type {
  ApiKeyCrypto,
  AuthPort,
  Clock,
  PaymentProvider,
  SecretCrypto,
  TenantSecretRepository,
  TenantSecretResolver,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  DevEmailReader,
  DiscussionLinkPort,
  EntityVersionRepository,
  EmailPort,
  EmailOutboxRepository,
  EmailHmac,
  EmailEventRepository,
  EmailSendRepository,
  EmailLayoutRepository,
  AutomationIdempotencyRepository,
  CampaignRepository,
  CampaignSendRepository,
  ConsentConfirmationTokenRepository,
  ConsentDefinitionRepository,
  EnrollmentTransactionPort,
  DevMagicLinkReader,
  FileUrlSigner,
  BunnyEmbedTokenSigner,
  HealthPort,
  IdGenerator,
  MemberCourseProgressRepository,
  MemberErasurePort,
  MemberRepository,
  MemberSubscriptionRepository,
  MarketingAudienceRepository,
  MarketingConsentRepository,
  MarketingThrottleRepository,
  MarketingSesCredentialResolver,
  NotificationChannelPort,
  NotificationRepository,
  OrderRepository,
  PaymentRefundRepository,
  PostRepository,
  PurchaseRepository,
  ProductGrantRepository,
  ProductPriceRepository,
  ProcessedPaymentEventRepository,
  ProductRepository,
  OnboardingStateRepository,
  PostReactionRepository,
  RealtimeBusPort,
  SpaceRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  TenantApiKeyRepository,
  TenantDomainRepository,
  TenantRepository,
  TermsConsentRepository,
  SchedulerPort,
  SchedulerRunRepository,
  SesMarketingSender,
  SesMarketingQuotaReader,
  SnsVerifier,
  SuppressionRepository,
  TenantDocumentRepository,
  TenantSesSettingsRepository,
  UnsubscribeTokenRepository,
  ThreadSubscriptionRepository,
  UserDisplayReader,
  VideoLibraryPort,
} from '@core/server/index.js';
import { campaignTick, dispatchEmailBatch, enforceTermsConsent, resolveTenant, runMarketingRetentionJobs, runScheduledMarketingJobs, validateTermsConsent, type DispatchEmailBatchResult } from '@core/server/index.js';
import { ok, type AppError, type Result } from '@core/domain/index.js';
import { communityPostPath, communitySpacePath, lessonPath, TENANT_HEADER } from '@core/contract/index.js';

import type { Env } from './env.js';

export interface DevEndpoints {
  simulatedPayments: boolean;
  exposeMagicLinks: boolean;
}

export interface AuthConfig {
  googleEnabled: boolean;
}

export interface AppDeps {
  auth: Pick<Auth, 'handler' | 'setMagicLinkDeliveryContext' | 'setResetPasswordDeliveryContext'>;
  authPort: AuthPort;
  products: ProductRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  entityVersions: EntityVersionRepository;
  userDisplays: UserDisplayReader;
  members: MemberRepository;
  memberErasure: MemberErasurePort;
  emailHmac?: EmailHmac;
  posts: PostRepository;
  threadSubscriptions: ThreadSubscriptionRepository;
  spaces: SpaceRepository;
  reactions: PostReactionRepository;
  spaceSubscriptions: SpaceSubscriptionRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  realtimeBus: RealtimeBusPort;
  links: DiscussionLinkPort;
  progress: MemberCourseProgressRepository;
  grants: ProductGrantRepository;
  prices: ProductPriceRepository;
  orders: OrderRepository;
  paymentRefunds: PaymentRefundRepository;
  subscriptions: MemberSubscriptionRepository;
  processedPaymentEvents: ProcessedPaymentEventRepository;
  purchases: PurchaseRepository;
  tenantApiKeys: TenantApiKeyRepository;
  apiKeyCrypto: ApiKeyCrypto;
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  secretResolver: TenantSecretResolver;
  payment: PaymentProvider;
  videoLibrary: VideoLibraryPort;
  fileUrlSigner: FileUrlSigner;
  bunnyEmbedTokenSigner: BunnyEmbedTokenSigner;
  email: EmailPort;
  emailOutbox: EmailOutboxRepository;
  enrollmentTransaction: EnrollmentTransactionPort;
  dispatchEmails(trigger: 'cron' | 'dev' | 'manual'): Promise<Result<DispatchEmailBatchResult, AppError>>;
  dispatchEmail(): void;
  emailDispatchSecret: string;
  devEmails: DevEmailReader;
  devMagicLinks: DevMagicLinkReader;
  tenantDomains: TenantDomainRepository;
  tenants: TenantRepository;
  consents: TermsConsentRepository;
  onboardingState: OnboardingStateRepository;
  tenantAccess: TenantAccessReader;
  health: HealthPort;
  ids: IdGenerator;
  clock: Clock;
  baseDomain: string;
  appBaseUrl: string;
  devEndpoints: DevEndpoints;
  authConfig: AuthConfig;
  marketing?: MarketingAppDeps;
}

export interface MarketingAppDeps {
  runs: SchedulerRunRepository;
  events: EmailEventRepository;
  emailSends: EmailSendRepository;
  definitions: ConsentDefinitionRepository;
  marketingConsents: MarketingConsentRepository;
  confirmations: ConsentConfirmationTokenRepository;
  campaigns: CampaignRepository;
  layouts: EmailLayoutRepository;
  campaignSends: CampaignSendRepository;
  audience: MarketingAudienceRepository;
  suppressions: SuppressionRepository;
  unsubscribes: UnsubscribeTokenRepository;
  sesSettings: TenantSesSettingsRepository;
  documents: TenantDocumentRepository;
  idempotency: AutomationIdempotencyRepository;
  marketingSes: SesMarketingSender;
  marketingCredentials: MarketingSesCredentialResolver;
  quotaReader: SesMarketingQuotaReader | undefined;
  throttle: MarketingThrottleRepository;
  hmac: EmailHmac;
  sns: SnsVerifier;
  scheduler: SchedulerPort;
  tickSecret: string;
  cronSecret: string;
  dispatchCampaign(tenantId: string, campaignId: string, trigger: 'cron' | 'dev' | 'manual'): Promise<Result<{
    leased: boolean;
    yieldedToTransactional: boolean;
    sent: number;
    failed: number;
    skipped: number;
  }, AppError>>;
  dispatchScheduledMarketing(trigger: 'cron' | 'dev' | 'manual'): Promise<Result<{ campaignsDispatched: number; retentionTenantsProcessed: number }, AppError>>;
}

/**
 * Composition root — the ONLY place where env decides which adapters run.
 * Platform names (vercel, neon) may appear here and in adapters, never in core.
 */
export const createDeps = (env: Env): AppDeps => {
  const db = createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const tenants = createTenantRepository(db);
  const consents = createTermsConsentRepository(db);
  const tenantSecrets = createTenantSecretRepository(db);
  const ids = { nextId: () => randomUUID() };
  const clock = { nowIso: () => new Date().toISOString() };
  const secretCrypto = createSecretCrypto(env.SECRETS_MASTER_KEY);
  const emailHmac = createEmailHmac(env.SECRETS_MASTER_KEY);
  const secretResolver = createTenantSecretResolver(tenantSecrets, secretCrypto);
  const payment =
    env.PAYMENT_PROVIDER === 'stripe'
      ? createStripePaymentProvider({ resolver: secretResolver })
      : createFakePaymentProvider(secretResolver);
  const email =
    env.EMAIL_PROVIDER === 'ses'
      ? createSesEmailPort({ from: env.EMAIL_FROM ?? '' })
      : createDevEmailPort(db);
  const emailOutbox = createEmailOutboxRepository(db);
  const emailEvents = createEmailEventRepository(db);
  const emailSends = createEmailSendRepository(db);
  const schedulerRuns = createSchedulerRunRepository(db);
  const definitions = createConsentDefinitionRepository(db);
  const marketingConsents = createMarketingConsentRepository(db);
  const confirmations = createConsentConfirmationTokenRepository(db);
  const campaigns = createCampaignRepository(db);
  const layouts = createEmailLayoutRepository(db);
  const campaignSends = createCampaignSendRepository(db);
  const audience = createMarketingAudienceRepository(db);
  const suppressions = createSuppressionRepository(db);
  const unsubscribes = createUnsubscribeTokenRepository(db);
  const sesSettings = createTenantSesSettingsRepository(db);
  const documents = createTenantDocumentRepository(db);
  const idempotency = createAutomationIdempotencyRepository(db);
  const marketingJobs = createMarketingJobRepository(db);
  const marketingThrottle = createMarketingThrottleRepository(db);
  const production = env.NODE_ENV === 'production' || env.APP_ENV === 'production';
  const tenantMarketingCredentials = createMarketingSesCredentialResolver(secretResolver);
  const marketingCredentials: MarketingSesCredentialResolver = production
    ? tenantMarketingCredentials
    : { resolve: async () => ok({ accessKeyId: 'dev', secretAccessKey: 'dev', region: 'eu-central-1' }) };
  const marketingSes = production
    ? createSesMarketingSender()
    : createDevMarketingSender(email);
  const snsTestCert = env.SNS_TEST_CERT_PEM_BASE64 === undefined
    ? null
    : Buffer.from(env.SNS_TEST_CERT_PEM_BASE64, 'base64').toString('utf8');
  const sns = createSnsVerifier(snsTestCert === null ? {} : { fetchText: async () => snsTestCert });
  const devScheduler = production ? null : createDevMarketingScheduler();
  const scheduler = devScheduler ?? createCronMarketingScheduler();
  const quotaReader: SesMarketingQuotaReader | undefined = production
    ? { read: (credentials) => readSesQuota(credentials) }
    : undefined;
  const tokens = { nextToken: () => randomBytes(24).toString('base64url') };
  const dispatchDeps = {
    emailOutbox,
    events: emailEvents,
    email,
    clock,
    logger: { error: (message: string) => process.stderr.write(`${message}\n`) },
    batchSize: Math.max(1, Math.floor(env.EMAIL_DISPATCH_RATE_PER_SECOND * env.EMAIL_DISPATCH_INTERVAL_MS / 1000)),
    attemptsCap: env.EMAIL_DISPATCH_ATTEMPTS_CAP,
    backoffBaseMs: env.EMAIL_DISPATCH_BACKOFF_BASE_MS,
    backoffCapMs: env.EMAIL_DISPATCH_BACKOFF_CAP_MS,
    ids,
    runs: schedulerRuns,
  };
  const dispatchEmails = (trigger: 'cron' | 'dev' | 'manual') => dispatchEmailBatch({ ...dispatchDeps, trigger });
  const dispatchEmail = (): void => {
    void dispatchEmails('dev').then((result) => {
      if (!result.ok) process.stderr.write(`[email-outbox] opportunistic dispatch failed: ${result.error.message}\n`);
    });
  };
  const dispatchCampaign = async (tenantId: string, campaignId: string, trigger: 'cron' | 'dev' | 'manual') => {
    const settings = await sesSettings.findByTenant(tenantId);
    if (production && settings !== null && (settings.quotaRefreshedAt === null
      || Date.parse(clock.nowIso()) - Date.parse(settings.quotaRefreshedAt) >= 15 * 60 * 1000)) {
      const credentials = await marketingCredentials.resolve(tenantId);
      if (credentials.ok) {
        const quota = await readSesQuota(credentials.value);
        if (quota.ok) {
          await sesSettings.upsert(tenantId, {
            ...settings,
            quotaRatePerSec: quota.value.ratePerSecond,
            quotaDaily: quota.value.daily,
            quotaSentLast24Hours: quota.value.sentLast24Hours,
            quotaRefreshedAt: clock.nowIso(),
            inSandbox: quota.value.inSandbox,
          });
        }
      }
    }
    return campaignTick({
      identity: {
        userId: 'marketing-worker', email: 'worker@together.invalid', name: 'Marketing worker',
        tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null,
      },
    }, { campaignId, workerId: randomUUID(), tickSeconds: 50, trigger }, {
      definitions, consents: marketingConsents, campaigns, layouts, sends: campaignSends, events: emailEvents, audience,
      suppressions, unsubscribes, sesSettings, ses: marketingSes, credentials: marketingCredentials,
      quotaReader, throttle: marketingThrottle, hmac: emailHmac, ids, tokens, clock,
      unsubscribeBaseUrl: `${env.APP_BASE_URL}/u`, outbox: emailOutbox, scheduler, runs: schedulerRuns,
    });
  };
  devScheduler?.setCampaignHandler(async (tenantId, campaignId) => {
    const result = await dispatchCampaign(tenantId, campaignId, 'dev');
    if (!result.ok) process.stderr.write(`[marketing] campaign tick failed: ${result.error.message}\n`);
  });
  const workerIdentity = (tenantId: string) => ({
    userId: 'marketing-worker', email: 'worker@together.invalid', name: 'Marketing worker',
    tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null,
  });
  const dispatchScheduledMarketing = (trigger: 'cron' | 'dev' | 'manual') => {
    const now = clock.nowIso();
    return runScheduledMarketingJobs({
      now,
      pendingOlderThan: new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString(),
      renderedBodiesOlderThan: new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString(),
      engagementOlderThan: new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString(),
    }, {
      jobs: marketingJobs,
      runs: schedulerRuns,
      dispatchCampaign: (tenantId, campaignId) => dispatchCampaign(tenantId, campaignId, trigger),
      runRetention: (tenantId, input) => runMarketingRetentionJobs({ identity: workerIdentity(tenantId) }, input, {
        definitions, consents: marketingConsents, sends: campaignSends, events: emailEvents, idempotency, clock,
      }),
    });
  };
  const realtimeBus = createRealtimeBus();
  const tenantUrl = (tenantSlug: string | null, pathname: string): string => {
    const url = new URL(env.APP_BASE_URL);
    if (tenantSlug !== null) url.hostname = `${tenantSlug}.${env.APP_BASE_DOMAIN}`;
    url.pathname = pathname;
    return url.toString();
  };
  const links: DiscussionLinkPort = {
    lessonDiscussionUrl: ({ tenantSlug, courseId, lessonId }) =>
      tenantUrl(tenantSlug, courseId === null ? '/my' : lessonPath(courseId, lessonId)),
    spaceUrl: ({ tenantSlug, spaceId, rootPostId }) =>
      tenantUrl(
        tenantSlug,
        rootPostId === undefined
          ? communitySpacePath(spaceId)
          : communityPostPath(spaceId, rootPostId),
      ),
  };

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : null;

  const baseTrustedOrigins = [
    env.APP_BASE_URL,
    `http://*.${env.APP_BASE_DOMAIN}`,
    `https://*.${env.APP_BASE_DOMAIN}`,
    // Wildcard entries above don't match origins carrying an explicit port.
    `http://*.${env.APP_BASE_DOMAIN}:${env.PORT}`,
    `https://*.${env.APP_BASE_DOMAIN}:${env.PORT}`,
  ];

  const auth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    baseDomain: env.APP_BASE_DOMAIN,
    secureCookies: env.SECURE_COOKIES,
    exposeMagicLinks: env.AUTH_DEV_EXPOSE_MAGIC_LINKS,
    emailOutbox,
    ids,
    clock,
    dispatchEmail,
    defaultTenantName: 'Together',
    google,
    validateSignUpConsent: async ({ request, accepted }) => {
      const resolved = await resolveTenant(
        request.headers.get('host') ?? new URL(request.url).host,
        request.headers.get(TENANT_HEADER),
        { tenantDomains, tenants, baseDomain: env.APP_BASE_DOMAIN },
      );
      if (!resolved.ok) return resolved;
      if (resolved.value === null) return ok({ required: false });
      return validateTermsConsent(resolved.value.tenant.id, accepted, tenants);
    },
    recordSignUpConsent: async ({ request, email: signUpEmail }) => {
      const resolved = await resolveTenant(
        request.headers.get('host') ?? new URL(request.url).host,
        request.headers.get(TENANT_HEADER),
        { tenantDomains, tenants, baseDomain: env.APP_BASE_DOMAIN },
      );
      if (!resolved.ok) return resolved;
      if (resolved.value === null) return ok({ recorded: false });
      return enforceTermsConsent(
        resolved.value.tenant.id,
        { accepted: true, userId: null, email: signUpEmail, source: 'register' },
        { tenants, consents, ids, clock },
      );
    },
    trustedOrigins: async () => {
      const domains = await tenantDomains.listVerifiedDomains();
      return [
        ...baseTrustedOrigins,
        ...domains.map((domain) => `https://${domain.domain}`),
        ...domains.map((domain) => `http://${domain.domain}`),
      ];
    },
  });

  return {
    auth,
    authPort: createAuthPort(auth),
    products: createProductRepository(db),
    courses: createCourseRepository(db),
    modules: createCourseModuleRepository(db),
    lessons: createCourseLessonRepository(db),
    entityVersions: createEntityVersionRepository(db),
    userDisplays: createUserDisplayReader(db),
    members: createMemberRepository(db),
    memberErasure: createMemberErasureRepository(db, emailHmac),
    emailHmac,
    posts: createPostRepository(db),
    threadSubscriptions: createThreadSubscriptionRepository(db),
    spaces: createSpaceRepository(db),
    reactions: createPostReactionRepository(db),
    spaceSubscriptions: createSpaceSubscriptionRepository(db),
    notifications: createNotificationRepository(db),
    notificationChannels: [
      createInAppNotificationChannel(realtimeBus),
      ...(env.NOTIFY_EMAIL ? [createEmailNotificationChannel(emailOutbox, ids, clock, dispatchEmail)] : []),
    ],
    realtimeBus,
    links,
    progress: createMemberCourseProgressRepository(db),
    grants: createProductGrantRepository(db),
    prices: createProductPriceRepository(db),
    orders: createOrderRepository(db),
    paymentRefunds: createPaymentRefundRepository(db),
    subscriptions: createMemberSubscriptionRepository(db),
    processedPaymentEvents: createProcessedPaymentEventRepository(db),
    purchases: createPurchaseRepository(db),
    tenantApiKeys: createTenantApiKeyRepository(db),
    apiKeyCrypto: createApiKeyCrypto(),
    tenantSecrets,
    secretCrypto,
    secretResolver,
    payment,
    videoLibrary: createBunnyVideoLibrary(),
    bunnyEmbedTokenSigner: createBunnyEmbedTokenSigner(),
    fileUrlSigner: createS3UrlSigner(),
    email,
    emailOutbox,
    enrollmentTransaction: createEnrollmentTransactionPort(db),
    dispatchEmails,
    dispatchEmail,
    emailDispatchSecret: env.EMAIL_DISPATCH_SECRET,
    devEmails: createDevEmailReader(db),
    devMagicLinks: createDevMagicLinkReader(db),
    tenantDomains,
    tenants,
    consents,
    onboardingState: createOnboardingStateRepository(db),
    tenantAccess: createTenantAccessReader(db),
    health: createHealthPort(db),
    ids,
    clock,
    baseDomain: env.APP_BASE_DOMAIN,
    appBaseUrl: env.APP_BASE_URL,
    devEndpoints: {
      simulatedPayments: env.SIMULATED_PAYMENTS,
      exposeMagicLinks: env.AUTH_DEV_EXPOSE_MAGIC_LINKS,
    },
    authConfig: { googleEnabled: google !== null },
    marketing: {
      runs: schedulerRuns,
      definitions,
      events: emailEvents,
      emailSends,
      marketingConsents,
      confirmations,
      campaigns,
      layouts,
      campaignSends,
      audience,
      suppressions,
      unsubscribes,
      sesSettings,
      documents,
      idempotency,
      marketingSes,
      marketingCredentials,
      quotaReader,
      throttle: marketingThrottle,
      hmac: emailHmac,
      sns,
      scheduler,
      tickSecret: env.MARKETING_TICK_SECRET,
      cronSecret: env.CRON_SECRET ?? env.MARKETING_TICK_SECRET,
      dispatchCampaign,
      dispatchScheduledMarketing,
    },
  };
};
