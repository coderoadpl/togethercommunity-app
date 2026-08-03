import { randomBytes, randomUUID } from 'node:crypto';

import { createDb } from '#adapters/db/client.js';
import { createEmailOutboxRepository, createEnrollmentTransactionPort, createPlatformTransactionalPool } from '#adapters/db/email-outbox.js';
import { createEmailEventRepository } from '#adapters/db/email-events.js';
import { createPaymentTransactionPort } from '#adapters/db/payment-transaction.js';
import { createMemberErasureRequestRepository } from '#adapters/db/member-erasure-requests.js';
import { createEmailSendRepository } from '#adapters/db/email-sends.js';
import { createInvoiceRepository } from '#adapters/db/invoice-repositories.js';
import {
  createFiscalArtifactRepository,
  createKsefNumberRepository,
  createKsefSubmissionJobRepository,
} from '#adapters/db/ksef-repositories.js';
import { createSchedulerRunRepository } from '#adapters/db/scheduler-runs.js';
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
} from '#adapters/db/marketing-repositories.js';
import {
  createCouponCheckoutSessionRepository,
  createCouponRedemptionRepository,
  createCouponRepository,
  createCouponStatsRepository,
  createProductPriceHistoryRepository,
} from '#adapters/db/coupon-repositories.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createCheckoutConsentCaptureRepository,
  createDevEmailReader,
  createDevMagicLinkReader,
  createDevSinkPurge,
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
  createPostReportRepository,
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
} from '#adapters/db/repositories.js';
import { createAuth, createAuthPort, type Auth } from '#adapters/auth/create-auth.js';
import { createApiKeyCrypto } from '#adapters/auth/api-key-crypto.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createKsefCredentialResolver } from '#adapters/crypto/ksef-credential-resolver.js';
import { createEmailHmac } from '#adapters/crypto/email-hmac.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createStripePaymentProvider } from '#adapters/payment/stripe.js';
import { createFakePaymentProvider } from '#adapters/payment/fake.js';
import { createFakeInvoicing } from '#adapters/invoicing/fake.js';
import { createIfirmaInvoicing } from '#adapters/invoicing/ifirma.js';
import { createKsefClient } from '#adapters/invoicing/ksef.js';
import { createKsefInvoicePdf } from '#adapters/invoicing/ksef-pdf.js';
import { createFa3XsdValidator } from '#adapters/invoicing/fa3-validator.js';
import { createBunnyVideoLibrary } from '#adapters/video/bunny.js';
import { createBunnyEmbedTokenSigner } from '#adapters/crypto/bunny-embed-token-signer.js';
import { createS3UrlSigner } from '#adapters/storage/s3-url-signer.js';
import { createDevEmailPort } from '#adapters/email/dev.js';
import { createEmailNotificationChannel } from '#adapters/notifications/email.js';
import { createInAppNotificationChannel, createRealtimeBus } from '#adapters/notifications/in-app.js';
import { createSesEmailPort } from '#adapters/email/ses.js';
import { createSmtpEmailPort } from '#adapters/email/smtp.js';
import { createSmtpTransactionalResolver, createTenantSesTransactionalResolver } from '#adapters/email/transactional-resolvers.js';
import { createSesMarketingSender, readSesQuota } from '#adapters/email/marketing-ses.js';
import { createDevMarketingSender } from '#adapters/email/dev-marketing.js';
import { createMarketingSesCredentialResolver } from '#adapters/email/marketing-credentials.js';
import { createSesOnboardingControlPlane } from '#adapters/email/ses-onboarding.js';
import { createSnsVerifier } from '#adapters/crypto/sns.js';
import { createCronMarketingScheduler, createDevMarketingScheduler } from '#adapters/scheduler/marketing.js';
import type {
  ApiKeyCrypto,
  AuthPort,
  Clock,
  CheckoutConsentCaptureRepository,
  CouponCheckoutSessionRepository,
  CouponRedemptionRepository,
  CouponManagementRepository,
  CouponStatsRepository,
  PaymentProvider,
  PlatformTransactionalPool,
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
  PaymentTransactionPort,
  DevMagicLinkReader,
  DevSinkPurge,
  FileUrlSigner,
  BunnyEmbedTokenSigner,
  HealthPort,
  IdGenerator,
  InvoiceRepository,
  InvoicingPort,
  ContentHash,
  Fa3Validator,
  FiscalArtifactRepository,
  KsefClientPort,
  KsefCredentialResolver,
  KsefNumberRepository,
  KsefInvoicePdf,
  KsefSubmissionJobRepository,
  MemberCourseProgressRepository,
  MemberErasureRequestRepository,
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
  OrderDetailRepository,
  PaymentRefundRepository,
  PostRepository,
  PostReportRepository,
  PurchaseRepository,
  ProductGrantRepository,
  ProductPriceRepository,
  ProductPriceHistoryRepository,
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
  SesOnboardingControlPlane,
  SnsVerifier,
  SuppressionRepository,
  TenantDocumentRepository,
  TenantSesSettingsRepository,
  TransactionalEmailTransportResolver,
  UnsubscribeTokenRepository,
  ThreadSubscriptionRepository,
  UserDisplayReader,
  VideoLibraryPort,
  TenantCreationMode,
} from '#core/server/index.js';
import { campaignTick, createLayeredTransactionalEmailSender, dispatchEmailBatch, dispatchKsefJob, enforceTermsConsent, refreshSesIdentity, resolveTenant, runMarketingRetentionJobs, runReputationAlerts, runScheduledMarketingJobs, SES_IDENTITY_REFRESH_INTERVAL_MS, validateTermsConsent, type DispatchEmailBatchResult } from '#core/server/index.js';
import { ok, type AppError, type KsefEnvironment, type Result } from '#core/domain/index.js';
import { capabilitiesForPrincipal, communityPostPath, communitySpacePath, lessonPath, TENANT_HEADER } from '#core/contract/index.js';

import type { Env } from './env.js';
import { APP_VERSION } from './version.js';

export interface DevEndpoints {
  simulatedPayments: boolean;
  exposeMagicLinks: boolean;
}

export interface AuthConfig {
  googleEnabled: boolean;
}

export interface KsefAppDeps {
  environment: KsefEnvironment;
  credentials: KsefCredentialResolver;
  numbers: KsefNumberRepository;
  artifacts: FiscalArtifactRepository;
  hash: ContentHash;
  validator: Fa3Validator;
  pdf: KsefInvoicePdf;
  client: KsefClientPort;
  jobs: KsefSubmissionJobRepository;
  dispatchSecret: string;
  dispatch(): Promise<Result<{
    processed: boolean;
    invoiceId: string | null;
    processedCount: number;
  }, AppError>>;
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
  erasureRequests: MemberErasureRequestRepository;
  emailHmac?: EmailHmac;
  posts: PostRepository;
  reports: PostReportRepository;
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
  orderDetails?: OrderDetailRepository;
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
  checkoutConsentCaptures: CheckoutConsentCaptureRepository;
  invoices: InvoiceRepository;
  invoicing: InvoicingPort;
  ksef?: KsefAppDeps;
  coupons?: CouponManagementRepository;
  couponRedemptions?: CouponRedemptionRepository;
  couponCheckoutSessions?: CouponCheckoutSessionRepository;
  priceHistory?: ProductPriceHistoryRepository;
  couponStats?: CouponStatsRepository;
  videoLibrary: VideoLibraryPort;
  fileUrlSigner: FileUrlSigner;
  bunnyEmbedTokenSigner: BunnyEmbedTokenSigner;
  email: EmailPort;
  emailOutbox: EmailOutboxRepository;
  enrollmentTransaction: EnrollmentTransactionPort;
  paymentTransaction: PaymentTransactionPort;
  dispatchEmails(trigger: 'cron' | 'dev' | 'manual'): Promise<Result<DispatchEmailBatchResult, AppError>>;
  dispatchEmail(): void;
  emailDispatchSecret: string;
  devEmails: DevEmailReader;
  devMagicLinks: DevMagicLinkReader;
  devSinkPurge?: DevSinkPurge;
  tenantDomains: TenantDomainRepository;
  tenants: TenantRepository;
  consents: TermsConsentRepository;
  onboardingState: OnboardingStateRepository;
  tenantAccess: TenantAccessReader;
  health: HealthPort;
  appVersion: string;
  commitSha: string;
  tenantCreationMode: TenantCreationMode;
  ids: IdGenerator;
  clock: Clock;
  logger: { error(message: string): void };
  deferredEffects: { schedule(effect: () => Promise<void>): void };
  baseDomain: string;
  singleTenantMode: boolean;
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
  platformTransactionalPool: PlatformTransactionalPool;
  smtpTest: TransactionalEmailTransportResolver;
  documents: TenantDocumentRepository;
  idempotency: AutomationIdempotencyRepository;
  marketingSes: SesMarketingSender;
  marketingCredentials: MarketingSesCredentialResolver;
  quotaReader: SesMarketingQuotaReader | undefined;
  sesOnboarding?: {
    controlPlane: SesOnboardingControlPlane;
    credentials: MarketingSesCredentialResolver;
  };
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
  dispatchScheduledMarketing(trigger: 'cron' | 'dev' | 'manual'): Promise<Result<{ campaignsDispatched: number; retentionTenantsProcessed: number; identityChecksPerformed: number; reputationAlertsSent: number }, AppError>>;
}

export const selectDevSinkPurge = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV'>,
  create: () => DevSinkPurge,
): DevSinkPurge | undefined =>
  env.NODE_ENV === 'production' || env.APP_ENV === 'production' ? undefined : create();

export const selectTenantRouting = (
  env: Pick<Env, 'APP_BASE_DOMAIN' | 'APP_BASE_URL'>,
): { baseDomain: string; singleTenantMode: boolean } => ({
  baseDomain: env.APP_BASE_DOMAIN ?? new URL(env.APP_BASE_URL).hostname,
  singleTenantMode: env.APP_BASE_DOMAIN === undefined,
});

export const selectTenantCreationMode = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'TENANT_CREATION'>,
): TenantCreationMode => {
  if (env.TENANT_CREATION === 'closed') return 'closed';
  return env.NODE_ENV === 'production' || env.APP_ENV === 'production' ? 'bootstrap' : 'open';
};

/**
 * Composition root — the ONLY place where env decides which adapters run.
 * Platform names (vercel, neon) may appear here and in adapters, never in core.
 */
export const createDeps = (env: Env, options: { clock?: Clock } = {}): AppDeps => {
  const { baseDomain, singleTenantMode } = selectTenantRouting(env);
  const db = createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const tenants = createTenantRepository(db);
  const tenantAccess = createTenantAccessReader(db);
  const consents = createTermsConsentRepository(db);
  const tenantSecrets = createTenantSecretRepository(db);
  const ids = { nextId: () => randomUUID() };
  const clock = options.clock ?? { nowIso: () => new Date().toISOString() };
  const secretCrypto = createSecretCrypto(env.SECRETS_MASTER_KEY);
  const emailHmac = createEmailHmac(env.SECRETS_MASTER_KEY);
  const secretResolver = createTenantSecretResolver(tenantSecrets, secretCrypto);
  const invoiceRepository = createInvoiceRepository(db);
  const ksefCredentials = createKsefCredentialResolver(secretResolver);
  const ksefNumbers = createKsefNumberRepository(db);
  const fiscalArtifacts = createFiscalArtifactRepository(db);
  const ksefJobs = createKsefSubmissionJobRepository(db);
  const contentHash = createContentHash();
  const ksefPdf = createKsefInvoicePdf();
  const fa3Validator = createFa3XsdValidator();
  const ksefClient = createKsefClient({
    baseUrls: {
      test: env.KSEF_TEST_BASE_URL,
      production: env.KSEF_PRODUCTION_BASE_URL,
    },
  });
  const ksefSubmissionDeps = {
    invoices: invoiceRepository,
    artifacts: fiscalArtifacts,
    credentials: ksefCredentials,
    ksef: ksefClient,
    hash: contentHash,
    ids,
    clock,
    retry: {
      baseMs: 1000,
      capMs: 15 * 60 * 1000,
      jitter: () => Math.floor(Math.random() * 250),
    },
    jobs: ksefJobs,
  };
  const dispatchKsef = () => dispatchKsefJob(ksefSubmissionDeps);
  const payment =
    env.PAYMENT_PROVIDER === 'stripe'
      ? createStripePaymentProvider({ resolver: secretResolver })
      : createFakePaymentProvider(secretResolver);
  const devEmail = createDevEmailPort(db, clock);
  const email =
    env.EMAIL_PROVIDER === 'ses'
      ? createSesEmailPort({ from: env.EMAIL_FROM ?? '' })
      : env.EMAIL_PROVIDER === 'smtp'
        ? createSmtpEmailPort({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            from: env.EMAIL_FROM ?? '',
            ...(env.SMTP_USER === undefined ? {} : { user: env.SMTP_USER }),
            ...(env.SMTP_PASSWORD === undefined ? {} : { password: env.SMTP_PASSWORD }),
          })
        : devEmail;
  const emailOutbox = createEmailOutboxRepository(db, env.EMAIL_DISPATCH_ATTEMPTS_CAP);
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
  const sesOnboardingControlPlane = createSesOnboardingControlPlane();
  const marketingThrottle = createMarketingThrottleRepository(db);
  const production = env.NODE_ENV === 'production' || env.APP_ENV === 'production';
  const devSinkPurge = selectDevSinkPurge(env, () => createDevSinkPurge(db));
  const invoicing = production ? createIfirmaInvoicing() : createFakeInvoicing();
  const tenantMarketingCredentials = createMarketingSesCredentialResolver(secretResolver);
  const platformTransactionalPool = createPlatformTransactionalPool(db);
  const tenantSesTransactional = createTenantSesTransactionalResolver(
    sesSettings,
    tenantMarketingCredentials,
    production ? createSesEmailPort : () => email,
  );
  const smtpTransactional = createSmtpTransactionalResolver(
    sesSettings,
    secretResolver,
    production ? createSmtpEmailPort : () => email,
  );
  const smtpTest = createSmtpTransactionalResolver(sesSettings, secretResolver);
  const transactionalEmail = createLayeredTransactionalEmailSender({
    tenantSes: tenantSesTransactional,
    smtp: smtpTransactional,
    platform: email,
    pool: platformTransactionalPool,
    platformLimit: 1000,
  });
  const marketingCredentials: MarketingSesCredentialResolver = production
    ? tenantMarketingCredentials
    : { resolve: async () => ok({ accessKeyId: 'dev', secretAccessKey: 'dev', region: 'eu-central-1' }) };
  const marketingSes = production
    ? createSesMarketingSender()
    : createDevMarketingSender(devEmail);
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
  const logger = { error: (message: string) => process.stderr.write(`${message}\n`) };
  const dispatchDeps = {
    emailOutbox,
    events: emailEvents,
    email: transactionalEmail,
    clock,
    logger,
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
        tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberBannedAt: null,
      },
      capabilities: capabilitiesForPrincipal('operator-secret'),
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
    tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberBannedAt: null,
  });
  const reputationDashboardUrl = (tenantSlug: string): string => {
    const url = new URL(env.APP_BASE_URL);
    if (!singleTenantMode) url.hostname = `${tenantSlug}.${baseDomain}`;
    url.pathname = '/panel/marketing';
    return url.toString();
  };
  const dispatchScheduledMarketing = (trigger: 'cron' | 'dev' | 'manual') => {
    const now = clock.nowIso();
    return runScheduledMarketingJobs({
      now,
      pendingOlderThan: new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString(),
      renderedBodiesOlderThan: new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString(),
      engagementOlderThan: new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString(),
      sesIdentityRefreshIntervalMs: SES_IDENTITY_REFRESH_INTERVAL_MS,
    }, {
      jobs: marketingJobs,
      runs: schedulerRuns,
      dispatchCampaign: (tenantId, campaignId) => dispatchCampaign(tenantId, campaignId, trigger),
      runRetention: (tenantId, input) => runMarketingRetentionJobs({
        identity: workerIdentity(tenantId),
        capabilities: capabilitiesForPrincipal('operator-secret'),
      }, input, {
        definitions, consents: marketingConsents, sends: campaignSends, events: emailEvents, idempotency, clock,
      }),
      refreshIdentity: (tenantId) =>
        refreshSesIdentity(
          { identity: workerIdentity(tenantId) },
          {
            settings: sesSettings,
            credentials: tenantMarketingCredentials,
            controlPlane: sesOnboardingControlPlane,
            clock,
            webhookBaseUrl: `${env.APP_BASE_URL}/api/webhooks/ses`,
          },
        ),
      runReputationAlerts: (tenantId) =>
        runReputationAlerts(
          { identity: workerIdentity(tenantId) },
          {
            events: emailEvents,
            settings: sesSettings,
            tenants,
            tenantAccess,
            emailOutbox,
            ids,
            clock,
            dashboardUrl: reputationDashboardUrl,
            dispatchEmail,
          },
        ),
    });
  };
  const realtimeBus = createRealtimeBus();
  const tenantUrl = (tenantSlug: string | null, pathname: string): string => {
    const url = new URL(env.APP_BASE_URL);
    if (!singleTenantMode && tenantSlug !== null) url.hostname = `${tenantSlug}.${baseDomain}`;
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
    `http://*.${baseDomain}`,
    `https://*.${baseDomain}`,
    // Wildcard entries above don't match origins carrying an explicit port.
    `http://*.${baseDomain}:${env.PORT}`,
    `https://*.${baseDomain}:${env.PORT}`,
  ];

  const auth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    baseDomain,
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
        { tenantDomains, tenants, baseDomain, singleTenantMode },
      );
      if (!resolved.ok) return resolved;
      if (resolved.value === null) return ok({ required: false });
      return validateTermsConsent(resolved.value.tenant.id, accepted, tenants);
    },
    recordSignUpConsent: async ({ request, email: signUpEmail }) => {
      const resolved = await resolveTenant(
        request.headers.get('host') ?? new URL(request.url).host,
        request.headers.get(TENANT_HEADER),
        { tenantDomains, tenants, baseDomain, singleTenantMode },
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
    erasureRequests: createMemberErasureRequestRepository(db),
    emailHmac,
    posts: createPostRepository(db),
    reports: createPostReportRepository(db),
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
    orderDetails: createOrderRepository(db),
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
    checkoutConsentCaptures: createCheckoutConsentCaptureRepository(db),
    invoices: invoiceRepository,
    invoicing,
    ksef: {
      environment: env.KSEF_ENVIRONMENT,
      credentials: ksefCredentials,
      numbers: ksefNumbers,
      artifacts: fiscalArtifacts,
      hash: contentHash,
      validator: fa3Validator,
      pdf: ksefPdf,
      client: ksefClient,
      jobs: ksefJobs,
      dispatchSecret: env.CRON_SECRET ?? env.MARKETING_TICK_SECRET,
      dispatch: dispatchKsef,
    },
    coupons: createCouponRepository(db),
    couponRedemptions: createCouponRedemptionRepository(db),
    couponCheckoutSessions: createCouponCheckoutSessionRepository(db),
    priceHistory: createProductPriceHistoryRepository(db),
    couponStats: createCouponStatsRepository(db),
    videoLibrary: createBunnyVideoLibrary(),
    bunnyEmbedTokenSigner: createBunnyEmbedTokenSigner(),
    fileUrlSigner: createS3UrlSigner(),
    email,
    emailOutbox,
    enrollmentTransaction: createEnrollmentTransactionPort(db),
    paymentTransaction: createPaymentTransactionPort(db),
    dispatchEmails,
    dispatchEmail,
    emailDispatchSecret: env.EMAIL_DISPATCH_SECRET,
    devEmails: createDevEmailReader(db),
    devMagicLinks: createDevMagicLinkReader(db),
    ...(devSinkPurge === undefined ? {} : { devSinkPurge }),
    tenantDomains,
    tenants,
    consents,
    onboardingState: createOnboardingStateRepository(db),
    tenantAccess,
    health: createHealthPort(db),
    appVersion: APP_VERSION,
    commitSha: env.APP_COMMIT_SHA ?? 'unknown',
    tenantCreationMode: selectTenantCreationMode(env),
    ids,
    clock,
    logger,
    deferredEffects: {
      schedule: (effect) => {
        queueMicrotask(() => { void effect(); });
      },
    },
    baseDomain,
    singleTenantMode,
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
      platformTransactionalPool,
      smtpTest,
      documents,
      idempotency,
      marketingSes,
      marketingCredentials,
      quotaReader,
      sesOnboarding: {
        controlPlane: sesOnboardingControlPlane,
        credentials: tenantMarketingCredentials,
      },
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
