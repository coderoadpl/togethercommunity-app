import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';

import {
  BETTER_AUTH_EMAIL_VERIFICATION_PATH,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
  BETTER_AUTH_SIGN_UP_PATH,
} from '#adapters/auth/create-auth.js';
import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import { err, type AppError } from '#core/domain/index.js';
import {
  claimRateLimitWindow,
  resolveTenant,
  type Clock,
  type PublicRateLimitRepository,
  type RateLimitWindow,
  type ResolveTenantDeps,
} from '#core/server/index.js';

import { trustedClientIp } from './auth-network.js';
import { isPublicFormPath } from './body-limits.js';
import { isProductionEnvironment, type Env } from './env.js';
import { respond } from './respond.js';

export interface PublicRateLimitPolicies {
  writesPerIp: RateLimitWindow;
  writesPerTenant: RateLimitWindow;
  authLinksPerEmail: RateLimitWindow;
  authResolvesPerIp: RateLimitWindow;
  authResolvesPerTenant: RateLimitWindow;
}

export interface PublicRateLimitMiddlewareDeps extends ResolveTenantDeps {
  rateLimitBuckets: PublicRateLimitRepository;
  publicRateLimitPolicies: PublicRateLimitPolicies;
  authTrustedProxyHeader: string | null;
  clock: Clock;
}

const MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * MINUTE_MS;

const PRODUCTION_LIMITS = {
  writesPerIp: 30,
  writesPerTenant: 300,
  authLinksPerEmail: 5,
  authResolvesPerIp: 20,
  authResolvesPerTenant: 200,
};
const DEVELOPMENT_LIMITS = {
  writesPerIp: 3_000,
  writesPerTenant: 30_000,
  authLinksPerEmail: 500,
  authResolvesPerIp: 2_000,
  authResolvesPerTenant: 20_000,
};

export type PublicRateLimitEnv = Pick<
  Env,
  | 'NODE_ENV'
  | 'APP_ENV'
  | 'PUBLIC_RATE_LIMIT_WRITES_PER_IP_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_WRITES_PER_TENANT_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_AUTH_LINKS_PER_EMAIL_PER_10_MINUTES'
  | 'PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_IP_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_TENANT_PER_MINUTE'
>;

export const selectPublicRateLimitPolicies = (env: PublicRateLimitEnv): PublicRateLimitPolicies => {
  const fallback = isProductionEnvironment(env) ? PRODUCTION_LIMITS : DEVELOPMENT_LIMITS;
  return {
    writesPerIp: {
      limit: env.PUBLIC_RATE_LIMIT_WRITES_PER_IP_PER_MINUTE ?? fallback.writesPerIp,
      windowMs: MINUTE_MS,
    },
    writesPerTenant: {
      limit: env.PUBLIC_RATE_LIMIT_WRITES_PER_TENANT_PER_MINUTE ?? fallback.writesPerTenant,
      windowMs: MINUTE_MS,
    },
    authLinksPerEmail: {
      limit: env.PUBLIC_RATE_LIMIT_AUTH_LINKS_PER_EMAIL_PER_10_MINUTES ?? fallback.authLinksPerEmail,
      windowMs: TEN_MINUTES_MS,
    },
    authResolvesPerIp: {
      limit: env.PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_IP_PER_MINUTE ?? fallback.authResolvesPerIp,
      windowMs: MINUTE_MS,
    },
    authResolvesPerTenant: {
      limit: env.PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_TENANT_PER_MINUTE ?? fallback.authResolvesPerTenant,
      windowMs: MINUTE_MS,
    },
  };
};

const AUTH_LINK_PATHS = new Set<string>([
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
  BETTER_AUTH_SIGN_UP_PATH,
  BETTER_AUTH_EMAIL_VERIFICATION_PATH,
]);

const UNATTRIBUTED_IP_KEY = 'unattributed';

const emailBodySchema = z.object({ email: z.string().email().max(254) });

const isPublicWritePath = (path: string): boolean =>
  path === API_PATHS.checkoutSession
  || path === API_PATHS.couponCheckoutValidation
  || isPublicFormPath(path);

type PublicRateLimitKind = 'auth-link' | 'auth-resolve' | 'write';

const publicRateLimitKind = (path: string): PublicRateLimitKind | null => {
  if (AUTH_LINK_PATHS.has(path)) return 'auth-link';
  if (path === API_PATHS.authResolve) return 'auth-resolve';
  return isPublicWritePath(path) ? 'write' : null;
};

const bucketsFor = (kind: PublicRateLimitKind, policies: PublicRateLimitPolicies) =>
  kind === 'auth-resolve'
    ? {
        ip: { scope: 'auth-resolve:ip', window: policies.authResolvesPerIp },
        tenant: { scope: 'auth-resolve:tenant', window: policies.authResolvesPerTenant },
      }
    : {
        ip: { scope: 'public-write:ip', window: policies.writesPerIp },
        tenant: { scope: 'public-write:tenant', window: policies.writesPerTenant },
      };

const requestEmail = async (c: Context): Promise<string | null> => {
  let payload: unknown = null;
  try {
    payload = JSON.parse(await c.req.raw.clone().text());
  } catch {
    return null;
  }
  const parsed = emailBodySchema.safeParse(payload);
  return parsed.success ? parsed.data.email.trim().toLowerCase() : null;
};

const rateLimitedResponse = (error: AppError): Response => {
  const seconds = Reflect.get(error.details ?? {}, 'retryAfterSeconds');
  return respond(err(error), {
    headers: typeof seconds === 'number' ? { 'retry-after': String(seconds) } : {},
  });
};

const enforcePublicRateLimit = async (c: Context, deps: PublicRateLimitMiddlewareDeps): Promise<Response | null> => {
  if (c.req.method !== 'POST') return null;
  const kind = publicRateLimitKind(c.req.path);
  if (kind === null) return null;
  const limiter = { buckets: deps.rateLimitBuckets, clock: deps.clock };
  const policies = deps.publicRateLimitPolicies;
  const buckets = bucketsFor(kind, policies);
  const perIp = await claimRateLimitWindow(
    {
      ...buckets.ip,
      key: trustedClientIp(c, deps.authTrustedProxyHeader) ?? UNATTRIBUTED_IP_KEY,
    },
    limiter,
  );
  if (!perIp.ok) return rateLimitedResponse(perIp.error);
  if (kind === 'auth-link') {
    const email = await requestEmail(c);
    if (email === null) return null;
    const claimed = await claimRateLimitWindow(
      { scope: 'auth-link:email', key: email, window: policies.authLinksPerEmail },
      limiter,
    );
    return claimed.ok ? null : rateLimitedResponse(claimed.error);
  }
  const tenant = await resolveTenant(
    c.req.header('host') ?? '',
    c.req.header(TENANT_HEADER) ?? null,
    deps,
  );
  if (!tenant.ok || tenant.value === null) return null;
  const perTenant = await claimRateLimitWindow(
    { ...buckets.tenant, key: tenant.value.tenant.id },
    limiter,
  );
  return perTenant.ok ? null : rateLimitedResponse(perTenant.error);
};

export const publicRateLimitMiddleware = (deps: PublicRateLimitMiddlewareDeps): MiddlewareHandler =>
  async (c, next) => {
    const limited = await enforcePublicRateLimit(c, deps);
    if (limited !== null) return limited;
    await next();
  };
