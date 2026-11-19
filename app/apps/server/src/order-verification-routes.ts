import type { Hono } from 'hono';
import { API_PATHS } from '#core/contract/index.js';
import { err, internal, issueOrderLineInputSchema, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import { issueOrderLine, verifyOrder } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

const issueBodySchema = issueOrderLineInputSchema.partial();

export const issueCountOf = async (request: Request): Promise<Result<{ count?: number }, AppError>> => {
  if ((await request.clone().arrayBuffer()).byteLength === 0) return ok({});
  const body = issueBodySchema.safeParse(await readJson(request));
  if (!body.success) return err(validation('Invalid order line issue request'));
  return ok(body.data.count === undefined ? {} : { count: body.data.count });
};

export const registerOrderVerificationRoutes = (app: Hono<AppVars>, deps: Pick<AppDeps, 'orderVerification' | 'clock'>): void => {
  app.get(API_PATHS.verifyOrder, async (c) => deps.orderVerification === undefined ? respond(err(internal('Order verification is unavailable'))) : respond(await verifyOrder(ctxOf(c), c.req.param('reference') ?? '', { orderVerification: deps.orderVerification })));
  app.post(API_PATHS.issueOrderLine, async (c) => {
    if (deps.orderVerification === undefined) return respond(err(internal('Order verification is unavailable')));
    const count = await issueCountOf(c.req.raw);
    if (!count.ok) return respond(count);
    return respond(await issueOrderLine(ctxOf(c), { ...count.value, orderId: c.req.param('orderId') ?? '', productId: c.req.param('productId') ?? '' }, { orderVerification: deps.orderVerification, clock: deps.clock }));
  });
};
