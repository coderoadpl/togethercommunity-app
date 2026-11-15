import type { Context, Hono } from 'hono';
import type { RouterRoute } from 'hono/types';

import { API_KEY_HEADER, TENANT_HEADER } from '#core/contract/index.js';
import {
  err,
  ok,
  tenantNotFound,
  unauthorized,
  type AppError,
  type Result,
  type ShopManagementScope,
  type Tenant,
} from '#core/domain/index.js';
import {
  authenticateShopManagementKey,
  resolveTenant,
  type ResolveTenantDeps,
  type ShopMachineAuthDeps,
  type ShopMachineAuthentication,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { isSafeMethod, requestOriginPolicy } from './request-origin-policy.js';
import { respond } from './respond.js';
import { selfAuthenticatingRouteManifestEntry } from './self-authenticating-route-manifest.js';

export const SHOP_MACHINE_PATH_PREFIX = '/api/m2m/shop/';
const SHOP_MACHINE_MECHANISM = 'Shop management key';

type ShopMachineDeps = ShopMachineAuthDeps & ResolveTenantDeps;

type ShopMachineRequest = ShopMachineAuthentication & { tenant: Tenant };

export interface ShopMachineRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  scope: ShopManagementScope;
  handler: (c: Context<AppVars>, request: ShopMachineRequest) => Response | Promise<Response>;
}

const authenticateShopMachineRequest = async (
  headers: Headers,
  scope: ShopManagementScope,
  deps: ShopMachineDeps,
): Promise<Result<ShopMachineRequest, AppError>> => {
  if (headers.has('cookie') || headers.has('authorization')) {
    return err(unauthorized('Shop management requests must not carry a cookie or an Authorization header'));
  }
  const resolved = await resolveTenant(headers.get('host') ?? '', headers.get(TENANT_HEADER), deps);
  if (!resolved.ok) return resolved;
  if (resolved.value === null) return err(tenantNotFound());
  const key = headers.get(API_KEY_HEADER);
  if (key === null) return err(unauthorized('Missing API key'));
  const authenticated = await authenticateShopManagementKey(resolved.value.tenant, key, scope, deps);
  return authenticated.ok ? ok({ ...authenticated.value, tenant: resolved.value.tenant }) : authenticated;
};

const retryAfterHeaders = (error: AppError): HeadersInit => {
  if (error.code !== 'rate_limited') return {};
  const seconds = Reflect.get(error.details ?? {}, 'retryAfterSeconds');
  return typeof seconds === 'number' ? { 'retry-after': String(seconds) } : {};
};

export const registerShopMachineRoute = (
  app: Hono<AppVars>,
  deps: ShopMachineDeps,
  route: ShopMachineRoute,
): void => {
  if (!route.path.startsWith(SHOP_MACHINE_PATH_PREFIX)) {
    throw new Error(`Shop management routes must live under ${SHOP_MACHINE_PATH_PREFIX}: ${route.path}`);
  }
  app.on(route.method, route.path, async (c) => {
    const authenticated = await authenticateShopMachineRequest(c.req.raw.headers, route.scope, deps);
    if (!authenticated.ok) return respond(authenticated, { headers: retryAfterHeaders(authenticated.error) });
    c.set('identity', authenticated.value.ctx.identity);
    c.set('machineActor', authenticated.value.ctx.machineActor);
    return route.handler(c, authenticated.value);
  });
};

export const assertShopMachineRouteCoverage = (routes: readonly Pick<RouterRoute, 'method' | 'path'>[]): void => {
  const uncovered = routes.filter((route) =>
    selfAuthenticatingRouteManifestEntry(route)?.mechanism !== SHOP_MACHINE_MECHANISM
    || (!isSafeMethod(route.method) && requestOriginPolicy(route.method, route.path) !== 'api-key'));
  if (uncovered.length === 0) return;
  throw new Error(
    `Shop management routes need a "${SHOP_MACHINE_MECHANISM}" manifest entry and the api-key origin policy: ${uncovered.map((route) => `${route.method} ${route.path}`).join(', ')}`,
  );
};

export const registerShopMachineRoutes = (
  app: Hono<AppVars>,
  deps: ShopMachineDeps,
  routes: readonly ShopMachineRoute[],
): void => {
  assertShopMachineRouteCoverage(routes);
  for (const route of routes) registerShopMachineRoute(app, deps, route);
};
