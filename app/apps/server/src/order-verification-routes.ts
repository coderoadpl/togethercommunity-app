import type { Hono } from 'hono';
import { API_PATHS } from '#core/contract/index.js';
import { err, internal } from '#core/domain/index.js';
import { issueOrderLine, verifyOrder } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { respond } from './respond.js';

export const registerOrderVerificationRoutes = (app: Hono<AppVars>, deps: Pick<AppDeps, 'orderVerification' | 'clock'>): void => {
  app.get(API_PATHS.verifyOrder, async (c) => deps.orderVerification === undefined ? respond(err(internal('Order verification is unavailable'))) : respond(await verifyOrder(ctxOf(c), c.req.param('reference') ?? '', { orderVerification: deps.orderVerification })));
  app.post(API_PATHS.issueOrderLine, async (c) => deps.orderVerification === undefined ? respond(err(internal('Order verification is unavailable'))) : respond(await issueOrderLine(ctxOf(c), { orderId: c.req.param('orderId') ?? '', productId: c.req.param('productId') ?? '' }, { orderVerification: deps.orderVerification, clock: deps.clock })));
};
