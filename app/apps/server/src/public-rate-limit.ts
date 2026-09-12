import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';

import {
  BETTER_AUTH_EMAIL_VERIFICATION_PATH,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_SIGN_IN_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
  BETTER_AUTH_SIGN_UP_PATH,
} from '#adapters/auth/create-auth.js';
import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import { err, isProductionEnvironment, type AppError } from '#core/domain/index.js';
import {
  claimRateLimitWindow,
  resolveTenant,
  type Clock,
  type PublicRateLimitRepository,
  type RateLimitWindow,
  type ResolveTenantDeps,
} from '#core/server/index.js';

import { trustedClientIp } from './auth-network.js';
import { isPublicFormPath, isMarketingSignupSubmissionPath } from './body-limits.js';
import { type Env } from './env.js';
import { respond } from './respond.js';

export interface PublicRateLimitPolicies {
  writesPerIp: RateLimitWindow;
  writesPerTenant: RateLimitWindow;
  authLinksPerEmail: RateLimitWindow;
  signInPerIp: RateLimitWindow;
  signInPerEmail: RateLimitWindow;
  authResolvesPerIp: RateLimitWindow;
  authResolvesPerTenant: RateLimitWindow;
  deepHealthPerIp: RateLimitWindow;
  signupsPerIp: RateLimitWindow;
  signupsPerEmail: RateLimitWindow;
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
  signInPerIp: 60,
  signInPerEmail: 10,
  authResolvesPerIp: 60,
  authResolvesPerTenant: 1_000,
  deepHealthPerIp: 12,
  signupsPerIp: 10,
  signupsPerEmail: 3,
};
const DEVELOPMENT_LIMITS = {
  writesPerIp: 3_000,
  writesPerTenant: 30_000,
  authLinksPerEmail: 500,
  signInPerIp: 1_000,
  signInPerEmail: 1_000,
  authResolvesPerIp: 6_000,
  authResolvesPerTenant: 100_000,
  deepHealthPerIp: 1_200,
  signupsPerIp: 1_000,
  signupsPerEmail: 100,
};

export type PublicRateLimitEnv = Pick<
  Env,
  | 'PUBLIC_RATE_LIMIT_SIGN_IN_PER_IP_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_SIGN_IN_PER_EMAIL_PER_10_MINUTES'
  | 'NODE_ENV'
  | 'APP_ENV'
  | 'PUBLIC_RATE_LIMIT_WRITES_PER_IP_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_WRITES_PER_TENANT_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_AUTH_LINKS_PER_EMAIL_PER_10_MINUTES'
  | 'PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_IP_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_TENANT_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_DEEP_HEALTH_PER_IP_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_SIGNUPS_PER_IP_PER_MINUTE'
  | 'PUBLIC_RATE_LIMIT_SIGNUPS_PER_EMAIL_PER_10_MINUTES'
>;

export const selectPublicRateLimitPolicies = (env: PublicRateLimitEnv): PublicRateLimitPolicies => {
  const fallback = isProductionEnvironment(env) ? PRODUCTION_LIMITS : DEVELOPMENT_LIMITS;
  return {
    signupsPerIp: { limit: env.PUBLIC_RATE_LIMIT_SIGNUPS_PER_IP_PER_MINUTE ?? fallback.signupsPerIp, windowMs: MINUTE_MS },
    signupsPerEmail: { limit: env.PUBLIC_RATE_LIMIT_SIGNUPS_PER_EMAIL_PER_10_MINUTES ?? fallback.signupsPerEmail, windowMs: TEN_MINUTES_MS },
    signInPerIp: {
      limit: env.PUBLIC_RATE_LIMIT_SIGN_IN_PER_IP_PER_MINUTE ?? fallback.signInPerIp,
      windowMs: MINUTE_MS,
    },
    signInPerEmail: {
      limit: env.PUBLIC_RATE_LIMIT_SIGN_IN_PER_EMAIL_PER_10_MINUTES ?? fallback.signInPerEmail,
      windowMs: TEN_MINUTES_MS,
    },
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
    deepHealthPerIp: {
      limit: env.PUBLIC_RATE_LIMIT_DEEP_HEALTH_PER_IP_PER_MINUTE ?? fallback.deepHealthPerIp,
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

const emailBodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

const isPublicWritePath = (path: string): boolean =>
  path === API_PATHS.checkoutSession
  || path === API_PATHS.couponCheckoutValidation
  || isPublicFormPath(path);

type PublicRateLimitKind = 'auth-password' | 'auth-link' | 'auth-resolve' | 'write';

const publicRateLimitKind = (path: string): PublicRateLimitKind | null => {
  if (path === BETTER_AUTH_PASSWORD_SIGN_IN_PATH) return 'auth-password';
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
    const body = await c.req.raw.clone().text();
    payload = c.req.header('content-type')?.toLowerCase().trim().startsWith('application/x-www-form-urlencoded') === true ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = emailBodySchema.safeParse(payload);
  return parsed.success ? parsed.data.email : null;
};

const rateLimitedResponse = (error: AppError): Response => {
  const seconds = Reflect.get(error.details ?? {}, 'retryAfterSeconds');
  return respond(err(error), {
    headers: typeof seconds === 'number' ? { 'retry-after': String(seconds) } : {},
  });
};

const enforcePublicRateLimit = async (c: Context, deps: PublicRateLimitMiddlewareDeps): Promise<Response | null> => {
  const limiter = { buckets: deps.rateLimitBuckets, clock: deps.clock };
  const policies = deps.publicRateLimitPolicies;
  const clientIp = (): string =>
    trustedClientIp(c, deps.authTrustedProxyHeader) ?? UNATTRIBUTED_IP_KEY;
  if (c.req.method === 'GET') {
    if (c.req.path !== API_PATHS.healthDeep) return null;
    const claimed = await claimRateLimitWindow(
      { scope: 'deep-health:ip', key: clientIp(), window: policies.deepHealthPerIp },
      limiter,
    );
    return claimed.ok ? null : rateLimitedResponse(claimed.error);
  }
  if (c.req.method !== 'POST') return null;
  if (isMarketingSignupSubmissionPath(c.req.path)) {
    const ip = await claimRateLimitWindow({ scope: 'signup:ip', key: clientIp(), window: policies.signupsPerIp }, limiter);
    if (!ip.ok) return rateLimitedResponse(ip.error);
    const tenant = await resolveTenant(c.req.header('host') ?? '', null, deps);
    const email = await requestEmail(c);
    if (!tenant.ok || tenant.value === null || email === null) return null;
    const key = createHash('sha256').update(`${tenant.value.tenant.id}:${email}`).digest('hex');
    const claimed = await claimRateLimitWindow({ scope: 'signup:email', key, window: policies.signupsPerEmail }, limiter);
    return claimed.ok ? null : rateLimitedResponse(claimed.error);
  }
  const kind = publicRateLimitKind(c.req.path);
  if (kind === null) return null;
  const buckets = bucketsFor(kind, policies);
  const signInPath = c.req.path === API_PATHS.authResolve || c.req.path === BETTER_AUTH_MAGIC_LINK_PATH || c.req.path === BETTER_AUTH_PASSWORD_SIGN_IN_PATH;
  if (signInPath) {
    const scope = c.req.path === API_PATHS.authResolve ? 'methods' : c.req.path === BETTER_AUTH_MAGIC_LINK_PATH ? 'magic-link' : 'password';
    const ipClaim = await claimRateLimitWindow({ scope: `sign-in:${scope}:ip`, key: clientIp(), window: policies.signInPerIp }, limiter);
    if (!ipClaim.ok) return rateLimitedResponse(ipClaim.error);
    const email = await requestEmail(c);
    if (email !== null && kind !== 'auth-link') {
      const key = createHash('sha256').update(email).digest('hex');
      const emailClaim = await claimRateLimitWindow({ scope: `sign-in:${scope}:email`, key, window: policies.signInPerEmail }, limiter);
      if (!emailClaim.ok) return rateLimitedResponse(emailClaim.error);
    }
  }
  if (kind === 'auth-password') return null;
  const perIp = await claimRateLimitWindow({ ...buckets.ip, key: clientIp() }, limiter);
  if (!perIp.ok) return rateLimitedResponse(perIp.error);
  if (kind === 'auth-link') {
    const email = await requestEmail(c);
    if (email === null) return null;
    const claimed = await claimRateLimitWindow(
      { scope: 'auth-link:email', key: createHash('sha256').update(email).digest('hex'), window: policies.authLinksPerEmail },
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
