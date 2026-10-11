import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { hasStripeTestSession } from '#core/server/index.js';
import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';

export const stripeTestCheckoutIdentity = async (c: Context<AppVars>, tenantId: string, deps: AppDeps) => {
  const cookie = getCookie(c, 'together_stripe_test');
  if (cookie === undefined || c.get('impersonation') !== undefined) return null;
  const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
  if (user === null) return null;
  const grant = await deps.tenantAccess.findStaffGrant(user.userId, { tenantId });
  if (grant === null) return null;
  const identity = { ...user, tenantId, staffRole: grant.staffRole };
  return hasStripeTestSession(identity, cookie, deps) ? identity : null;
};
