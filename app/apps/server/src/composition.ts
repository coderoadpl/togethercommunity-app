import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { createDb } from '#adapters/db/client.js';
import { createAutoInvoiceJobRepository } from '#adapters/db/auto-invoice-jobs.js';
import { createEmailOutboxRepository, createEnrollmentTransactionPort, createPlatformTransactionalPool } from '#adapters/db/email-outbox.js';
import { createEmailEventRepository } from '#adapters/db/email-events.js';
import { createPaymentTransactionPort } from '#adapters/db/payment-transaction.js';
import { createMemberErasureRequestRepository } from '#adapters/db/member-erasure-requests.js';
import { createMemberEventRepository } from '#adapters/db/member-events.js';
import { createImportAuditEventRepository } from '#adapters/db/import-audit-events.js';
import { createImportContentRepository } from '#adapters/db/content-import.js';
import { createImportUsersRepository } from '#adapters/db/users-import.js';
import { createEmailSendRepository } from '#adapters/db/email-sends.js';
import { createInvoiceRepository } from '#adapters/db/invoice-repositories.js';
import {
  createFiscalArtifactRepository,
  createKsefNumberRepository,
  createKsefSubmissionJobRepository,
} from '#adapters/db/ksef-repositories.js';
import { createSchedulerRunRepository } from '#adapters/db/scheduler-runs.js';
import { createConsentEvidenceRetentionRepository } from '#adapters/db/consent-evidence-retention.js';
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
  createLessonAttachmentRepository,
  createProductDownloadAssetRepository,
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
  createSpaceSeenRepository,
  createSpaceSubscriptionRepository,
  createPurchaseRepository,
  createProductGrantRepository,
  createProductPriceRepository,
  createProcessedPaymentEventRepository,
  createProductRepository,
  createOnboardingStateRepository,
  createTenantAccessReader,
  createTenantApiKeyRepository,
  createApiKeyRateLimitRepository,
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
import { createBunnyTokenSigner } from '#adapters/crypto/bunny-token-signer.js';
import { createS3StorageProvider } from '#adapters/storage/s3.js';
import { createDevEmailPort } from '#adapters/email/dev.js';
import { createEmailNotificationChannel } from '#adapters/notifications/email.js';
import { createInAppNotificationChannel, createRealtimeBus } from '#adapters/notifications/in-app.js';
import { createSesEmailPort } from '#adapters/email/ses.js';
import { createSmtpEmailPort } from '#adapters/email/smtp.js';
import { createResendEmailPort } from '#adapters/email/resend.js';
import {
  createEmailIntegrationTransportResolver,
  createResendTransactionalResolver,
  createSmtpTransactionalResolver,
  createTenantSesTransactionalResolver,
} from '#adapters/email/transactional-resolvers.js';
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
  LessonAttachmentRepository,
  ProductDownloadAssetRepository,
  CourseModuleRepository,
  CourseRepository,
  DevEmailReader,
  DiscussionLinkPort,
  EntityVersionRepository,
  EmailPort,
  EmailOutboxRepository,
  EmailHmac,
  EmailIntegrationTransportResolver,
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
  StorageProvider,
  BunnyTokenSigner,
  HealthPort,
  IdGenerator,
  ImportAuditEventRepository,
  ImportContentRepository,
  ImportUsersReader,
  ImportUsersRepository,
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
  MemberEventRepository,
  MemberRepository,
  MemberSubscriptionRepository,
  MarketingAudienceRepository,
  MarketingConsentRepository,
  MarketingThrottleRepository,
  MarketingSesCredentialResolver,
  MemberOrderListReader,
  NotificationChannelPort,
  NotificationRepository,
  OrderRepository,
  OrderDetailRepository,
  PaymentRefundRepository,
  PostRepository,
  PostReportRepository,
  PurchaseRepository,
  ProductBatchReader,
  ProductMetadataRepository,
  ProductGrantRepository,
  ProductPriceRepository,
  ProductPriceHistoryRepository,
  ProcessedPaymentEventRepository,
  ProductRepository,
  OnboardingStateRepository,
  PostReactionRepository,
  RealtimeBusPort,
  SpaceRepository,
  SpaceSeenRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  TenantApiKeyRepository,
  ApiKeyRateLimitRepository,
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
  TransactionalEmailSender,
  UnsubscribeTokenRepository,
  ThreadSubscriptionRepository,
  UserDisplayReader,
  VideoLibraryPort,
} from '#core/server/index.js';
import { campaignTick, CONSENT_EVIDENCE_PURGE_BATCH_SIZE, CONSENT_EVIDENCE_PURGE_INTERVAL_MS, CONSENT_EVIDENCE_PURGE_TIME_BUDGET_MS, createLayeredTransactionalEmailSender, dispatchAutoInvoiceJobs, dispatchEmailBatch, dispatchKsefJob, enforceTermsConsent, purgeExpiredConsentEvidence, refreshSesIdentity, resolveTenant, runMarketingRetentionJobs, runReputationAlerts, runScheduledMarketingJobs, SES_IDENTITY_REFRESH_INTERVAL_MS, tenantUrl, validateTermsConsent, type DispatchAutoInvoiceJobsResult, type DispatchEmailBatchResult } from '#core/server/index.js';
import {
  ok,
  type AppError,
  type KsefEnvironment,
  type Result,
  type TenantCreationMode,
} from '#core/domain/index.js';
import { capabilitiesForPrincipal, communityPostPath, communitySpacePath, lessonPath, TENANT_HEADER } from '#core/contract/index.js';

import { type Env, isProductionEnvironment } from './env.js';
import { APP_VERSION } from './version.js';

interface DevEndpoints {
  simulatedPayments: boolean;
  exposeMagicLinks: boolean;
}

interface AuthConfig {
  googleEnabled: boolean;
}

interface DeploymentIdentity {
  environment: string;
  production: boolean;
  commit: string | null;
  databaseFingerprint: string | null;
}

interface KsefAppDeps {
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
  auth: Pick<Auth, 'handler' | 'setMagicLinkDeliveryContext' | 'setResetPasswordDeliveryContext' | 'setEmailVerificationDeliveryContext'>;
  authPort: AuthPort;
  products: ProductRepository & ProductBatchReader & ProductMetadataRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  attachments: LessonAttachmentRepository;
  downloadAssets: ProductDownloadAssetRepository;
  entityVersions: EntityVersionRepository;
  userDisplays: UserDisplayReader;
  members: MemberRepository;
  memberEvents: MemberEventRepository;
  memberErasure: MemberErasurePort;
  erasureRequests: MemberErasureRequestRepository;
  emailHmac?: EmailHmac;
  posts: PostRepository;
  reports: PostReportRepository;
  threadSubscriptions: ThreadSubscriptionRepository;
  spaces: SpaceRepository;
  reactions: PostReactionRepository;
  spaceSubscriptions: SpaceSubscriptionRepository;
  spaceSeen: SpaceSeenRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  realtimeBus: RealtimeBusPort;
  links: DiscussionLinkPort;
  progress: MemberCourseProgressRepository;
  grants: ProductGrantRepository;
  prices: ProductPriceRepository;
  orders: OrderRepository & MemberOrderListReader;
  orderDetails?: OrderDetailRepository;
  paymentRefunds: PaymentRefundRepository;
  subscriptions: MemberSubscriptionRepository;
  processedPaymentEvents: ProcessedPaymentEventRepository;
  purchases: PurchaseRepository;
  tenantApiKeys: TenantApiKeyRepository;
  importAuditEvents: ImportAuditEventRepository;
  importContent: ImportContentRepository;
  importUsersReader: ImportUsersReader;
  importUsers: ImportUsersRepository;
  contentHash: ContentHash;
  apiKeyRateLimits: ApiKeyRateLimitRepository;
  m2mTransactionalRateLimits: { perMinute: number; perDay: number };
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
  storage: StorageProvider;
  bunnyTokenSigner: BunnyTokenSigner;
  playbackTokenTtlSeconds: number;
  email: EmailPort;
  emailSender: TransactionalEmailSender;
  emailTransports: EmailIntegrationTransportResolver;
  emailOutbox: EmailOutboxRepository;
  enrollmentTransaction: EnrollmentTransactionPort;
  paymentTransaction: PaymentTransactionPort;
  dispatchEmails(trigger: 'cron' | 'dev' | 'manual'): Promise<Result<DispatchEmailBatchResult, AppError>>;
  dispatchAutoInvoices(): Promise<Result<DispatchAutoInvoiceJobsResult, AppError>>;
  dispatchEmail(): void;
  emailDispatchSecret: string;
  emailDispatchCronSecret: string;
  autoInvoiceDispatchSecret: string;
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
  deploymentIdentity: DeploymentIdentity;
  tenantCreationMode: TenantCreationMode;
  ids: IdGenerator;
  clock: Clock;
  logger: { error(message: string): void };
  baseDomain: string;
  platformHost: string | null;
  singleTenantMode: boolean;
  appBaseUrl: string;
  devEndpoints: DevEndpoints;
  authConfig: AuthConfig;
  authTrustedProxyHeader: string | null;
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
  isProductionEnvironment(env) ? undefined : create();

export const selectTenantRouting = (
  env: Pick<Env, 'APP_BASE_DOMAIN' | 'APP_BASE_URL' | 'NODE_ENV' | 'APP_ENV' | 'TENANT_CREATION'>,
): {
  baseDomain: string;
  platformHost: string | null;
  singleTenantMode: boolean;
  tenantCreationMode: TenantCreationMode;
} => {
  const singleTenantMode = env.APP_BASE_DOMAIN === undefined;
  const creationMode = selectTenantCreationMode(env);
  return {
    baseDomain: env.APP_BASE_DOMAIN ?? new URL(env.APP_BASE_URL).hostname,
    platformHost: env.APP_BASE_DOMAIN === undefined ? null : `start.${env.APP_BASE_DOMAIN}`,
    singleTenantMode,
    tenantCreationMode: singleTenantMode && creationMode === 'open' ? 'closed' : creationMode,
  };
};

export const selectTenantCreationMode = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'TENANT_CREATION'>,
): TenantCreationMode => {
  if (env.TENANT_CREATION === 'closed') return 'closed';
  return isProductionEnvironment(env) ? 'bootstrap' : 'open';
};

export const createMultipleTenantsReporter = (
  write: (message: string) => void = (message) => { process.stderr.write(message); },
): (() => void) => {
  let reported = false;
  return () => {
    if (reported) return;
    reported = true;
    write('[tenant-routing] single-tenant mode found multiple tenants; set APP_BASE_DOMAIN to enable tenant routing\n');
  };
};

export const selectAuthTrustedProxyHeader = (
  env: Pick<Env, 'AUTH_TRUSTED_PROXY_HEADER'>,
): string | null => env.AUTH_TRUSTED_PROXY_HEADER === 'direct'
  ? null
  : env.AUTH_TRUSTED_PROXY_HEADER ?? null;

const httpsOrigin = (host: string | undefined): string | null => {
  if (host === undefined) return null;
  try {
    return new URL(`https://${host}`).origin;
  } catch {
    return null;
  }
};

/**
 * Preview and staging deployments answer on their own generated URL, which no
 * project-level APP_BASE_URL can name. Production trusts only its configured
 * origins.
 */
export const selectDeploymentAuthOrigins = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'VERCEL_URL' | 'VERCEL_BRANCH_URL'>,
): string[] => {
  if (isProductionEnvironment(env)) return [];
  const origins = [env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .map(httpsOrigin)
    .filter((origin): origin is string => origin !== null);
  return [...new Set(origins)];
};

export const selectTrustedAuthOrigins = (input: {
  appBaseUrl: string;
  baseDomain: string;
  port: number;
  singleTenantMode: boolean;
  customDomains: readonly string[];
}): string[] => {
  const subdomainSchemes = input.baseDomain === 'localhost'
    ? ['http', 'https'] as const
    : ['https'] as const;
  return [
    input.appBaseUrl,
    ...(input.singleTenantMode
      ? []
      : subdomainSchemes.flatMap((scheme) => [
          `${scheme}://*.${input.baseDomain}`,
          `${scheme}://*.${input.baseDomain}:${input.port}`,
        ])),
    ...input.customDomains.map((domain) => `https://${domain}`),
  ];
};

export const selectDeploymentIdentity = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'APP_COMMIT_SHA' | 'DATABASE_URL'>,
): DeploymentIdentity => {
  let hostname: string | null = null;
  try {
    hostname = new URL(env.DATABASE_URL).hostname || null;
  } catch {
    hostname = null;
  }
  return {
    environment: env.APP_ENV ?? 'unset',
    production: isProductionEnvironment(env),
    commit: env.APP_COMMIT_SHA ?? null,
    databaseFingerprint: hostname === null
      ? null
      : createHash('sha256').update(hostname).digest('hex').slice(0, 12),
  };
};

/**
 * Composition root — the ONLY place where env decides which adapters run.
 * Platform names (vercel, neon) may appear here and in adapters, never in core.
 */
export const createDeps = (env: Env, options: { clock?: Clock } = {}): AppDeps => {
  const { baseDomain, platformHost, singleTenantMode, tenantCreationMode } = selectTenantRouting(env);
  const db = createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const tenants = createTenantRepository(db, singleTenantMode
    ? {
        onMultipleTenants: createMultipleTenantsReporter(),
      }
    : undefined);
  const tenantAccess = createTenantAccessReader(db);
  const consents = createTermsConsentRepository(db);
  const tenantSecrets = createTenantSecretRepository(db);
  const ids = { nextId: () => randomUUID() };
  const clock = options.clock ?? { nowIso: () => new Date().toISOString() };
  const secretCrypto = createSecretCrypto(env.SECRETS_MASTER_KEY);
  const emailHmac = createEmailHmac(env.SECRETS_MASTER_KEY);
  const secretResolver = createTenantSecretResolver(tenantSecrets, secretCrypto);
  const invoiceRepository = createInvoiceRepository(db);
  const orderRepository = createOrderRepository(db);
  const autoInvoiceJobs = createAutoInvoiceJobRepository(db);
  const ksefCredentials = createKsefCredentialResolver(secretResolver);
  const ksefNumbers = createKsefNumberRepository(db);
  const fiscalArtifacts = createFiscalArtifactRepository(db);
  const ksefJobs = createKsefSubmissionJobRepository(db);
  const contentHash = createContentHash();
  const importUsers = createImportUsersRepository(db);
  const importUsersReader: ImportUsersReader = {
    findAuthUserByEmail: importUsers.findAuthUserByEmail,
    findMemberById: importUsers.findMemberById,
    findMemberByEmail: importUsers.findMemberByEmail,
    findGrantById: importUsers.findGrantById,
    findGrantByPair: importUsers.findGrantByPair,
    findProgressById: importUsers.findProgressById,
    findProgressByPair: importUsers.findProgressByPair,
  };
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
  const consentEvidenceRetention = createConsentEvidenceRetentionRepository(db);
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
  const production = isProductionEnvironment(env);
  const devSinkPurge = selectDevSinkPurge(env, () => createDevSinkPurge(db));
  const invoicing = production ? createIfirmaInvoicing() : createFakeInvoicing();
  const dispatchAutoInvoices = () => dispatchAutoInvoiceJobs({
    jobs: autoInvoiceJobs,
    invoices: invoiceRepository,
    invoicing,
    orderDetails: orderRepository,
    tenants,
    tenantSecrets,
    secretCrypto,
    ids,
    clock,
    ksef: {
      environment: env.KSEF_ENVIRONMENT,
      credentials: ksefCredentials,
      numbers: ksefNumbers,
      artifacts: fiscalArtifacts,
      hash: contentHash,
      validator: fa3Validator,
      pdf: ksefPdf,
      client: ksefClient,
    },
  });
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
  const resendTransactional = createResendTransactionalResolver(
    sesSettings,
    secretResolver,
    production ? createResendEmailPort : () => email,
  );
  const emailTransports = createEmailIntegrationTransportResolver({
    smtp: smtpTransactional,
    ses: tenantSesTransactional,
    resend: resendTransactional,
  });
  const transactionalEmail = createLayeredTransactionalEmailSender({
    transports: emailTransports,
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
        emailVerified: true,
        tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null,
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
    emailVerified: true,
    tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null,
  });
  const reputationDashboardUrl = (tenantSlug: string): string => {
    return tenantUrl(tenantSlug, '/panel/marketing', {
      appBaseUrl: env.APP_BASE_URL,
      baseDomain,
      singleTenantMode,
    });
  };
  const dispatchScheduledMarketing = async (trigger: 'cron' | 'dev' | 'manual') => {
    const now = clock.nowIso();
    const marketing = await runScheduledMarketingJobs({
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
    const purged = env.CONSENT_EVIDENCE_PURGE_ENABLED
      ? await purgeExpiredConsentEvidence(
          {
            trigger,
            minIntervalMs: CONSENT_EVIDENCE_PURGE_INTERVAL_MS,
            batchSize: CONSENT_EVIDENCE_PURGE_BATCH_SIZE,
            timeBudgetMs: CONSENT_EVIDENCE_PURGE_TIME_BUDGET_MS,
          },
          { retention: consentEvidenceRetention, runs: schedulerRuns, ids, clock },
        )
      : ok({ purged: 0, tenantsProcessed: 0 });
    if (!marketing.ok) return marketing;
    if (!purged.ok) return purged;
    return marketing;
  };
  const realtimeBus = createRealtimeBus();
  const routing = { appBaseUrl: env.APP_BASE_URL, baseDomain, singleTenantMode };
  const links: DiscussionLinkPort = {
    lessonDiscussionUrl: ({ tenantSlug, courseId, lessonId }) =>
      tenantUrl(tenantSlug, courseId === null ? '/my' : lessonPath(courseId, lessonId), routing),
    spaceUrl: ({ tenantSlug, spaceId, rootPostId }) =>
      tenantUrl(
        tenantSlug,
        rootPostId === undefined
          ? communitySpacePath(spaceId)
          : communityPostPath(spaceId, rootPostId),
        routing,
      ),
  };

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : null;

  const auth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    baseDomain,
    singleTenantMode,
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
        { tenantDomains, tenants, baseDomain, platformHost, singleTenantMode },
      );
      if (!resolved.ok) return resolved;
      if (resolved.value === null) return ok({ required: false });
      return validateTermsConsent(resolved.value.tenant.id, accepted, tenants);
    },
    recordSignUpConsent: async ({ request, email: signUpEmail }) => {
      const resolved = await resolveTenant(
        request.headers.get('host') ?? new URL(request.url).host,
        request.headers.get(TENANT_HEADER),
        { tenantDomains, tenants, baseDomain, platformHost, singleTenantMode },
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
      const configured = selectTrustedAuthOrigins({
        appBaseUrl: env.APP_BASE_URL,
        baseDomain,
        port: env.PORT,
        singleTenantMode,
        customDomains: domains.map((domain) => domain.domain),
      });
      return [...new Set([...configured, ...selectDeploymentAuthOrigins(env)])];
    },
  });

  return {
    auth,
    authPort: createAuthPort(auth),
    products: createProductRepository(db),
    courses: createCourseRepository(db),
    modules: createCourseModuleRepository(db),
    lessons: createCourseLessonRepository(db),
    attachments: createLessonAttachmentRepository(db),
    downloadAssets: createProductDownloadAssetRepository(db),
    entityVersions: createEntityVersionRepository(db),
    userDisplays: createUserDisplayReader(db),
    members: createMemberRepository(db),
    memberEvents: createMemberEventRepository(db),
    memberErasure: createMemberErasureRepository(db, emailHmac),
    erasureRequests: createMemberErasureRequestRepository(db),
    emailHmac,
    posts: createPostRepository(db),
    reports: createPostReportRepository(db),
    threadSubscriptions: createThreadSubscriptionRepository(db),
    spaces: createSpaceRepository(db),
    reactions: createPostReactionRepository(db),
    spaceSubscriptions: createSpaceSubscriptionRepository(db),
    spaceSeen: createSpaceSeenRepository(db),
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
    orders: orderRepository,
    orderDetails: orderRepository,
    paymentRefunds: createPaymentRefundRepository(db),
    subscriptions: createMemberSubscriptionRepository(db),
    processedPaymentEvents: createProcessedPaymentEventRepository(db),
    purchases: createPurchaseRepository(db),
    tenantApiKeys: createTenantApiKeyRepository(db),
    importAuditEvents: createImportAuditEventRepository(db),
    importContent: createImportContentRepository(db),
    importUsersReader,
    importUsers,
    contentHash,
    apiKeyRateLimits: createApiKeyRateLimitRepository(db),
    m2mTransactionalRateLimits: {
      perMinute: env.M2M_TRANSACTIONAL_EMAIL_RATE_PER_MINUTE,
      perDay: env.M2M_TRANSACTIONAL_EMAIL_RATE_PER_DAY,
    },
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
    bunnyTokenSigner: createBunnyTokenSigner(),
    playbackTokenTtlSeconds: env.PLAYBACK_TOKEN_TTL_SECONDS,
    storage: createS3StorageProvider(secretResolver, {
      corsOrigin: env.APP_BASE_URL,
      allowPrivateEndpoints: env.STORAGE_ALLOW_PRIVATE_ENDPOINTS,
    }),
    email,
    emailSender: transactionalEmail,
    emailTransports,
    emailOutbox,
    enrollmentTransaction: createEnrollmentTransactionPort(db),
    paymentTransaction: createPaymentTransactionPort(db),
    dispatchEmails,
    dispatchAutoInvoices,
    dispatchEmail,
    emailDispatchSecret: env.EMAIL_DISPATCH_SECRET,
    emailDispatchCronSecret: env.CRON_SECRET ?? env.EMAIL_DISPATCH_SECRET,
    autoInvoiceDispatchSecret: env.CRON_SECRET ?? env.EMAIL_DISPATCH_SECRET,
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
    deploymentIdentity: selectDeploymentIdentity(env),
    tenantCreationMode,
    ids,
    clock,
    logger,
    baseDomain,
    platformHost,
    singleTenantMode,
    appBaseUrl: env.APP_BASE_URL,
    devEndpoints: {
      simulatedPayments: env.SIMULATED_PAYMENTS,
      exposeMagicLinks: env.AUTH_DEV_EXPOSE_MAGIC_LINKS,
    },
    authConfig: { googleEnabled: google !== null },
    authTrustedProxyHeader: selectAuthTrustedProxyHeader(env),
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
