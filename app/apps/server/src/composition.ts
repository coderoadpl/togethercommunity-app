import { randomUUID } from 'node:crypto';

import { createDb } from '@adapters/db/client.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createDevEmailReader,
  createDevMagicLinkReader,
  createHealthPort,
  createMemberCourseProgressRepository,
  createMemberRepository,
  createPurchaseRepository,
  createProductGrantRepository,
  createProductRepository,
  createTenantAccessReader,
  createTenantApiKeyRepository,
  createTenantDomainRepository,
  createTenantRepository,
} from '@adapters/db/repositories.js';
import { createAuth, createAuthPort, type Auth } from '@adapters/auth/create-auth.js';
import { createApiKeyCrypto } from '@adapters/auth/api-key-crypto.js';
import { createDevEmailPort } from '@adapters/email/dev.js';
import { createSesEmailPort } from '@adapters/email/ses.js';
import type {
  ApiKeyCrypto,
  AuthPort,
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  DevEmailReader,
  EmailPort,
  DevMagicLinkReader,
  HealthPort,
  IdGenerator,
  MemberCourseProgressRepository,
  MemberRepository,
  PurchaseRepository,
  ProductGrantRepository,
  ProductRepository,
  TenantAccessReader,
  TenantApiKeyRepository,
  TenantDomainRepository,
  TenantRepository,
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
  auth: Pick<Auth, 'handler' | 'setMagicLinkDeliveryContext'>;
  authPort: AuthPort;
  products: ProductRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  members: MemberRepository;
  progress: MemberCourseProgressRepository;
  grants: ProductGrantRepository;
  purchases: PurchaseRepository;
  tenantApiKeys: TenantApiKeyRepository;
  apiKeyCrypto: ApiKeyCrypto;
  email: EmailPort;
  devEmails: DevEmailReader;
  devMagicLinks: DevMagicLinkReader;
  tenantDomains: TenantDomainRepository;
  tenants: TenantRepository;
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
  const email =
    env.EMAIL_PROVIDER === 'ses'
      ? createSesEmailPort({ from: env.EMAIL_FROM ?? '' })
      : createDevEmailPort(db);

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
    authPort: createAuthPort(auth, db),
    products: createProductRepository(db),
    courses: createCourseRepository(db),
    modules: createCourseModuleRepository(db),
    lessons: createCourseLessonRepository(db),
    members: createMemberRepository(db),
    progress: createMemberCourseProgressRepository(db),
    grants: createProductGrantRepository(db),
    purchases: createPurchaseRepository(db),
    tenantApiKeys: createTenantApiKeyRepository(db),
    apiKeyCrypto: createApiKeyCrypto(),
    email,
    devEmails: createDevEmailReader(db),
    devMagicLinks: createDevMagicLinkReader(db),
    tenantDomains,
    tenants: createTenantRepository(db),
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
