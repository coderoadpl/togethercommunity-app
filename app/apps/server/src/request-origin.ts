import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { BETTER_AUTH_API_PATH_PATTERN } from '#adapters/auth/create-auth.js';
import { TENANT_HEADER } from '#core/contract/index.js';
import { err, forbidden } from '#core/domain/index.js';
import { customDomainOrigin, resolveTenant, tenantUrl } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { isSafeMethod, requestOriginPolicy } from './request-origin-policy.js';
import { respond } from './respond.js';

type OriginDeps = Pick<AppDeps,
  'appBaseUrl' | 'baseDomain' | 'platformHost' | 'singleTenantMode' |
  'tenantDomains' | 'tenants' | 'deploymentAuthOrigins' | 'developmentWebOrigin' | 'developmentCustomDomainPort'> & {
    authPort: Pick<AppDeps['authPort'], 'getAuthenticatedUser'>;
  };

const originSchema = z.string().url().regex(/^https?:\/\/[^/?#\\\s]+$/u)
  .transform((value) => new URL(value))
  .refine((url) => url.username === '' && url.password === '')
  .transform((url) => url.origin);

const hostSchema = z.string().regex(/^(?:[a-z0-9.-]+|\[[a-f0-9:.]+\])(?::[0-9]{1,5})?$/iu)
  .refine((host) => URL.canParse(`http://${host}`));
const fetchSiteSchema = z.enum(['same-origin', 'same-site', 'cross-site', 'none']);
const bearerSchema = z.string().regex(/^Bearer\s+\S+$/iu);

const platformOrigins = (deps: OriginDeps): Set<string> => {
  const origins = new Set([new URL(deps.appBaseUrl).origin]);
  if (deps.platformHost !== null) {
    const platform = new URL(deps.appBaseUrl);
    platform.hostname = deps.platformHost;
    origins.add(platform.origin);
  }
  return origins;
};

const isAccountPath = (path: string): boolean =>
  path === '/api/tenants' || [BETTER_AUTH_API_PATH_PATTERN.slice(0, -1), '/api/me/', '/api/impersonation/', '/api/platform/'].some((prefix) => path.startsWith(prefix));

const addDevelopmentOrigins = (origins: Set<string>, deps: OriginDeps): void => {
  if (deps.developmentWebOrigin === undefined) return;
  const api = new URL(deps.appBaseUrl);
  const web = new URL(deps.developmentWebOrigin);
  if (api.hostname !== 'localhost' || web.hostname !== 'localhost' || api.protocol !== 'http:' || web.protocol !== 'http:') return;
  for (const origin of [...origins]) {
    const url = new URL(origin);
    if (url.protocol !== api.protocol || url.port !== api.port || (url.hostname !== 'localhost' && !url.hostname.endsWith('.localhost'))) continue;
    url.port = web.port;
    origins.add(url.origin);
  }
};

const matchesRequestHost = (origin: string, host: string): boolean =>
  new URL(`${new URL(origin).protocol}//${host}`).origin === origin;

const allowedRequestOrigins = async (request: Request, deps: OriginDeps): Promise<{
  own: Set<string>;
  allowed: Set<string>;
} | null> => {
  const host = hostSchema.safeParse(request.headers.get('host') ?? new URL(request.url).host);
  if (!host.success) return null;
  const configured = platformOrigins(deps);
  for (const origin of deps.deploymentAuthOrigins) {
    if (matchesRequestHost(origin, host.data)) configured.add(origin);
  }
  const platformHosts = [...configured].map((origin) => new URL(origin).hostname);
  const hostname = new URL(`http://${host.data}`).hostname;
  const tenantHeader = isAccountPath(new URL(request.url).pathname) && platformHosts.includes(hostname)
    ? null : request.headers.get(TENANT_HEADER);
  const resolved = await resolveTenant(host.data, tenantHeader, deps);
  if (!resolved.ok) return null;
  const allowed = new Set(configured);
  const tenantOrigins = new Set<string>();
  if (resolved.value !== null) {
    const tenant = resolved.value.tenant;
    tenantOrigins.add(new URL(tenantUrl(tenant.slug, '/', deps)).origin);
    const domains = await deps.tenantDomains.listByTenant(tenant.id);
    for (const domain of domains) {
      if (domain.kind !== 'custom' || !domain.verified) continue;
      tenantOrigins.add(customDomainOrigin(domain.domain, deps));
      if (deps.developmentCustomDomainPort !== undefined) {
        tenantOrigins.add(new URL(`http://${domain.domain}:${deps.developmentCustomDomainPort}`).origin);
      }
    }
    for (const origin of tenantOrigins) allowed.add(origin);
  }
  addDevelopmentOrigins(allowed, deps);
  const own = new Set([...allowed].filter((origin) => matchesRequestHost(origin, host.data)));
  if (own.size === 0) return null;
  return { own, allowed };
};

export const isAllowedRequestOrigin = async (request: Request, deps: OriginDeps): Promise<boolean> => {
  const origins = await allowedRequestOrigins(request, deps);
  if (origins === null) return false;
  const rawSite = request.headers.get('sec-fetch-site');
  const site = rawSite === null ? null : fetchSiteSchema.safeParse(rawSite);
  if (site !== null && !site.success) return false;
  const rawOrigin = request.headers.get('origin');
  if (rawOrigin === null) return site?.data === 'same-origin';
  const origin = originSchema.safeParse(rawOrigin);
  if (!origin.success || !origins.allowed.has(origin.data)) return false;
  return site?.data !== 'same-origin' || origins.own.has(origin.data);
};

const useVerifiedBearer = async (request: Request, deps: OriginDeps): Promise<boolean> => {
  if (!bearerSchema.safeParse(request.headers.get('authorization')).success) return false;
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  if (await deps.authPort.getAuthenticatedUser(headers) === null) return false;
  // A verified explicit credential must not acquire cookie-derived authority downstream.
  request.headers.delete('cookie');
  return true;
};

export const requestOriginGuard = (deps: OriginDeps): MiddlewareHandler<AppVars> => async (c, next) => {
  if (isSafeMethod(c.req.method)) return next();
  const policy = requestOriginPolicy(c.req.method, c.req.path);
  if (['api-key', 'signature', 'secret', 'token', 'public'].includes(policy)) return next();
  if (policy !== 'auth' && await useVerifiedBearer(c.req.raw, deps)) return next();
  const hasMetadata = c.req.header('origin') !== undefined || c.req.header('sec-fetch-site') !== undefined;
  if (!hasMetadata && policy === 'development') return next();
  if (policy === 'session' || (policy === 'optional-session' && !hasMetadata)) {
    if (!c.req.raw.headers.has('cookie') && !c.req.raw.headers.has('authorization')) return next();
    if (await deps.authPort.getAuthenticatedUser(c.req.raw.headers) === null) return next();
  }
  if (!(await isAllowedRequestOrigin(c.req.raw, deps))) {
    return respond(err(forbidden('Request origin is not allowed')));
  }
  await next();
};
