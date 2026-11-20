import type { Context, Hono } from 'hono';

import {
  API_KEY_HEADER,
  API_PATHS,
  apiKeysEntitlementCreateInputSchema,
  apiKeysShopManagementRevokeInputSchema,
  entitlementContracts,
  TENANT_HEADER,
} from '#core/contract/index.js';
import { err, ok, tenantNotFound, unauthorized, unavailable, validation, type AppError, type Result, type Tenant } from '#core/domain/index.js';
import {
  authenticateEntitlementKey,
  checkEntitlements,
  claimEntitlementKeyRateLimit,
  createEntitlementKey,
  listEntitlementKeys,
  recordShopManagementKeyRequest,
  resolveTenant,
  revokeEntitlementKey,
  type EntitlementCheckDeps,
  type EntitlementKeyAuthDeps,
  type EntitlementKeyDeps,
  type ResolveTenantDeps,
  type ShopManagementKeyRequestDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond, retryAfterHeaders } from './respond.js';
import { recordException } from './telemetry.js';

const HISTORY_RETRY_AFTER_SECONDS = 5;

type EntitlementRouteDeps = EntitlementKeyAuthDeps & EntitlementCheckDeps & EntitlementKeyDeps & ResolveTenantDeps & ShopManagementKeyRequestDeps;

const resolveRequestTenant = async (headers: Headers, deps: ResolveTenantDeps): Promise<Result<Tenant, AppError>> => {
  const resolved = await resolveTenant(headers.get('host') ?? '', headers.get(TENANT_HEADER), deps);
  if (!resolved.ok) return resolved;
  return resolved.value === null ? err(tenantNotFound()) : ok(resolved.value.tenant);
};

const subjectCount = (body: unknown): number => {
  const parsed = entitlementContracts.checkEntitlements.input.safeParse(body);
  return parsed.success ? parsed.data.subjects.length : 1;
};

const checkRoute = async (c: Context<AppVars>, deps: EntitlementRouteDeps): Promise<Response> => {
  const headers = c.req.raw.headers;
  if (headers.has('cookie') || headers.has('authorization')) {
    c.set('apiKeyAttribution', { match: 'mixed_credentials' });
    return respond(err(unauthorized('Entitlement checks must not carry a cookie or an Authorization header')));
  }
  const key = headers.get(API_KEY_HEADER);
  const tenant = await resolveRequestTenant(headers, deps);
  if (!tenant.ok) {
    c.set('apiKeyAttribution', { match: key === null ? 'missing' : 'none' });
    return respond(tenant);
  }
  if (key === null) {
    c.set('apiKeyAttribution', { match: 'missing', tenantId: tenant.value.id });
    return respond(err(unauthorized('Missing API key')));
  }
  const { result, attribution } = await authenticateEntitlementKey(tenant.value, key, deps);
  c.set('apiKeyAttribution', { ...attribution, tenantId: tenant.value.id });
  if (!result.ok) return respond(result);
  c.set('identity', result.value.ctx.identity);
  const body = await readJson(c.req.raw);
  const limited = await claimEntitlementKeyRateLimit(result.value.apiKey.id, tenant.value.id, subjectCount(body), deps);
  if (!limited.ok) return respond(limited, { headers: retryAfterHeaders(limited.error) });
  const recorded = await recordShopManagementKeyRequest(tenant.value.id, {
    apiKeyId: result.value.apiKey.id,
    actorUserId: result.value.ctx.identity.userId,
    method: 'POST',
    route: API_PATHS.m2mEntitlementCheck,
    resourceId: null,
  }, deps).then(() => true, (error: unknown) => {
    recordException(error);
    return false;
  });
  if (!recorded) {
    await limited.value();
    return respond(
      err(unavailable('The key history is unavailable; nothing was checked, retry the request')),
      { headers: { 'retry-after': String(HISTORY_RETRY_AFTER_SECONDS) } },
    );
  }
  return respond(await checkEntitlements(result.value.ctx, body, { productIds: result.value.apiKey.productIds }, deps));
};

export const registerEntitlementCheckRoute = (app: Hono<AppVars>, deps: EntitlementRouteDeps): void => {
  app.post(API_PATHS.m2mEntitlementCheck, (c) => checkRoute(c, deps));
};

export const registerEntitlementKeyRoutes = (app: Hono<AppVars>, deps: EntitlementRouteDeps): void => {
  app.get(API_PATHS.apiKeysEntitlement, async (c) => {
    const result = await listEntitlementKeys(ctxOf(c), deps);
    return respond(result.ok ? ok({ apiKeys: result.value }) : result);
  });

  app.post(API_PATHS.apiKeysEntitlement, async (c) => {
    const parsed = apiKeysEntitlementCreateInputSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return respond(err(validation('Invalid entitlement key payload', parsed.error.flatten())));
    return respond(await createEntitlementKey(ctxOf(c), parsed.data, deps));
  });

  app.delete(API_PATHS.apiKeysEntitlementRevoke, async (c) => {
    const parsed = apiKeysShopManagementRevokeInputSchema.safeParse({ id: c.req.param('id') });
    if (!parsed.success) return respond(err(validation('Invalid entitlement key id', parsed.error.flatten())));
    const result = await revokeEntitlementKey(ctxOf(c), parsed.data, deps);
    return respond(result.ok ? ok({ apiKey: result.value }) : result);
  });
};
