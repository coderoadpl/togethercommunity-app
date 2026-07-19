import { randomUUID } from 'node:crypto';

import { createDb } from '@adapters/db/client.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createDevEmailReader,
  createDevMagicLinkReader,
  createEntityVersionRepository,
  createHealthPort,
  createMemberCourseProgressRepository,
  createMemberRepository,
  createMemberSubscriptionRepository,
  createNotificationRepository,
  createOrderRepository,
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
  createThreadSubscriptionRepository,
  createUserDisplayReader,
} from '@adapters/db/repositories.js';
import { createAuth, createAuthPort, type Auth } from '@adapters/auth/create-auth.js';
import { createApiKeyCrypto } from '@adapters/auth/api-key-crypto.js';
import { createSecretCrypto } from '@adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '@adapters/crypto/tenant-secret-resolver.js';
import { createStripePaymentProvider } from '@adapters/payment/stripe.js';
import { createFakePaymentProvider } from '@adapters/payment/fake.js';
import { createBunnyVideoLibrary } from '@adapters/video/bunny.js';
import { createDevEmailPort } from '@adapters/email/dev.js';
import { createEmailNotificationChannel } from '@adapters/notifications/email.js';
import { createInAppNotificationChannel, createRealtimeBus } from '@adapters/notifications/in-app.js';
import { createSesEmailPort } from '@adapters/email/ses.js';
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
  DevMagicLinkReader,
  HealthPort,
  IdGenerator,
  MemberCourseProgressRepository,
  MemberRepository,
  MemberSubscriptionRepository,
  NotificationChannelPort,
  NotificationRepository,
  OrderRepository,
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
  ThreadSubscriptionRepository,
  UserDisplayReader,
  VideoLibraryPort,
} from '@core/server/index.js';

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
  email: EmailPort;
  devEmails: DevEmailReader;
  devMagicLinks: DevMagicLinkReader;
  tenantDomains: TenantDomainRepository;
  tenants: TenantRepository;
  onboardingState: OnboardingStateRepository;
  tenantAccess: TenantAccessReader;
  health: HealthPort;
  ids: IdGenerator;
  clock: Clock;
  baseDomain: string;
  appBaseUrl: string;
  devEndpoints: DevEndpoints;
  authConfig: AuthConfig;
}

/**
 * Composition root — the ONLY place where env decides which adapters run.
 * Platform names (vercel, neon) may appear here and in adapters, never in core.
 */
export const createDeps = (env: Env): AppDeps => {
  const db = createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const tenantSecrets = createTenantSecretRepository(db);
  const secretCrypto = createSecretCrypto(env.SECRETS_MASTER_KEY);
  const secretResolver = createTenantSecretResolver(tenantSecrets, secretCrypto);
  const payment =
    env.PAYMENT_PROVIDER === 'stripe'
      ? createStripePaymentProvider({ resolver: secretResolver })
      : createFakePaymentProvider(secretResolver);
  const email =
    env.EMAIL_PROVIDER === 'ses'
      ? createSesEmailPort({ from: env.EMAIL_FROM ?? '' })
      : createDevEmailPort(db);
  const realtimeBus = createRealtimeBus();
  const tenantUrl = (tenantSlug: string | null, pathname: string): string => {
    const url = new URL(env.APP_BASE_URL);
    if (tenantSlug !== null) url.hostname = `${tenantSlug}.${env.APP_BASE_DOMAIN}`;
    url.pathname = pathname;
    return url.toString();
  };
  const links: DiscussionLinkPort = {
    lessonDiscussionUrl: ({ tenantSlug, courseId, lessonId }) =>
      tenantUrl(tenantSlug, courseId === null ? '/my' : `/my/courses/${courseId}/lessons/${lessonId}`),
    spaceUrl: ({ tenantSlug, spaceId }) => tenantUrl(tenantSlug, `/my/spaces/${spaceId}`),
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
    email,
    defaultTenantName: 'Together',
    google,
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
    posts: createPostRepository(db),
    threadSubscriptions: createThreadSubscriptionRepository(db),
    spaces: createSpaceRepository(db),
    reactions: createPostReactionRepository(db),
    spaceSubscriptions: createSpaceSubscriptionRepository(db),
    notifications: createNotificationRepository(db),
    notificationChannels: [
      createInAppNotificationChannel(realtimeBus),
      ...(env.NOTIFY_EMAIL ? [createEmailNotificationChannel(email)] : []),
    ],
    realtimeBus,
    links,
    progress: createMemberCourseProgressRepository(db),
    grants: createProductGrantRepository(db),
    prices: createProductPriceRepository(db),
    orders: createOrderRepository(db),
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
    email,
    devEmails: createDevEmailReader(db),
    devMagicLinks: createDevMagicLinkReader(db),
    tenantDomains,
    tenants: createTenantRepository(db),
    onboardingState: createOnboardingStateRepository(db),
    tenantAccess: createTenantAccessReader(db),
    health: createHealthPort(db),
    ids: { nextId: () => randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    baseDomain: env.APP_BASE_DOMAIN,
    appBaseUrl: env.APP_BASE_URL,
    devEndpoints: {
      simulatedPayments: env.SIMULATED_PAYMENTS,
      exposeMagicLinks: env.AUTH_DEV_EXPOSE_MAGIC_LINKS,
    },
    authConfig: { googleEnabled: google !== null },
  };
};
