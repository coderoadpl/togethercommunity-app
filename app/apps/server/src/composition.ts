import { randomUUID } from 'node:crypto';

import { createDb } from '@adapters/db/client.js';
import {
  createDevMagicLinkReader,
  createHealthPort,
  createMemberRepository,
  createProductGrantRepository,
  createProductRepository,
  createTenantAccessReader,
  createTenantDomainRepository,
  createTenantRepository,
} from '@adapters/db/repositories.js';
import { createAuth, createAuthPort, type Auth } from '@adapters/auth/create-auth.js';
import type {
  AuthPort,
  Clock,
  DevMagicLinkReader,
  HealthPort,
  IdGenerator,
  MemberRepository,
  ProductGrantRepository,
  ProductRepository,
  TenantAccessReader,
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
  auth: Pick<Auth, 'handler'>;
  authPort: AuthPort;
  products: ProductRepository;
  members: MemberRepository;
  grants: ProductGrantRepository;
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
    members: createMemberRepository(db),
    grants: createProductGrantRepository(db),
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
