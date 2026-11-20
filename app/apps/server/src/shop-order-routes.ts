import type { Context } from 'hono';
import { z } from 'zod';

import { SHOP_ORDER_ROUTES, shopOrderContracts } from '#core/contract/index.js';
import { err, internal, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import {
  createInpostShipment,
  discardInpostShipmentAttempt,
  exportOrders,
  exportPackingList,
  getInpostShipment,
  getOrder,
  inpostShipmentLabel,
  issueOrderLine,
  listOrders,
  refreshInpostShipment,
  shipOrder,
  verifyOrder,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { issueCountOf } from './order-verification-routes.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import { shipxLabelResponse, shipxOrderDeps } from './shipx-routes.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

const shipBodySchema = z.object({}).passthrough();

const strictQuery = (c: Context<AppVars>, schema: z.ZodTypeAny, label: string): Result<Record<string, string>, AppError> => {
  const query = c.req.query();
  const parsed = schema.safeParse(query);
  return parsed.success ? ok(query) : err(validation(`Invalid ${label} query`, parsed.error.flatten()));
};

const orderIdParam = (c: Context<AppVars>): string => c.req.param('orderId') ?? '';

const unavailable = (message: string): Response => respond(err(internal(message)));

export const shopOrderRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...SHOP_ORDER_ROUTES.listOrders,
    handler: async (c, { ctx }) => {
      const query = strictQuery(c, shopOrderContracts.listOrders.input, 'orders list');
      return respond(query.ok ? await listOrders(ctx, query.value, deps) : query);
    },
  },
  {
    ...SHOP_ORDER_ROUTES.exportOrders,
    handler: async (c, { ctx }) => {
      const parsed = shopOrderContracts.exportOrders.input.safeParse(c.req.query());
      if (!parsed.success) return respond(err(validation('Invalid orders export query', parsed.error.flatten())));
      return respond(await exportOrders(ctx, parsed.data, deps));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.ordersPackingList,
    handler: async (c, { ctx }) => {
      const query = strictQuery(c, shopOrderContracts.ordersPackingList.input, 'packing list');
      return respond(query.ok ? await exportPackingList(ctx, query.value, deps) : query);
    },
  },
  {
    ...SHOP_ORDER_ROUTES.verifyOrder,
    handler: async (c, { ctx }) => {
      if (deps.orderVerification === undefined) return unavailable('Order verification is unavailable');
      return respond(await verifyOrder(ctx, c.req.param('reference') ?? '', { orderVerification: deps.orderVerification }));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.getOrder,
    handler: async (c, { ctx }) => {
      if (deps.orderDetails === undefined) return unavailable('Order details are unavailable');
      return respond(await getOrder(ctx, orderIdParam(c), { orders: deps.orderDetails, invoices: deps.invoices }));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipOrder,
    proposeMode: { kind: 'refuse', reason: 'side-effect' },
    handler: async (c, { ctx }) => {
      if (deps.orderFulfilment === undefined || deps.orderDetails === undefined) return unavailable('Order fulfilment is unavailable');
      const body = shipBodySchema.safeParse(await readJson(c.req.raw));
      const parsed = shopOrderContracts.shipOrder.input.safeParse({ ...(body.success ? body.data : {}), orderId: orderIdParam(c) });
      if (!parsed.success) return respond(err(validation('Invalid shipment payload', parsed.error.flatten())));
      return respond(await shipOrder(ctx, parsed.data, {
        ...deps,
        fulfilment: deps.orderFulfilment,
        orderDetails: deps.orderDetails,
      }));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.issueOrderLine,
    proposeMode: { kind: 'refuse', reason: 'side-effect' },
    handler: async (c, { ctx }) => {
      if (deps.orderVerification === undefined) return unavailable('Order verification is unavailable');
      const count = await issueCountOf(c.req.raw);
      if (!count.ok) return respond(count);
      return respond(await issueOrderLine(
        ctx,
        { ...count.value, orderId: orderIdParam(c), productId: c.req.param('productId') ?? '' },
        { orderVerification: deps.orderVerification, clock: deps.clock },
      ));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipxShipment,
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null) return unavailable('InPost ShipX is unavailable');
      return respond(await getInpostShipment(ctx, { orderId: orderIdParam(c) }, shipxDeps));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipxCreate,
    proposeMode: { kind: 'refuse', reason: 'side-effect' },
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null || deps.orderFulfilment === undefined || deps.shipxIntegration === undefined) return unavailable('InPost ShipX is unavailable');
      const body = shipBodySchema.safeParse(c.req.raw.body === null ? {} : await readJson(c.req.raw));
      if (!body.success) return respond(err(validation('Invalid InPost shipment request', body.error.flatten())));
      const parsed = shopOrderContracts.shipxCreate.input.safeParse({ ...body.data, orderId: orderIdParam(c) });
      if (!parsed.success) return respond(err(validation('Invalid InPost shipment request', parsed.error.flatten())));
      return respond(await createInpostShipment(ctx, parsed.data, {
        ...shipxDeps,
        ids: deps.ids,
        wait: deps.shipxIntegration.wait,
        ship: { ...deps, fulfilment: deps.orderFulfilment, orderDetails: shipxDeps.orderDetails },
      }));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipxRefresh,
    proposeMode: { kind: 'refuse', reason: 'side-effect' },
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null) return unavailable('InPost ShipX is unavailable');
      return respond(await refreshInpostShipment(ctx, { orderId: orderIdParam(c) }, shipxDeps));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipxDiscard,
    proposeMode: { kind: 'refuse', reason: 'side-effect' },
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null) return unavailable('InPost ShipX is unavailable');
      return respond(await discardInpostShipmentAttempt(ctx, { orderId: orderIdParam(c) }, shipxDeps));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipxLabel,
    proposeMode: { kind: 'refuse', reason: 'side-effect' },
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null) return unavailable('InPost ShipX is unavailable');
      const result = await inpostShipmentLabel(ctx, { orderId: orderIdParam(c) }, shipxDeps);
      return result.ok ? shipxLabelResponse(result.value) : respond(result);
    },
  },
];
