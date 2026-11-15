import type { Context } from 'hono';
import { z } from 'zod';

import { SHOP_ORDER_ROUTES, shopOrderContracts } from '#core/contract/index.js';
import { err, internal, validation } from '#core/domain/index.js';
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
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import { shipxLabelResponse, shipxOrderDeps } from './shipx-routes.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

const LIST_QUERY_KEYS = ['source', 'sourceMatch', 'mode', 'status', 'productId', 'kind', 'couponId', 'fulfilmentStatus', 'search', 'page', 'pageSize'] as const;
const EXPORT_QUERY_KEYS = ['source', 'sourceMatch', 'format', 'status', 'productId', 'kind', 'couponId', 'fulfilmentStatus', 'search'] as const;
const PACKING_LIST_QUERY_KEYS = ['format', 'fulfilmentStatus', 'mode'] as const;

const shipBodySchema = z.object({}).passthrough();

const presentQuery = (c: Context<AppVars>, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.flatMap((key) => {
    const value = c.req.query(key);
    return value === undefined ? [] : [[key, value]];
  }));

const orderIdParam = (c: Context<AppVars>): string => c.req.param('orderId') ?? '';

const unavailable = (message: string): Response => respond(err(internal(message)));

export const shopOrderRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...SHOP_ORDER_ROUTES.listOrders,
    handler: async (c, { ctx }) => respond(await listOrders(ctx, presentQuery(c, LIST_QUERY_KEYS), deps)),
  },
  {
    ...SHOP_ORDER_ROUTES.exportOrders,
    handler: async (c, { ctx }) => {
      const parsed = shopOrderContracts.exportOrders.input.safeParse(presentQuery(c, EXPORT_QUERY_KEYS));
      if (!parsed.success) return respond(err(validation('Invalid orders export query', parsed.error.flatten())));
      return respond(await exportOrders(ctx, parsed.data, deps));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.ordersPackingList,
    handler: async (c, { ctx }) => respond(await exportPackingList(ctx, presentQuery(c, PACKING_LIST_QUERY_KEYS), deps)),
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
    handler: async (c, { ctx }) => {
      if (deps.orderFulfilment === undefined || deps.orderDetails === undefined) return unavailable('Order fulfilment is unavailable');
      const body = shipBodySchema.safeParse(await readJson(c.req.raw));
      return respond(await shipOrder(ctx, { ...(body.success ? body.data : {}), orderId: orderIdParam(c) }, {
        ...deps,
        fulfilment: deps.orderFulfilment,
        orderDetails: deps.orderDetails,
      }));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.issueOrderLine,
    handler: async (c, { ctx }) => {
      if (deps.orderVerification === undefined) return unavailable('Order verification is unavailable');
      return respond(await issueOrderLine(
        ctx,
        { orderId: orderIdParam(c), productId: c.req.param('productId') ?? '' },
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
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null || deps.orderFulfilment === undefined || deps.shipxIntegration === undefined) return unavailable('InPost ShipX is unavailable');
      return respond(await createInpostShipment(ctx, { orderId: orderIdParam(c) }, {
        ...shipxDeps,
        ids: deps.ids,
        wait: deps.shipxIntegration.wait,
        ship: { ...deps, fulfilment: deps.orderFulfilment, orderDetails: shipxDeps.orderDetails },
      }));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipxRefresh,
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null) return unavailable('InPost ShipX is unavailable');
      return respond(await refreshInpostShipment(ctx, { orderId: orderIdParam(c) }, shipxDeps));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipxDiscard,
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null) return unavailable('InPost ShipX is unavailable');
      return respond(await discardInpostShipmentAttempt(ctx, { orderId: orderIdParam(c) }, shipxDeps));
    },
  },
  {
    ...SHOP_ORDER_ROUTES.shipxLabel,
    handler: async (c, { ctx }) => {
      const shipxDeps = shipxOrderDeps(deps);
      if (shipxDeps === null) return unavailable('InPost ShipX is unavailable');
      const result = await inpostShipmentLabel(ctx, { orderId: orderIdParam(c) }, shipxDeps);
      return result.ok ? shipxLabelResponse(result.value) : respond(result);
    },
  },
];
