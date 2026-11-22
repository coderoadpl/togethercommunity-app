import type { Hono } from 'hono';
import { API_PATHS } from '#core/contract/index.js';
import { err, internal, ok, type AppError, type Result } from '#core/domain/index.js';
import {
  claimRateLimitWindow,
  createStaffRefund,
  previewStaffRefund,
  shipRefundedOrderAnyway,
  type RateLimitWindow,
  type StaffRefundDeps,
  type StaffRefundRateLimitKind,
} from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond, retryAfterHeaders } from './respond.js';

const MINUTE_MS = 60_000;

export type StaffRefundRateLimits = Record<StaffRefundRateLimitKind, { perActor: RateLimitWindow; perWorkspace: RateLimitWindow }>;

export const STAFF_REFUND_RATE_LIMITS: StaffRefundRateLimits = {
  preview: { perActor: { limit: 60, windowMs: MINUTE_MS }, perWorkspace: { limit: 300, windowMs: MINUTE_MS } },
  write: { perActor: { limit: 10, windowMs: MINUTE_MS }, perWorkspace: { limit: 60, windowMs: MINUTE_MS } },
};

type StaffRefundRouteDeps = Pick<AppDeps, 'orderDetails' | 'orderStaffRefunds' | 'ids' | 'clock' | 'logger' | 'dispatchOrderRefunds' | 'rateLimitBuckets'>
  & Pick<StaffRefundDeps, 'payment'> & { invoices?: NonNullable<StaffRefundDeps['invoices']> };

const staffRefundRateLimit = (
  deps: Pick<AppDeps, 'rateLimitBuckets' | 'clock'>,
  limits: StaffRefundRateLimits,
): NonNullable<StaffRefundDeps['rateLimit']> => async ({ kind, tenantId, actorUserId }) => {
  const limiter = { buckets: deps.rateLimitBuckets, clock: deps.clock };
  const perActor = await claimRateLimitWindow({ scope: `staff-refund-${kind}:actor`, key: `${tenantId}:${actorUserId}`, window: limits[kind].perActor }, limiter);
  if (!perActor.ok) return perActor;
  return claimRateLimitWindow({ scope: `staff-refund-${kind}:workspace`, key: tenantId, window: limits[kind].perWorkspace }, limiter);
};

const respondWithRetryAfter = <T>(result: Result<T, AppError>): Response =>
  respond(result, result.ok ? {} : { headers: retryAfterHeaders(result.error) });

export const registerStaffRefundRoutes = (
  app: Hono<AppVars>,
  deps: StaffRefundRouteDeps,
  limits: StaffRefundRateLimits = STAFF_REFUND_RATE_LIMITS,
): void => {
  const resolved = () => {
    if (deps.orderDetails === undefined || deps.orderStaffRefunds === undefined) return null;
    return {
      orderDetails: deps.orderDetails,
      staffRefunds: deps.orderStaffRefunds,
      payment: deps.payment,
      ...(deps.invoices === undefined ? {} : { invoices: deps.invoices }),
      ids: deps.ids,
      clock: deps.clock,
      logger: deps.logger,
      dispatchOrderRefunds: deps.dispatchOrderRefunds,
      rateLimit: staffRefundRateLimit(deps, limits),
    };
  };
  const unavailable = () => respond(err(internal('Staff refunds are unavailable')));

  app.get(API_PATHS.orderRefundPreview, async (c) => {
    const refundDeps = resolved();
    if (refundDeps === null) return unavailable();
    return respondWithRetryAfter(await previewStaffRefund(ctxOf(c), c.req.param('orderId') ?? '', refundDeps));
  });
  app.post(API_PATHS.orderRefundCreate, async (c) => {
    const refundDeps = resolved();
    if (refundDeps === null) return unavailable();
    return respondWithRetryAfter(await createStaffRefund(ctxOf(c), c.req.param('orderId') ?? '', await readJson(c.req.raw), refundDeps));
  });
  app.post(API_PATHS.orderShipAnyway, async (c) => {
    const refundDeps = resolved();
    if (refundDeps === null) return unavailable();
    const shipped = await shipRefundedOrderAnyway(ctxOf(c), c.req.param('orderId') ?? '', refundDeps);
    return respondWithRetryAfter(shipped.ok ? ok({ order: shipped.value }) : shipped);
  });
};
