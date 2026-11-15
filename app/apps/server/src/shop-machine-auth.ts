import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { RouterRoute } from 'hono/types';
import { z } from 'zod';

import { API_KEY_HEADER, TENANT_HEADER } from '#core/contract/index.js';
import {
  err,
  notFound,
  ok,
  shopManagementKeyEventResourceId,
  tenantNotFound,
  unauthorized,
  unavailable,
  type AppError,
  type Result,
  type ShopManagementKeysSwitch,
  type ShopManagementScope,
  type Tenant,
} from '#core/domain/index.js';
import {
  authenticateShopManagementKey,
  identifyShopManagementKey,
  recordShopManagementKeyRequest,
  resolveTenant,
  type ResolveTenantDeps,
  type ShopMachineAuthDeps,
  type ShopMachineAuthentication,
  type ShopManagementKeyRequestDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { isSafeMethod, requestOriginPolicy } from './request-origin-policy.js';
import { respond } from './respond.js';
import { selfAuthenticatingRouteManifestEntry } from './self-authenticating-route-manifest.js';
import { recordException, type ApiKeyAttribution } from './telemetry.js';

export const SHOP_MACHINE_PATH_PREFIX = '/api/m2m/shop/';
const SHOP_MACHINE_MECHANISM = 'Shop management key';
const HISTORY_RETRY_AFTER_SECONDS = 5;

const isShopMachinePath = (path: string): boolean =>
  path === SHOP_MACHINE_PATH_PREFIX.slice(0, -1) || path.startsWith(SHOP_MACHINE_PATH_PREFIX);

export const shopManagementKeysSwitchMiddleware = (state: ShopManagementKeysSwitch): MiddlewareHandler<AppVars> =>
  async (c, next) => {
    if (state === 'disabled' && isShopMachinePath(c.req.path)) {
      c.set('apiKeyAttribution', { match: 'switch_off' });
      return respond(err(notFound('Shop management keys are disabled on this deployment')));
    }
    await next();
  };

type ShopMachineDeps = ShopMachineAuthDeps & ResolveTenantDeps & ShopManagementKeyRequestDeps;

type ShopMachineRequest = ShopMachineAuthentication & { tenant: Tenant };

export interface ShopMachineRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  scope: ShopManagementScope;
  resourceIdField?: string;
  resourceIdSchema?: z.ZodType<string>;
  handler: (c: Context<AppVars>, request: ShopMachineRequest) => Response | Promise<Response>;
}

interface ShopMachineAttempt {
  result: Result<ShopMachineRequest, AppError>;
  attribution: ApiKeyAttribution;
}

const resolveShopTenant = async (headers: Headers, deps: ShopMachineDeps): Promise<Result<Tenant, AppError>> => {
  const resolved = await resolveTenant(headers.get('host') ?? '', headers.get(TENANT_HEADER), deps);
  if (!resolved.ok) return resolved;
  return resolved.value === null ? err(tenantNotFound()) : ok(resolved.value.tenant);
};

const authenticateShopMachineRequest = async (
  headers: Headers,
  scope: ShopManagementScope,
  deps: ShopMachineDeps,
): Promise<ShopMachineAttempt> => {
  const key = headers.get(API_KEY_HEADER);
  const tenant = await resolveShopTenant(headers, deps);
  const unidentified: ApiKeyAttribution = { match: key === null ? 'missing' : 'none' };
  if (headers.has('cookie') || headers.has('authorization')) {
    return {
      result: err(unauthorized('Shop management requests must not carry a cookie or an Authorization header')),
      attribution: tenant.ok && key !== null
        ? { ...await identifyShopManagementKey(tenant.value.id, key, deps), tenantId: tenant.value.id }
        : unidentified,
    };
  }
  if (!tenant.ok) return { result: tenant, attribution: unidentified };
  if (key === null) return { result: err(unauthorized('Missing API key')), attribution: { match: 'missing', tenantId: tenant.value.id } };
  const { result, attribution } = await authenticateShopManagementKey(tenant.value, key, scope, deps);
  return {
    result: result.ok ? ok({ ...result.value, tenant: tenant.value }) : result,
    attribution: { ...attribution, tenantId: tenant.value.id },
  };
};

const retryAfterHeaders = (error: AppError): HeadersInit => {
  if (error.code !== 'rate_limited') return {};
  const seconds = Reflect.get(error.details ?? {}, 'retryAfterSeconds');
  return typeof seconds === 'number' ? { 'retry-after': String(seconds) } : {};
};

const requestBodySchema = z.record(z.string(), z.unknown());

const RESOURCE_ID_BODY_FIELDS = ['id', 'productId'] as const;

const pathParamNames = (path: string): string[] =>
  path.split('/').filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1));

const routeResourceId = (route: ShopMachineRoute, candidate: string | undefined): string | null => {
  if (candidate === undefined || (route.resourceIdSchema !== undefined && !route.resourceIdSchema.safeParse(candidate).success)) return null;
  return shopManagementKeyEventResourceId(candidate);
};

const resourceIdOf = async (c: Context<AppVars>, route: ShopMachineRoute, body: Request): Promise<string | null> => {
  const fromPath = pathParamNames(route.path).map((name) => c.req.param(name)).find((value) => value !== undefined && value.length > 0);
  if (fromPath !== undefined) return routeResourceId(route, fromPath);
  const parsed = requestBodySchema.safeParse(await body.json().catch(() => null));
  if (!parsed.success) return null;
  const fields = route.resourceIdField === undefined ? RESOURCE_ID_BODY_FIELDS : [route.resourceIdField];
  return routeResourceId(
    route,
    fields.map((field) => parsed.data[field]).find((value): value is string => typeof value === 'string' && value.length > 0),
  );
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
    const body = c.req.raw.clone();
    const { result, attribution } = await authenticateShopMachineRequest(c.req.raw.headers, route.scope, deps);
    c.set('apiKeyAttribution', attribution);
    if (!result.ok) return respond(result, { headers: retryAfterHeaders(result.error) });
    c.set('identity', result.value.ctx.identity);
    const { method } = route;
    if (method === 'GET') return route.handler(c, result.value);
    const recorded = await recordShopManagementKeyRequest(result.value.tenant.id, {
      apiKeyId: result.value.apiKey.id,
      actorUserId: result.value.ctx.identity.userId,
      method,
      route: route.path,
      resourceId: await resourceIdOf(c, route, body),
    }, deps).then(() => true, (error: unknown) => {
      recordException(error);
      return false;
    });
    if (!recorded) {
      return respond(
        err(unavailable('The shop management key history is unavailable; nothing was changed, retry the request')),
        { headers: { 'retry-after': String(HISTORY_RETRY_AFTER_SECONDS) } },
      );
    }
    return route.handler(c, result.value);
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
