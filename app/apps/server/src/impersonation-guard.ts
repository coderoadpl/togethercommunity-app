import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { BETTER_AUTH_SIGN_OUT_PATH } from '#adapters/auth/create-auth.js';
import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import {
  err,
  impersonationCookieName,
  impersonationReadOnly,
  IMPERSONATION_TTL_MS,
  type AppError,
} from '#core/domain/index.js';
import {
  endImpersonationRecord,
  resolveIdentity,
  resolveImpersonation,
  type ImpersonationDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { respond } from './respond.js';

export type ImpersonationRouteDecision = 'allow' | 'read-only' | 'private';

const READ_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];
const API_PREFIX = '/api/';

/**
 * Direct messages stay invisible under impersonation — reads included, not only
 * writes. Signing out is exempt because it ends the actor session the view hangs
 * on: refusing it would trap the operator in the member account menu.
 */
export const impersonationRouteDecision = (route: {
  method: string;
  path: string;
}): ImpersonationRouteDecision => {
  if (route.path === API_PATHS.messagesList || route.path.startsWith(`${API_PATHS.messagesList}/`)) {
    return 'private';
  }
  if (route.path === API_PATHS.impersonationStop) return 'allow';
  if (route.path === BETTER_AUTH_SIGN_OUT_PATH) return 'allow';
  return READ_METHODS.includes(route.method) ? 'allow' : 'read-only';
};

export const impersonationDeps = (deps: AppDeps): ImpersonationDeps => ({
  impersonations: deps.impersonations,
  auditEvents: deps.auditEvents,
  members: deps.members,
  tokens: deps.impersonationTokens,
  ids: deps.ids,
  clock: deps.clock,
});

/**
 * Cookie writes land after the handler because `respond` builds a fresh
 * `Response` that would otherwise drop headers set during the handler.
 */
const applyImpersonationCookie = (c: Context<AppVars>, secure: boolean): void => {
  const operation = c.get('impersonationCookie');
  if (operation === undefined) return;
  const name = impersonationCookieName(secure);
  const attributes = { httpOnly: true, sameSite: 'Lax', secure, path: '/' } as const;
  if (operation.kind === 'clear') {
    deleteCookie(c, name, attributes);
    return;
  }
  setCookie(c, name, operation.token, {
    ...attributes,
    maxAge: Math.floor(IMPERSONATION_TTL_MS / 1000),
  });
};

const resolveActingImpersonation = async (
  c: Context<AppVars>,
  token: string,
  deps: AppDeps,
) => {
  const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
  if (user === null) return null;
  const identity = await resolveIdentity(
    user,
    { host: c.req.header('host') ?? '', tenantHeader: c.req.header(TENANT_HEADER) ?? null },
    deps,
  );
  if (!identity.ok) return null;
  c.set('actorAuth', { user, identity: identity.value });
  return resolveImpersonation({ user, identity: identity.value }, token, impersonationDeps(deps));
};

const enterImpersonation = async (
  c: Context<AppVars>,
  deps: AppDeps,
): Promise<AppError | null> => {
  const token = getCookie(c, impersonationCookieName(deps.secureCookies));
  if (token === undefined) return null;
  const decision = impersonationRouteDecision({ method: c.req.method, path: c.req.path });
  if (decision === 'allow' && !c.req.path.startsWith(API_PREFIX)) return null;
  const resolved = await resolveActingImpersonation(c, token, deps);
  if (resolved === null) {
    c.set('impersonationCookie', { kind: 'clear' });
    return null;
  }
  c.set('impersonation', resolved.principal);
  c.set('impersonationIdentity', resolved.identity);
  if (decision === 'private') {
    return impersonationReadOnly('Direct messages are hidden while viewing as a member');
  }
  if (decision === 'read-only') {
    return impersonationReadOnly('This action is blocked while viewing as a member');
  }
  if (c.req.path === BETTER_AUTH_SIGN_OUT_PATH) {
    c.set('impersonationCookie', { kind: 'clear' });
    await endImpersonationRecord(resolved.tenantId, resolved.principal, impersonationDeps(deps));
  }
  return null;
};

/**
 * Registered ahead of every route so the refusal cannot be outrun by a handler
 * that matches first: a Hono route that returns a response never reaches the
 * middleware registered behind it.
 */
export const impersonationGuard = (deps: AppDeps): MiddlewareHandler<AppVars> =>
  async (c, next) => {
    const denial = await enterImpersonation(c, deps);
    if (denial !== null) return respond(err(denial));
    await next();
    applyImpersonationCookie(c, deps.secureCookies);
  };
