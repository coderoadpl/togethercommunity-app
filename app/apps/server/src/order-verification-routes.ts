import type { Hono } from 'hono';
import { z } from 'zod';
import { API_PATHS } from '#core/contract/index.js';
import { err, internal } from '#core/domain/index.js';
import { issueOrderLine, verifyOrder } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

const issueBodySchema = z.object({ count: z.unknown() }).passthrough();

const issueCountOf = async (request: Request): Promise<{ count?: unknown }> => {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return {};
  const body = issueBodySchema.safeParse(await readJson(request));
  return body.success && body.data.count !== undefined ? { count: body.data.count } : {};
};

export const registerOrderVerificationRoutes = (app: Hono<AppVars>, deps: Pick<AppDeps, 'orderVerification' | 'clock'>): void => {
  app.get(API_PATHS.verifyOrder, async (c) => deps.orderVerification === undefined ? respond(err(internal('Order verification is unavailable'))) : respond(await verifyOrder(ctxOf(c), c.req.param('reference') ?? '', { orderVerification: deps.orderVerification })));
  app.post(API_PATHS.issueOrderLine, async (c) => {
    if (deps.orderVerification === undefined) return respond(err(internal('Order verification is unavailable')));
    const count = await issueCountOf(c.req.raw);
    return respond(await issueOrderLine(ctxOf(c), { ...count, orderId: c.req.param('orderId') ?? '', productId: c.req.param('productId') ?? '' }, { orderVerification: deps.orderVerification, clock: deps.clock }));
  });
};
