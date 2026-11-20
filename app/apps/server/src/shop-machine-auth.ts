import type { Context, Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { API_KEY_HEADER, changeProposalGroupIdSchema, PROPOSAL_GROUP_HEADER, TENANT_HEADER } from '#core/contract/index.js';
import {
  err,
  forbidden,
  notFound,
  ok,
  shopManagementKeyEventResourceId,
  tenantNotFound,
  unauthorized,
  unavailable,
  validation,
  type AppError,
  type ChangeProposalOperation,
  type Result,
  type ShopManagementKeysSwitch,
  type ShopManagementScope,
  type Tenant,
} from '#core/domain/index.js';
import {
  authenticateShopManagementKey,
  recordShopManagementKeyRequest,
  resolveTenant,
  submitChangeProposal,
  submitGroupedChangeProposal,
  type ChangeProposalGroupSubmitDeps,
  type ChangeProposalSubmitDeps,
  type ResolveTenantDeps,
  type ShopMachineAuthDeps,
  type ShopMachineAuthentication,
  type ShopManagementKeyRequestDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { isSafeMethod, requestOriginPolicy } from './request-origin-policy.js';
import { respond, retryAfterHeaders } from './respond.js';
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

type ShopMachineDeps = ShopMachineAuthDeps & ResolveTenantDeps & ShopManagementKeyRequestDeps & ChangeProposalSubmitDeps & ChangeProposalGroupSubmitDeps;

type ShopMachineRequest = ShopMachineAuthentication & { tenant: Tenant };

type ShopMachineRefusalReason = 'secret' | 'side-effect' | 'not-in-release';

type ShopMachineProposeMode =
  | { kind: 'proposal'; operation: ChangeProposalOperation; toInput: (c: Context<AppVars>) => Promise<Result<unknown, AppError>> }
  | { kind: 'refuse'; reason: ShopMachineRefusalReason }
  | { kind: 'direct'; reason: string };

type ShopMachineMutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ShopMachineRouteFields {
  path: string;
  resourceIdField?: string;
  resourceIdSchema?: z.ZodType<string>;
  handler: (c: Context<AppVars>, request: ShopMachineRequest) => Response | Promise<Response>;
}

export type ShopMachineRoute = ShopMachineRouteFields & (
  | { method: 'GET'; scope: ShopManagementScope; proposeMode?: undefined }
  | { method: ShopMachineMutationMethod; scope: ShopManagementScope; proposeMode: ShopMachineProposeMode }
  | { method: 'GET' | ShopMachineMutationMethod; scope: null; proposeMode: { kind: 'proposal-management' } }
);

type ShopMachineRouteClass = ShopMachineProposeMode['kind'] | 'proposal-management';

export interface ShopMachineRouteShape {
  method: string;
  path: string;
  proposeMode?: { kind: ShopMachineRouteClass } | undefined;
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
  scope: ShopManagementScope | null,
  deps: ShopMachineDeps,
): Promise<ShopMachineAttempt> => {
  if (headers.has('cookie') || headers.has('authorization')) {
    return {
      result: err(unauthorized('Shop management requests must not carry a cookie or an Authorization header')),
      attribution: { match: 'mixed_credentials' },
    };
  }
  const key = headers.get(API_KEY_HEADER);
  const tenant = await resolveShopTenant(headers, deps);
  if (!tenant.ok) return { result: tenant, attribution: { match: key === null ? 'missing' : 'none' } };
  if (key === null) return { result: err(unauthorized('Missing API key')), attribution: { match: 'missing', tenantId: tenant.value.id } };
  const { result, attribution } = await authenticateShopManagementKey(tenant.value, key, scope, deps);
  return {
    result: result.ok ? ok({ ...result.value, tenant: tenant.value }) : result,
    attribution: { ...attribution, tenantId: tenant.value.id },
  };
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

const proposeModeRefusal = (reason: ShopMachineRefusalReason): AppError =>
  forbidden(`A propose-mode shop management key cannot call this route (${reason})`);

const proposalManagementRefusal = (): AppError =>
  forbidden('Only a propose-mode shop management key manages change proposals');

const isDirectModeKey = (request: ShopMachineRequest): boolean => request.apiKey.mode === 'direct';

const proposalGroupOf = (c: Context<AppVars>): Result<string | null, AppError> => {
  const header = c.req.header(PROPOSAL_GROUP_HEADER);
  if (header === undefined) return ok(null);
  const parsed = changeProposalGroupIdSchema.safeParse(header);
  return parsed.success ? ok(parsed.data) : err(validation(`Invalid ${PROPOSAL_GROUP_HEADER} header`, parsed.error.flatten()));
};

const submitProposal = async (
  request: ShopMachineRequest,
  operation: ChangeProposalOperation,
  input: unknown,
  groupId: string | null,
  deps: ShopMachineDeps,
) => {
  if (groupId === null) {
    const submitted = await submitChangeProposal(request.ctx, { operation, input }, deps);
    return submitted.ok ? ok({ outcome: 'proposed' as const, proposal: submitted.value }) : submitted;
  }
  const submitted = await submitGroupedChangeProposal(request.ctx, { groupId, operation, input }, deps);
  if (!submitted.ok) return submitted;
  const proposal = submitted.value.items.at(-1);
  if (proposal === undefined) throw new Error(`Change proposal group ${groupId} answered a submission without items`);
  return ok({ outcome: 'proposed' as const, proposal, group: submitted.value });
};

const proposeChange = async (
  c: Context<AppVars>,
  request: ShopMachineRequest,
  proposeMode: Extract<ShopMachineProposeMode, { kind: 'proposal' }>,
  deps: ShopMachineDeps,
): Promise<Response> => {
  const groupId = proposalGroupOf(c);
  if (!groupId.ok) return respond(groupId);
  const input = await proposeMode.toInput(c);
  if (!input.ok) return respond(input);
  const submitted = await submitProposal(request, proposeMode.operation, input.value, groupId.value, deps);
  return submitted.ok
    ? respond(submitted, { successStatus: 202 })
    : respond(submitted, { headers: retryAfterHeaders(submitted.error) });
};

const dispatchMutation = (
  c: Context<AppVars>,
  route: Exclude<ShopMachineRoute, { method: 'GET'; proposeMode?: undefined }>,
  request: ShopMachineRequest,
  deps: ShopMachineDeps,
): Response | Promise<Response> => {
  const { proposeMode } = route;
  if (proposeMode.kind === 'proposal-management') {
    return isDirectModeKey(request) ? respond(err(proposalManagementRefusal())) : route.handler(c, request);
  }
  if (isDirectModeKey(request)) return route.handler(c, request);
  switch (proposeMode.kind) {
    case 'direct':
      return route.handler(c, request);
    case 'refuse':
      return respond(err(proposeModeRefusal(proposeMode.reason)));
    case 'proposal':
      return proposeChange(c, request, proposeMode, deps);
  }
};

const unclassifiedMutation = (route: ShopMachineRouteShape): boolean =>
  !isSafeMethod(route.method) && route.proposeMode === undefined;

const assertRouteClass = (route: ShopMachineRoute): void => {
  const label = `${route.method} ${route.path}`;
  if (unclassifiedMutation(route)) throw new Error(`Shop management route ${label} needs a proposeMode`);
  if (route.scope === null && route.proposeMode?.kind !== 'proposal-management') {
    throw new Error(`Only a proposal-management shop route may omit its scope: ${label}`);
  }
};

export const registerShopMachineRoute = (
  app: Hono<AppVars>,
  deps: ShopMachineDeps,
  route: ShopMachineRoute,
): void => {
  if (!route.path.startsWith(SHOP_MACHINE_PATH_PREFIX)) {
    throw new Error(`Shop management routes must live under ${SHOP_MACHINE_PATH_PREFIX}: ${route.path}`);
  }
  assertRouteClass(route);
  app.on(route.method, route.path, async (c) => {
    const body = c.req.raw.clone();
    const { result, attribution } = await authenticateShopMachineRequest(c.req.raw.headers, route.scope, deps);
    c.set('apiKeyAttribution', attribution);
    if (!result.ok) return respond(result, { headers: retryAfterHeaders(result.error) });
    c.set('identity', result.value.ctx.identity);
    if (route.method === 'GET' && route.proposeMode === undefined) return route.handler(c, result.value);
    if (route.method === 'GET') {
      return isDirectModeKey(result.value) ? respond(err(proposalManagementRefusal())) : route.handler(c, result.value);
    }
    const recorded = await recordShopManagementKeyRequest(result.value.tenant.id, {
      apiKeyId: result.value.apiKey.id,
      actorUserId: result.value.ctx.identity.userId,
      method: route.method,
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
    return dispatchMutation(c, route, result.value, deps);
  });
};

export const assertShopMachineRouteCoverage = (routes: readonly ShopMachineRouteShape[]): void => {
  const uncovered = routes.filter((route) =>
    selfAuthenticatingRouteManifestEntry(route)?.mechanism !== SHOP_MACHINE_MECHANISM
    || (!isSafeMethod(route.method) && requestOriginPolicy(route.method, route.path) !== 'api-key'));
  const unclassified = routes.filter(unclassifiedMutation);
  if (uncovered.length === 0 && unclassified.length === 0) return;
  const listed = (entries: readonly ShopMachineRouteShape[]): string => entries.map((route) => `${route.method} ${route.path}`).join(', ');
  throw new Error([
    ...(uncovered.length === 0 ? [] : [`Shop management routes need a "${SHOP_MACHINE_MECHANISM}" manifest entry and the api-key origin policy: ${listed(uncovered)}`]),
    ...(unclassified.length === 0 ? [] : [`Shop management mutations need a proposeMode class: ${listed(unclassified)}`]),
  ].join('; '));
};

export const registerShopMachineRoutes = (
  app: Hono<AppVars>,
  deps: ShopMachineDeps,
  routes: readonly ShopMachineRoute[],
): void => {
  assertShopMachineRouteCoverage(routes);
  for (const route of routes) registerShopMachineRoute(app, deps, route);
};
