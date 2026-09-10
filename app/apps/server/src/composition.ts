import { createMarketingContactAudienceRepository } from '#adapters/db/marketing-contact-audience.js';
import { createMarketingContactCampaignTransaction } from '#adapters/db/marketing-contact-campaign-transactions.js';
import type { MarketingContactAudienceDeps } from '#core/server/index.js';
import { createMarketingDeliveryRepos, createMarketingDeliveryTransaction } from '#adapters/db/marketing-delivery-transactions.js';
import { createMarketingWaiter } from '#adapters/scheduler/marketing-waiter.js';
import { processMarketingSnsInbox } from '#core/server/index.js';
import { dispatchMarketingOutbox } from '#core/server/index.js';
import type { MarketingDeliveryTransaction, MarketingOutboxRepository, MarketingSnsInboxRepository, MarketingWaiter } from '#core/server/index.js';
import { createHtmlToText } from '#adapters/email/html-to-text.js';
import type { HtmlToText } from '#core/server/index.js';
import { createMarketingImportTransaction, createMarketingImportTransactionRepos } from '#adapters/db/marketing-contact-transactions.js';
import { createMarketingDirectoryJobs } from '#adapters/db/marketing-contact-import-repository.js';
import type { MarketingContactDeps, MarketingDirectoryJobs } from '#core/server/index.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { createDb, type Db } from '#adapters/db/client.js';
import { createAutoInvoiceJobRepository } from '#adapters/db/auto-invoice-jobs.js';
import { createEmailOutboxRepository, createEnrollmentTransactionPort, createPlatformTransactionalPool } from '#adapters/db/email-outbox.js';
import { createEmailEventRepository } from '#adapters/db/email-events.js';
import { createPaymentTransactionPort } from '#adapters/db/payment-transaction.js';
import { createMemberErasureRequestRepository } from '#adapters/db/member-erasure-requests.js';
import { createMemberEventRepository } from '#adapters/db/member-events.js';
import { createImportAuditEventRepository } from '#adapters/db/import-audit-events.js';
import {
  createImpersonationSessionRepository,
  createTenantAuditEventRepository,
} from '#adapters/db/impersonation.js';
import { createImpersonationTokenCodec } from '#adapters/crypto/impersonation-token-codec.js';
import { createImportContentRepository } from '#adapters/db/content-import.js';
import { createTenantRedirectRepository } from '#adapters/db/redirects.js';
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
  createSnsWebhookDeliveryRepository,
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
import { createNotificationFanoutJobRepository } from '#adapters/db/notification-fanout-jobs.js';
import { createPlatformAuditRepository } from '#adapters/db/platform-audit.js';
import { reseedMarkers } from '#adapters/db/reseed-guard.js';
import { runReseed } from '#adapters/db/reseed-run.js';
import { runSmokeTenantReseed } from '#adapters/db/smoke-tenant-reseed.js';
import {
  createAvatarSourceReader,
  createAccountAvatarRepository,
  createAccountAvatarTenantReader,
  createAccountSecurityReader,
  createCourseLessonRepository,
  createLessonAttachmentRepository,
  createProductDownloadAssetRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createCheckoutConsentCaptureRepository,
  createDevEmailReader,
  createDevMagicLinkReader,
  createDevSinkPurge,
  createDmConversationRepository,
  createDmConversationStateRepository,
  createDmMessageRepository,
  createDmReportRepository,
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
  createMemberBlockRepository,
  createPostReportRepository,
  createPostRepository,
  createSpaceEventRepository,
  createSpaceEventRsvpRepository,
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
  createPublicRateLimitRepository,
  createTenantDirectory,
  createTenantDomainEventRepository,
  createTenantDomainRepository,
  createTenantRepository,
  createTenantSecretRepository,
  createTenantSecretScan,
  createTermsConsentRepository,
  createThreadSubscriptionRepository,
  createUserDisplayReader,
} from '#adapters/db/repositories.js';
import { createAuth, createAuthPort, type Auth } from '#adapters/auth/create-auth.js';
import { createApiKeyCrypto } from '#adapters/auth/api-key-crypto.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { databaseHostFingerprint } from '#adapters/crypto/database-fingerprint.js';
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
import { createManualDomainProvisioner } from '#adapters/domains/manual.js';
import { createVercelDomainProvisioner } from '#adapters/domains/vercel.js';
import { createBunnyTokenSigner } from '#adapters/crypto/bunny-token-signer.js';
import { createS3StorageProvider } from '#adapters/storage/s3.js';
import { createAvatarImageProcessor } from '#adapters/storage/avatar-images.js';
import { createStorageCorsCache } from '#adapters/storage/cors-cache.js';
import { createDevEmailPort } from '#adapters/email/dev.js';
import { createSinkEmailPort } from '#adapters/email/sink.js';
import { createEmailNotificationChannel } from '#adapters/notifications/email.js';
import { createInAppNotificationChannel } from '#adapters/notifications/in-app.js';
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
  AccountSecurityReader,
  AppErrorTelemetry,
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
  StorageCorsCache,
  BunnyTokenSigner,
  HealthPort,
  IdGenerator,
  TokenGenerator,
  ImpersonationSessionRepository,
  ImpersonationTokenCodec,
  TenantAuditEventRepository,
  ImportAuditEventRepository,
  ImportRedirectRepository,
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
  DmConversationRepository,
  DmConversationStateRepository,
  DmReportRepository,
  MemberBlockRepository,
  DmMessageRepository,
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
  NotificationFanoutJobRepository,
  NotificationRepository,
  OrderRepository,
  OrderDetailRepository,
  PaymentRefundRepository,
  PostRepository,
  PlatformAuditRepository,
  PlatformDataResetPort,
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
  SpaceEventRepository,
  SpaceEventRsvpRepository,
  SpaceRepository,
  SpaceSeenRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  TenantApiKeyRepository,
  ApiKeyRateLimitRepository,
  PublicRateLimitRepository,
  DomainProvisioner,
  TenantDirectory,
  TenantDomainEventRepository,
  TenantDomainRepository,
  TenantRepository,
  TermsConsentRepository,
  SchedulerPort,
  SchedulerRunRepository,
  SesMarketingSender,
  SesMarketingQuotaReader,
  SesOnboardingControlPlane,
  SnsVerifier,
  SnsWebhookDeliveryRepository,
  SuppressionRepository,
  TenantDocumentRepository,
  TenantSesSettingsRepository,
  TransactionalEmailSender,
  UnsubscribeTokenRepository,
  ThreadSubscriptionRepository,
  UserDisplayReader,
  AccountAvatarRepository,
  AvatarImageProcessor,
  AvatarSourceReader,
  VideoLibraryPort,
} from '#core/server/index.js';
import { campaignTick, CONSENT_EVIDENCE_PURGE_BATCH_SIZE, CONSENT_EVIDENCE_PURGE_INTERVAL_MS, CONSENT_EVIDENCE_PURGE_TIME_BUDGET_MS, createLayeredTransactionalEmailSender, createSesWebhookBaseUrlResolver, createTenantOriginResolver, createSmokeTenantSilencedCredentials, dispatchAutoInvoiceJobs, dispatchEmailBatch, dispatchKsefJob, drainNotificationFanoutJobs, enforceTermsConsent, importGoogleAvatar, marketingRetentionCutoff, purgeExpiredConsentEvidence, refreshSesIdentity, resolveTenant, runMarketingRetentionJobs, runReputationAlerts, runScheduledMarketingJobs, runTenantDomainChecks, type SmokeTenantReseedDeps, type SanitizeStagingSecretsDeps, SES_IDENTITY_REFRESH_INTERVAL_MS, sweepLapsedImpersonations, resolveTenantOrigin, validateTermsConsent, type DispatchAutoInvoiceJobsResult, type DispatchEmailBatchResult, type NotificationFanoutDrainResult, type TenantDomainCheckResult } from '#core/server/index.js';
import {
  DEMO_SEED_PASSWORD,
  isProductionEnvironment,
  err,
  ok,
  parsePlatformOwnerEmails,
  resettableEnvironment,
  resolveSmokeTenantPasswords,
  targetsProductionData,
  type AppError,
  type KsefEnvironment,
  type ResettableEnvironment,
  type SmokeTenantPasswords,
  type Result,
  type TenantCreationMode,
} from '#core/domain/index.js';
import { capabilitiesForPrincipal, communityEventPath, communityPostPath, communitySpacePath, conversationPath, lessonPath, TENANT_HEADER } from '#core/contract/index.js';

import { createCoalescedRunner } from './coalesced-runner.js';
import { recordAppError } from './telemetry.js';
import { type Env, isLocalDevelopmentEnvironment } from './env.js';
import { selectPublicRateLimitPolicies, type PublicRateLimitPolicies } from './public-rate-limit.js';
import { createRealtimeTransport } from './realtime-transport.js';
import { APP_VERSION } from './version.js';

interface DevEndpoints {
  simulatedPayments: boolean;
  exposeMagicLinks: boolean;
}

interface AuthConfig {
  googleEnabled: boolean;
  googleClientId?: string | null;
}

/**
 * Present only on disposable deployments. Production composes `undefined`, so
 * the reset route is never registered and answers 404 for every caller.
 */
export interface PlatformResetAppDeps {
  environment: ResettableEnvironment;
  ownerEmails: readonly string[];
  productionDatabaseFingerprint: string | null;
  dataReset: PlatformDataResetPort;
  audit: PlatformAuditRepository;
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
  telemetry: AppErrorTelemetry;
  auth: Pick<
    Auth,
    | 'handler'
    | 'setMagicLinkDeliveryContext'
    | 'clearMagicLinkDeliveryContext'
    | 'setResetPasswordDeliveryContext'
    | 'clearResetPasswordDeliveryContext'
    | 'setEmailVerificationDeliveryContext'
    | 'clearEmailVerificationDeliveryContext'
  >;
  authPort: AuthPort;
  products: ProductRepository & ProductBatchReader & ProductMetadataRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  redirects: ImportRedirectRepository;
  attachments: LessonAttachmentRepository;
  downloadAssets: ProductDownloadAssetRepository;
  entityVersions: EntityVersionRepository;
  userDisplays: UserDisplayReader;
  avatarSources: AvatarSourceReader;
  accountAvatars: AccountAvatarRepository;
  avatarImages: AvatarImageProcessor;
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
  events: SpaceEventRepository;
  eventRsvps: SpaceEventRsvpRepository;
  dmConversations: DmConversationRepository;
  dmMessages: DmMessageRepository;
  dmConversationStates: DmConversationStateRepository;
  dmReports: DmReportRepository;
  memberBlocks: MemberBlockRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  fanoutJobs: NotificationFanoutJobRepository;
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
  impersonations: ImpersonationSessionRepository;
  auditEvents: TenantAuditEventRepository;
  impersonationTokens: ImpersonationTokenCodec;
  secureCookies: boolean;
  importAuditEvents: ImportAuditEventRepository;
  importContent: ImportContentRepository;
  importUsersReader: ImportUsersReader;
  importUsers: ImportUsersRepository;
  contentHash: ContentHash;
  apiKeyRateLimits: ApiKeyRateLimitRepository;
  importDailyMemberRecordLimit: number;
  importDailyRecordLimit: number;
  rateLimitBuckets: PublicRateLimitRepository;
  publicRateLimitPolicies: PublicRateLimitPolicies;
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
  storageCorsCache: StorageCorsCache;
  bunnyTokenSigner: BunnyTokenSigner;
  playbackTokenTtlSeconds: number;
  email: EmailPort;
  emailSender: TransactionalEmailSender;
  emailTransports: EmailIntegrationTransportResolver;
  emailOutbox: EmailOutboxRepository;
  enrollmentTransaction: EnrollmentTransactionPort;
  paymentTransaction: PaymentTransactionPort;
  dispatchEmails(trigger: 'cron' | 'dev' | 'manual'): Promise<Result<DispatchEmailBatchResult, AppError>>;
  drainNotificationFanout(): Promise<Result<NotificationFanoutDrainResult, AppError>>;
  dispatchAutoInvoices(): Promise<Result<DispatchAutoInvoiceJobsResult, AppError>>;
  dispatchEmail(): void;
  emailDispatchSecret: string;
  emailDispatchCronSecret: string;
  autoInvoiceDispatchSecret: string;
  domainCheckSecret: string;
  operatorSecret: string;
  smokeTenantReseed?: SmokeTenantReseedDeps;
  sanitizeStagingSecrets: SanitizeStagingSecretsDeps;
  checkTenantDomains(): Promise<Result<TenantDomainCheckResult, AppError>>;
  devEmails: DevEmailReader;
  devMagicLinks: DevMagicLinkReader;
  devSinkPurge?: DevSinkPurge;
  tenantDomains: TenantDomainRepository;
  tenantDomainEvents: TenantDomainEventRepository;
  domainProvisioner: DomainProvisioner;
  tenants: TenantRepository;
  tenantDirectory: TenantDirectory;
  consents: TermsConsentRepository;
  onboardingState: OnboardingStateRepository;
  tenantAccess: TenantAccessReader;
  signInTelemetrySecret: string;
  accountSecurity: AccountSecurityReader;
  health: HealthPort;
  appVersion: string;
  commitSha: string;
  deploymentIdentity: DeploymentIdentity;
  tenantCreationMode: TenantCreationMode;
  consentTokens: TokenGenerator;
  ids: IdGenerator;
  clock: Clock;
  logger: { error(message: string): void; warn(message: string): void };
  baseDomain: string;
  platformHost: string | null;
  singleTenantMode: boolean;
  appBaseUrl: string;
  customDomainTarget: string;
  customDomainApexARecord?: string | undefined;
  devEndpoints: DevEndpoints;
  platformReset?: PlatformResetAppDeps;
  authConfig: AuthConfig;
  authTrustedProxyHeader: string | null;
  marketing?: MarketingAppDeps;
  marketingContacts?: MarketingContactDeps;
  marketingDirectoryJobs?: MarketingDirectoryJobs;
  marketingImportCronSecret?: string | undefined;
}

export interface MarketingAppDeps {
  contactAudienceDeps?: MarketingContactAudienceDeps | undefined;
  htmlToText: HtmlToText;
  delivery: MarketingDeliveryTransaction;
  marketingOutbox: MarketingOutboxRepository;
  snsInbox: MarketingSnsInboxRepository;
  waiter: MarketingWaiter;
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
  snsDeliveries: SnsWebhookDeliveryRepository;
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

export const selectDevEndpoints = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'SIMULATED_PAYMENTS' | 'AUTH_DEV_EXPOSE_MAGIC_LINKS'>,
): DevEndpoints =>
  isLocalDevelopmentEnvironment(env)
    ? {
      simulatedPayments: env.SIMULATED_PAYMENTS,
      exposeMagicLinks: env.AUTH_DEV_EXPOSE_MAGIC_LINKS,
    }
    : { simulatedPayments: false, exposeMagicLinks: false };

export const selectPlatformReset = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'PLATFORM_OWNER_EMAILS' | 'PRODUCTION_DATABASE_FINGERPRINT'>,
  create: () => Pick<PlatformResetAppDeps, 'dataReset' | 'audit'>,
): PlatformResetAppDeps | undefined => {
  const environment = resettableEnvironment(env.APP_ENV);
  if (environment === null || isProductionEnvironment(env)) return undefined;
  return {
    environment,
    ownerEmails: parsePlatformOwnerEmails(env.PLATFORM_OWNER_EMAILS),
    productionDatabaseFingerprint: env.PRODUCTION_DATABASE_FINGERPRINT ?? null,
    ...create(),
  };
};

export const selectSmokeTenantReseed = (
  env: Pick<
    Env,
    | 'NODE_ENV'
    | 'APP_ENV'
    | 'SMOKE_MEMBER_PASSWORD'
    | 'SMOKE_CREATOR_PASSWORD'
    | 'DATABASE_URL'
    | 'PRODUCTION_DATABASE_FINGERPRINT'
  >,
  create: (passwords: SmokeTenantPasswords) => Omit<SmokeTenantReseedDeps, 'environment'>,
): SmokeTenantReseedDeps | undefined => {
  const resolved = resolveSmokeTenantPasswords({
    production: targetsProductionData(reseedMarkers(env)),
    demoPassword: DEMO_SEED_PASSWORD,
    configured: { member: env.SMOKE_MEMBER_PASSWORD, creator: env.SMOKE_CREATOR_PASSWORD },
  });
  if (!resolved.ok) return undefined;
  return {
    ...create(resolved.passwords),
    environment: env.APP_ENV ?? env.NODE_ENV ?? 'development',
  };
};

export const selectOperatorSecret = (
  env: Pick<
    Env,
    | 'OPERATOR_SECRET'
    | 'PROD_OPERATOR_SECRET'
    | 'STAGING_OPERATOR_SECRET'
    | 'CRON_SECRET'
    | 'EMAIL_DISPATCH_SECRET'
  >,
): string =>
  env.OPERATOR_SECRET
  ?? env.PROD_OPERATOR_SECRET
  ?? env.STAGING_OPERATOR_SECRET
  ?? env.CRON_SECRET
  ?? env.EMAIL_DISPATCH_SECRET;

export const selectDevSinkPurge = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV'>,
  create: () => DevSinkPurge,
): DevSinkPurge | undefined =>
  isProductionEnvironment(env) ? undefined : create();

export const selectDomainProvisioner = (
  env: Pick<
    Env,
    | 'DOMAIN_PROVISIONER_TOKEN'
    | 'DOMAIN_PROVISIONER_PROJECT_ID'
    | 'DOMAIN_PROVISIONER_TEAM_ID'
    | 'DOMAIN_PROVISIONER_GIT_BRANCH'
  >,
): DomainProvisioner =>
  env.DOMAIN_PROVISIONER_TOKEN === undefined || env.DOMAIN_PROVISIONER_PROJECT_ID === undefined
    ? createManualDomainProvisioner()
    : createVercelDomainProvisioner({
        token: env.DOMAIN_PROVISIONER_TOKEN,
        projectId: env.DOMAIN_PROVISIONER_PROJECT_ID,
        teamId: env.DOMAIN_PROVISIONER_TEAM_ID,
        gitBranch: env.DOMAIN_PROVISIONER_GIT_BRANCH,
      });

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
  const local = input.baseDomain === 'localhost';
  const subdomainSchemes = local ? ['http', 'https'] as const : ['https'] as const;
  return [
    input.appBaseUrl,
    ...(input.singleTenantMode
      ? []
      : subdomainSchemes.flatMap((scheme) => [
          `${scheme}://*.${input.baseDomain}`,
          `${scheme}://*.${input.baseDomain}:${input.port}`,
        ])),
    ...input.customDomains.flatMap((domain) => [
      `https://${domain}`,
      ...(local ? [`http://${domain}:${input.port}`] : []),
    ]),
  ];
};

const VERIFIED_CUSTOM_HOST_TTL_MS = 5_000;

const VERIFIED_CUSTOM_HOST_MAX_ENTRIES = 512;

/**
 * Every authenticated API call dispatches through Better Auth, which re-checks the
 * request host, so an uncached check doubles the `tenant_domains` lookups a custom
 * domain pays per request. The window stays short enough that verifying or
 * unverifying a domain still takes effect without a deploy.
 */
export const memoizeHostCheck = (
  check: (host: string) => Promise<boolean>,
  options: { ttlMs?: number; now?: () => number } = {},
): ((host: string) => Promise<boolean>) => {
  const ttlMs = options.ttlMs ?? VERIFIED_CUSTOM_HOST_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { verified: boolean; expiresAt: number }>();
  return async (host) => {
    const at = now();
    const cached = entries.get(host);
    if (cached !== undefined && cached.expiresAt > at) return cached.verified;
    const verified = await check(host);
    entries.delete(host);
    while (entries.size >= VERIFIED_CUSTOM_HOST_MAX_ENTRIES) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
    entries.set(host, { verified, expiresAt: at + ttlMs });
    return verified;
  };
};

export const selectDeploymentIdentity = (
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'APP_COMMIT_SHA' | 'DATABASE_URL'>,
): DeploymentIdentity => ({
  environment: env.APP_ENV ?? 'unset',
  production: isProductionEnvironment(env),
  commit: env.APP_COMMIT_SHA ?? null,
  databaseFingerprint: databaseHostFingerprint(env.DATABASE_URL),
});

/**
 * Composition root — the ONLY place where env decides which adapters run.
 * Platform names (vercel, neon) may appear here and in adapters, never in core.
 */
export const createDeps = (env: Env, options: { clock?: Clock; db?: Db } = {}): AppDeps => {
  const { baseDomain, platformHost, singleTenantMode, tenantCreationMode } = selectTenantRouting(env);
  const db = options.db ?? createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const storageCorsCache = createStorageCorsCache(db);
  const tenantDomainEvents = createTenantDomainEventRepository(db);
  const domainProvisioner = selectDomainProvisioner(env);
  const customDomainTarget =
    env.APP_CUSTOM_DOMAIN_TARGET ?? platformHost ?? new URL(env.APP_BASE_URL).hostname;
  const notificationRepository = createNotificationRepository(db);
  const publicRateLimitBuckets = createPublicRateLimitRepository(db);
  const tenants = createTenantRepository(db, singleTenantMode
    ? {
        onMultipleTenants: createMultipleTenantsReporter(),
      }
    : undefined);
  const tenantAccess = createTenantAccessReader(db);
  const accountSecurity = createAccountSecurityReader(db);
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
  const impersonations = createImpersonationSessionRepository(db);
  const auditEvents = createTenantAuditEventRepository(db);
  const consentEvidenceRetention = createConsentEvidenceRetentionRepository(db);
  const definitions = createConsentDefinitionRepository(db);
  const marketingConsents = createMarketingConsentRepository(db);
  const confirmations = createConsentConfirmationTokenRepository(db);
  const campaigns = createCampaignRepository(db);
  const layouts = createEmailLayoutRepository(db);
  const campaignSends = createCampaignSendRepository(db);
  const directoryDeps = { ids, clock, hmac: emailHmac, contentHash: { sha256: (value: string) => createHash('sha256').update(value).digest('hex') } };
  const marketingContacts = { ...createMarketingImportTransactionRepos(db, directoryDeps), transaction: createMarketingImportTransaction(db, directoryDeps), ...directoryDeps };
  const contactAudienceDeps = { contactAudience: createMarketingContactAudienceRepository(db, directoryDeps), contactCampaigns: createMarketingContactCampaignTransaction(db, directoryDeps), directory: marketingContacts, clock };
  const audience = createMarketingAudienceRepository(db);
  const suppressions = createSuppressionRepository(db);
  const unsubscribes = createUnsubscribeTokenRepository(db);
  const sesSettings = createTenantSesSettingsRepository(db);
  const snsDeliveries = createSnsWebhookDeliveryRepository(db);
  const documents = createTenantDocumentRepository(db);
  const idempotency = createAutomationIdempotencyRepository(db);
  const marketingJobs = createMarketingJobRepository(db);
  const sesOnboardingControlPlane = createSesOnboardingControlPlane();
  const resolveOrigin = createTenantOriginResolver({
    tenants, tenantDomains, appBaseUrl: env.APP_BASE_URL, baseDomain, singleTenantMode,
  });
  const unsubscribeBaseUrl = async (tenantId: string): Promise<string> => `${await resolveOrigin(tenantId)}/u`;
  const sesWebhookBaseUrl = createSesWebhookBaseUrlResolver({
    tenants,
    tenantDomains,
    routing: { appBaseUrl: env.APP_BASE_URL, baseDomain, singleTenantMode },
  });
  const delivery = createMarketingDeliveryTransaction(db);
  const deliveryRepos = createMarketingDeliveryRepos(db);
  const waiter = createMarketingWaiter();
  const marketingThrottle = createMarketingThrottleRepository(db);
  const production = isProductionEnvironment(env);
  const writeLog = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const logger = { error: writeLog, warn: writeLog };
  const devEndpoints = selectDevEndpoints(env);
  const devSinkPurge = selectDevSinkPurge(env, () => createDevSinkPurge(db));
  const platformReset = selectPlatformReset(env, () => ({
    dataReset: { run: () => runReseed(db, reseedMarkers(env)) },
    audit: createPlatformAuditRepository(db),
  }));
  const smokeTenantReseed = selectSmokeTenantReseed(env, (passwords) => ({
    reseed: { run: () => runSmokeTenantReseed(db, { passwords, nowIso: clock.nowIso }) },
    platformAudit: createPlatformAuditRepository(db),
    ids,
    clock,
  }));
  const sanitizeStagingSecrets: SanitizeStagingSecretsDeps = {
    ...reseedMarkers(env),
    secrets: createTenantSecretScan(db),
    secretCrypto,
    platformAudit: createPlatformAuditRepository(db),
    environment: env.APP_ENV ?? env.NODE_ENV ?? 'development',
    ids,
    clock,
  };
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
    ...(production ? { smokeTenantSink: createSinkEmailPort(writeLog) } : {}),
  });
  const marketingCredentials: MarketingSesCredentialResolver = production
    ? createSmokeTenantSilencedCredentials(tenantMarketingCredentials)
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
  const dispatchEmail = createCoalescedRunner(async () => {
    const result = await dispatchEmails('dev');
    if (!result.ok) process.stderr.write(`[email-outbox] opportunistic dispatch failed: ${result.error.message}\n`);
  });
  const refreshMarketingQuota = async (tenantId: string) => {
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
  };
  const dispatchCampaign = async (tenantId: string, campaignId: string, trigger: 'cron' | 'dev' | 'manual', deadlineAt = new Date(Date.parse(clock.nowIso()) + env.MARKETING_SEND_SECONDS * 1000).toISOString()) => {
    await refreshMarketingQuota(tenantId);
    return campaignTick({
      identity: {
        userId: 'marketing-worker', email: 'worker@together.invalid', name: 'Marketing worker',
        emailVerified: true, image: null,
        tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null,
        memberDmOptOutAt: null,
        memberLanguage: null,
        memberVideoAutoplay: false,
      },
      capabilities: capabilitiesForPrincipal('operator-secret'),
    }, { campaignId, workerId: randomUUID(), tickSeconds: Math.max(0, Math.min(env.MARKETING_SEND_SECONDS, (Date.parse(deadlineAt) - Date.parse(clock.nowIso())) / 1000)), trigger }, {
      contactAudience: contactAudienceDeps.contactAudience, contacts: marketingContacts.contacts,
      definitions, consents: marketingConsents, campaigns, layouts, sends: campaignSends, events: emailEvents, audience,
      suppressions, unsubscribes, sesSettings, ses: marketingSes, credentials: marketingCredentials,
      marketingOutbox: deliveryRepos.marketingOutbox, snsInbox: deliveryRepos.snsInbox, delivery, waiter,
      htmlToText: createHtmlToText(), batchCap: env.MARKETING_BATCH_CAP,
      quotaReader, throttle: marketingThrottle, hmac: emailHmac, tenants, ids, tokens, clock,
      unsubscribeBaseUrl, outbox: emailOutbox, scheduler, runs: schedulerRuns,
      ...(production ? { silenceSmokeTenant: true } : {}),
    });
  };
  devScheduler?.setCampaignHandler(async (tenantId, campaignId) => {
    const result = await dispatchCampaign(tenantId, campaignId, 'dev');
    if (!result.ok) process.stderr.write(`[marketing] campaign tick failed: ${result.error.message}\n`);
  });
  const workerIdentity = (tenantId: string) => ({
    userId: 'marketing-worker', email: 'worker@together.invalid', name: 'Marketing worker',
    emailVerified: true, image: null,
    tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null,
    memberDmOptOutAt: null,
    memberLanguage: null,
    memberVideoAutoplay: false,
  });
  const reputationDashboardUrl = async (tenantId: string): Promise<string> =>
    `${await resolveOrigin(tenantId)}/panel/marketing`;
  const dispatchScheduledMarketing = async (trigger: 'cron' | 'dev' | 'manual') => {
    let firstError: AppError | null = null;
    const now = clock.nowIso();
    const deadlineAt = new Date(Date.parse(now) + env.MARKETING_WORKER_SECONDS * 1000).toISOString();
    const inboxDeadline = new Date(Math.min(Date.parse(deadlineAt), Date.parse(now) + 5000)).toISOString();
    for (const tenantId of await deliveryRepos.snsInbox.listTenantIds()) {
      if (clock.nowIso() >= inboxDeadline) break;
      const inbox = await processMarketingSnsInbox({ identity: workerIdentity(tenantId), capabilities: capabilitiesForPrincipal('webhook') },
        { workerId: randomUUID(), deadlineAt: inboxDeadline, maxEvents: 100 },
        { ...deliveryRepos, delivery, clock, ids, hmac: emailHmac, sns, credentials: marketingCredentials });
      if (!inbox.ok) firstError ??= inbox.error;
    }
    const marketing = await runScheduledMarketingJobs({
      now,
      pendingOlderThan: marketingRetentionCutoff(now, env.MARKETING_RETENTION_PENDING_CONSENTS_DAYS),
      renderedBodiesOlderThan: marketingRetentionCutoff(now, env.MARKETING_RETENTION_RENDERED_BODIES_DAYS),
      engagementOlderThan: marketingRetentionCutoff(now, env.MARKETING_RETENTION_ENGAGEMENT_EVENTS_DAYS),
      rawSnsInboxOlderThan: marketingRetentionCutoff(now, env.MARKETING_RETENTION_RAW_SNS_INBOX_DAYS),
      schedulerRunsOlderThan: marketingRetentionCutoff(now, env.MARKETING_RETENTION_SCHEDULER_RUNS_DAYS),
      schedulerIdleRunsOlderThan: marketingRetentionCutoff(now, env.MARKETING_RETENTION_SCHEDULER_IDLE_RUNS_DAYS),
      sesIdentityRefreshIntervalMs: SES_IDENTITY_REFRESH_INTERVAL_MS,
      shouldContinue: () => Date.parse(clock.nowIso()) + 1000 < Date.parse(deadlineAt),
      maintenanceIntervalMs: 30 * 60 * 1000,
      trigger,
    }, {
      jobs: marketingJobs,
      runs: schedulerRuns,
      ids,
      clock,
      logger,
      dispatchCampaign: (tenantId, campaignId) => dispatchCampaign(tenantId, campaignId, trigger, deadlineAt),
      runRetention: (tenantId, input) => runMarketingRetentionJobs({
        identity: workerIdentity(tenantId),
        capabilities: capabilitiesForPrincipal('operator-secret'),
      }, input, {
        definitions, consents: marketingConsents, sends: campaignSends, events: emailEvents, idempotency, clock, marketingOutbox: deliveryRepos.marketingOutbox, snsInbox: deliveryRepos.snsInbox,
      }),
      refreshIdentity: (tenantId) =>
        refreshSesIdentity(
          { identity: workerIdentity(tenantId) },
          {
            settings: sesSettings,
            credentials: tenantMarketingCredentials,
            controlPlane: sesOnboardingControlPlane,
            clock,
            webhookBaseUrl: sesWebhookBaseUrl,
            logger,
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
    if (!marketing.ok) firstError ??= marketing.error;
    for (const tenantId of await deliveryRepos.marketingOutbox.listTenantIds()) {
      if (Date.parse(clock.nowIso()) + 1000 >= Date.parse(deadlineAt)) break;
      await refreshMarketingQuota(tenantId);
      const dispatched = await dispatchMarketingOutbox({ identity: workerIdentity(tenantId), capabilities: capabilitiesForPrincipal('operator-secret') },
        { workerId: randomUUID(), deadlineAt, maxSends: env.MARKETING_BATCH_CAP }, {
          ...deliveryRepos, contacts: marketingContacts.contacts, delivery, clock, ids, waiter, definitions, consents: marketingConsents, hmac: emailHmac, credentials: marketingCredentials, throttle: marketingThrottle, ses: marketingSes,
        });
      if (!dispatched.ok) firstError ??= dispatched.error;
    }
    const purged = env.CONSENT_EVIDENCE_PURGE_ENABLED && clock.nowIso() < deadlineAt
      ? await purgeExpiredConsentEvidence(
          {
            trigger,
            minIntervalMs: CONSENT_EVIDENCE_PURGE_INTERVAL_MS,
            batchSize: CONSENT_EVIDENCE_PURGE_BATCH_SIZE,
            timeBudgetMs: Math.min(CONSENT_EVIDENCE_PURGE_TIME_BUDGET_MS, Math.max(1, Date.parse(deadlineAt) - Date.parse(clock.nowIso()))),
          },
          { retention: consentEvidenceRetention, runs: schedulerRuns, ids, clock },
        )
      : ok({ purged: 0, tenantsProcessed: 0 });
    const sweptViews = clock.nowIso() < deadlineAt ? await sweepLapsedImpersonations({ impersonations, ids, clock }) : ok(undefined);
    if (firstError !== null) return err(firstError);
    if (!purged.ok) return purged;
    if (!sweptViews.ok) return sweptViews;
    return marketing;
  };
  const realtimeBus = createRealtimeTransport({ env, db, logger });
  const routing = { appBaseUrl: env.APP_BASE_URL, baseDomain, singleTenantMode };
  const memberLink = async (tenantId: string, tenantSlug: string | null, path: string): Promise<string> =>
    new URL(path, await resolveTenantOrigin({ id: tenantId, slug: tenantSlug }, { ...routing, tenantDomains })).toString();
  const links: DiscussionLinkPort = {
    lessonDiscussionUrl: ({ tenantId, tenantSlug, courseId, lessonId }) =>
      memberLink(tenantId, tenantSlug, courseId === null ? '/my' : lessonPath(courseId, lessonId)),
    spaceUrl: ({ tenantId, tenantSlug, spaceId, rootPostId }) =>
      memberLink(tenantId, tenantSlug, rootPostId === undefined ? communitySpacePath(spaceId) : communityPostPath(spaceId, rootPostId)),
    conversationUrl: ({ tenantId, tenantSlug, conversationId }) =>
      memberLink(tenantId, tenantSlug, conversationPath(conversationId)),
    eventUrl: ({ tenantId, tenantSlug, spaceId, eventId }) =>
      memberLink(tenantId, tenantSlug, communityEventPath(spaceId, eventId)),
  };

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : null;

  const storage = createS3StorageProvider(secretResolver, {
    corsOrigin: env.APP_BASE_URL,
    allowPrivateEndpoints: env.STORAGE_ALLOW_PRIVATE_ENDPOINTS,
  });
  const tenantDomainDeps = {
    tenantDomains,
    domainEvents: tenantDomainEvents,
    provisioner: domainProvisioner,
    rateLimit: publicRateLimitBuckets,
    notifications: notificationRepository,
    tenantAccess,
    realtimeBus,
    ids,
    clock,
    storage,
    secretResolver,
    storageCorsCache,
    logger,
    routing,
    customDomainTarget,
    customDomainApexARecord: env.DOMAIN_PROVISIONER_APEX_A_RECORD,
  };
  const accountAvatars = createAccountAvatarRepository(db);
  const accountAvatarTenants = createAccountAvatarTenantReader(db);
  const avatarImages = createAvatarImageProcessor(storage);

  const auth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    baseDomain,
    singleTenantMode,
    secureCookies: env.SECURE_COOKIES,
    exposeMagicLinks: devEndpoints.exposeMagicLinks,
    emailOutbox,
    ids,
    clock,
    dispatchEmail,
    defaultTenantName: 'Together',
    google,
    importGoogleAvatar: async ({ userId, sourceUrl }) => {
      const tenantIds = await accountAvatarTenants.listTenantIdsForUser(userId);
      await Promise.all(tenantIds.map((tenantId) => importGoogleAvatar(
        { tenantId, userId, sourceUrl },
        { avatars: accountAvatars, avatarImages, ids, secretResolver, storage },
      )));
    },
    isVerifiedCustomHost: memoizeHostCheck(async (host) =>
      (await tenantDomains.findByDomain(host))?.kind === 'custom'),
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

  const deps: AppDeps = {
    telemetry: { recordAppError },
    auth,
    authPort: createAuthPort(auth),
    products: createProductRepository(db),
    courses: createCourseRepository(db),
    modules: createCourseModuleRepository(db),
    lessons: createCourseLessonRepository(db),
    redirects: createTenantRedirectRepository(db),
    attachments: createLessonAttachmentRepository(db),
    downloadAssets: createProductDownloadAssetRepository(db),
    entityVersions: createEntityVersionRepository(db),
    userDisplays: createUserDisplayReader(db),
    avatarSources: createAvatarSourceReader(db),
    accountAvatars,
    avatarImages,
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
    events: createSpaceEventRepository(db),
    eventRsvps: createSpaceEventRsvpRepository(db),
    dmConversations: createDmConversationRepository(db),
    dmMessages: createDmMessageRepository(db),
    dmConversationStates: createDmConversationStateRepository(db),
    dmReports: createDmReportRepository(db),
    memberBlocks: createMemberBlockRepository(db),
    notifications: notificationRepository,
    fanoutJobs: createNotificationFanoutJobRepository(db),
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
    impersonations,
    auditEvents,
    impersonationTokens: createImpersonationTokenCodec(env.BETTER_AUTH_SECRET),
    secureCookies: env.SECURE_COOKIES,
    importAuditEvents: createImportAuditEventRepository(db),
    importContent: createImportContentRepository(db),
    importUsersReader,
    importUsers,
    contentHash,
    apiKeyRateLimits: createApiKeyRateLimitRepository(db),
    importDailyMemberRecordLimit: env.IMPORT_DAILY_MEMBER_RECORD_LIMIT,
    importDailyRecordLimit: env.IMPORT_DAILY_RECORD_LIMIT,
    rateLimitBuckets: publicRateLimitBuckets,
    publicRateLimitPolicies: selectPublicRateLimitPolicies(env),
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
    storage,
    storageCorsCache,
    email,
    emailSender: transactionalEmail,
    emailTransports,
    emailOutbox,
    enrollmentTransaction: createEnrollmentTransactionPort(db),
    paymentTransaction: createPaymentTransactionPort(db),
    consentTokens: { nextToken: () => randomUUID().replaceAll('-', '') },
    dispatchEmails,
    drainNotificationFanout: async () => drainNotificationFanoutJobs(deps),
    dispatchAutoInvoices,
    dispatchEmail,
    emailDispatchSecret: env.EMAIL_DISPATCH_SECRET,
    emailDispatchCronSecret: env.CRON_SECRET ?? env.EMAIL_DISPATCH_SECRET,
    autoInvoiceDispatchSecret: env.CRON_SECRET ?? env.EMAIL_DISPATCH_SECRET,
    domainCheckSecret: env.CRON_SECRET ?? env.EMAIL_DISPATCH_SECRET,
    operatorSecret: selectOperatorSecret(env),
    ...(smokeTenantReseed === undefined ? {} : { smokeTenantReseed }),
    sanitizeStagingSecrets,
    checkTenantDomains: () => runTenantDomainChecks(tenantDomainDeps),
    devEmails: createDevEmailReader(db),
    devMagicLinks: createDevMagicLinkReader(db),
    ...(devSinkPurge === undefined ? {} : { devSinkPurge }),
    tenantDomains,
    tenantDomainEvents,
    domainProvisioner,
    tenants,
    tenantDirectory: createTenantDirectory(db, production),
    consents,
    onboardingState: createOnboardingStateRepository(db),
    tenantAccess,
    signInTelemetrySecret: env.BETTER_AUTH_SECRET,
    accountSecurity,
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
    customDomainTarget,
    customDomainApexARecord: env.DOMAIN_PROVISIONER_APEX_A_RECORD,
    devEndpoints,
    ...(platformReset === undefined ? {} : { platformReset }),
    authConfig: { googleEnabled: google !== null, googleClientId: google?.clientId ?? null },
    authTrustedProxyHeader: selectAuthTrustedProxyHeader(env),
    marketingContacts,
    marketingDirectoryJobs: createMarketingDirectoryJobs(db),
    marketingImportCronSecret: env.CRON_SECRET,
    marketing: {
      contactAudienceDeps,
      marketingOutbox: deliveryRepos.marketingOutbox, snsInbox: deliveryRepos.snsInbox, delivery, waiter,
      htmlToText: createHtmlToText(),
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
      snsDeliveries,
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
  return deps;
};
