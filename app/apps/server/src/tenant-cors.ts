import type { Env as HonoEnv, Hono } from 'hono';

import { TENANT_HEADER } from '#core/contract/index.js';
import type { TenantDomainRepository } from '#core/server/index.js';

export interface TenantCorsDeps {
  tenantDomains: TenantDomainRepository;
  baseDomain: string;
  platformHost: string | null;
  appBaseUrl: string;
}

const ALLOWED_HEADERS = `${TENANT_HEADER}, content-type`;
const MAX_AGE_SECONDS = '60';

const parseOrigin = (origin: string): URL | null => {
  try {
    const url = new URL(origin);
    return url.hostname === '' ? null : url;
  } catch {
    return null;
  }
};

const isBaseSubdomain = (hostname: string, baseDomain: string): boolean => {
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return false;
  return !hostname.slice(0, -suffix.length).includes('.');
};

export const isTenantScopedOrigin = async (
  origin: string,
  deps: TenantCorsDeps,
): Promise<boolean> => {
  const url = parseOrigin(origin);
  if (url === null) return false;
  const appUrl = new URL(deps.appBaseUrl);
  if (url.protocol !== 'https:' && url.protocol !== appUrl.protocol) return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === appUrl.hostname.toLowerCase()) return true;
  if (deps.platformHost !== null && hostname === deps.platformHost.toLowerCase()) return true;
  if (isBaseSubdomain(hostname, deps.baseDomain)) return true;
  const domain = await deps.tenantDomains.findByDomain(hostname);
  return domain !== null && domain.kind === 'custom' && domain.verified;
};

/**
 * Sign-in method discovery answers a per-identifier signal, so its response must
 * stay unreadable to pages the platform does not serve; the allow-list is the
 * tenant subdomain, its verified custom domains and the platform host.
 */
export const registerTenantScopedCors = <E extends HonoEnv>(
  app: Hono<E>,
  path: string,
  deps: TenantCorsDeps,
): void => {
  app.options(path, async (c) => {
    const origin = c.req.header('origin') ?? null;
    if (origin === null || !(await isTenantScopedOrigin(origin, deps))) {
      return new Response(null, { status: 403, headers: { vary: 'Origin' } });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': ALLOWED_HEADERS,
        'access-control-max-age': MAX_AGE_SECONDS,
        vary: 'Origin',
      },
    });
  });
  app.use(path, async (c, next) => {
    await next();
    c.res.headers.append('vary', 'Origin');
    const origin = c.req.header('origin') ?? null;
    if (origin === null || !(await isTenantScopedOrigin(origin, deps))) return;
    c.res.headers.set('access-control-allow-origin', origin);
  });
};
