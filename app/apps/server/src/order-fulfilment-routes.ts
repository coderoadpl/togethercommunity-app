import type { Hono } from 'hono';
import { z } from 'zod';
import { API_PATHS } from '#core/contract/index.js';
import { err, internal } from '#core/domain/index.js';
import { correctOrderPersonalization, exportPackingList, shipOrder, type OrderRepository, type ShipOrderDeps } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

const shipBodySchema = z.object({}).passthrough();

export const registerOrderFulfilmentRoutes = (
  app: Hono<AppVars>,
  deps: Omit<ShipOrderDeps, 'fulfilment' | 'orderDetails'> & Pick<AppDeps, 'orderFulfilment' | 'orderDetails' | 'orderPersonalizations'> & { orders: Pick<OrderRepository, 'list'> },
): void => {
  app.get(API_PATHS.ordersPackingList, async (c) => respond(await exportPackingList(ctxOf(c), {
    format: c.req.query('format'),
    ...(c.req.query('fulfilmentStatus') === undefined ? {} : { fulfilmentStatus: c.req.query('fulfilmentStatus') }),
    ...(c.req.query('mode') === undefined ? {} : { mode: c.req.query('mode') }),
  }, deps)));
  app.post(API_PATHS.shipOrder, async (c) => {
    if (deps.orderFulfilment === undefined || deps.orderDetails === undefined) return respond(err(internal('Order fulfilment is unavailable')));
    const body = shipBodySchema.safeParse(await readJson(c.req.raw));
    return respond(await shipOrder(ctxOf(c), { ...(body.success ? body.data : {}), orderId: c.req.param('orderId') ?? '' }, {
      ...deps,
      fulfilment: deps.orderFulfilment,
      orderDetails: deps.orderDetails,
    }));
  });
  app.post(API_PATHS.correctOrderPersonalization, async (c) => {
    if (deps.orderPersonalizations === undefined) return respond(err(internal('Order fulfilment is unavailable')));
    const body = shipBodySchema.safeParse(await readJson(c.req.raw));
    return respond(await correctOrderPersonalization(ctxOf(c), { ...(body.success ? body.data : {}), orderId: c.req.param('orderId') ?? '' }, {
      personalizations: deps.orderPersonalizations,
      clock: deps.clock,
    }));
  });
};
