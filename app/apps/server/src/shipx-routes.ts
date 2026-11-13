import type { Hono } from 'hono';
import { z } from 'zod';
import { API_PATHS } from '#core/contract/index.js';
import { err, internal } from '#core/domain/index.js';
import {
  configureShipx,
  createInpostShipment,
  discardInpostShipmentAttempt,
  getInpostShipment,
  getShipxSettings,
  inpostShipmentLabel,
  type ProductBatchReader,
  type ShipOrderDeps,
} from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

const bodySchema = z.object({}).passthrough();

const attachmentName = (filename: string): string => filename.replace(/[^A-Za-z0-9._-]/g, '_');

export const registerShipxRoutes = (
  app: Hono<AppVars>,
  deps: Omit<ShipOrderDeps, 'fulfilment' | 'orderDetails'>
    & Pick<AppDeps, 'orderFulfilment' | 'orderDetails' | 'tenantSecrets' | 'secretCrypto' | 'secretResolver' | 'shipxIntegration'>
    & { products: ProductBatchReader },
): void => {
  const orderDeps = () => {
    if (deps.shipxIntegration === undefined || deps.orderDetails === undefined) return null;
    return {
      orderDetails: deps.orderDetails,
      products: deps.products,
      shipxShipments: deps.shipxIntegration.shipxShipments,
      shipxSettings: deps.shipxIntegration.shipxSettings,
      tenantSecrets: deps.tenantSecrets,
      secrets: deps.secretResolver,
      shipx: deps.shipxIntegration.shipx,
      clock: deps.clock,
    };
  };
  const unavailable = () => respond(err(internal('InPost ShipX is unavailable')));

  app.get(API_PATHS.shipxSettings, async (c) => {
    if (deps.shipxIntegration === undefined) return unavailable();
    return respond(await getShipxSettings(ctxOf(c), { shipxSettings: deps.shipxIntegration.shipxSettings, tenantSecrets: deps.tenantSecrets }));
  });
  app.post(API_PATHS.shipxConfigure, async (c) => {
    if (deps.shipxIntegration === undefined) return unavailable();
    const body = bodySchema.safeParse(await readJson(c.req.raw));
    return respond(await configureShipx(ctxOf(c), body.success ? body.data : {}, {
      shipxSettings: deps.shipxIntegration.shipxSettings,
      tenantSecrets: deps.tenantSecrets,
      secretCrypto: deps.secretCrypto,
      ids: deps.ids,
      clock: deps.clock,
    }));
  });
  app.get(API_PATHS.shipxShipment, async (c) => {
    const shipxDeps = orderDeps();
    if (shipxDeps === null) return unavailable();
    return respond(await getInpostShipment(ctxOf(c), { orderId: c.req.param('orderId') ?? '' }, shipxDeps));
  });
  app.post(API_PATHS.shipxCreate, async (c) => {
    const shipxDeps = orderDeps();
    if (shipxDeps === null || deps.orderFulfilment === undefined || deps.shipxIntegration === undefined) return unavailable();
    return respond(await createInpostShipment(ctxOf(c), { orderId: c.req.param('orderId') ?? '' }, {
      ...shipxDeps,
      ids: deps.ids,
      wait: deps.shipxIntegration.wait,
      ship: { ...deps, fulfilment: deps.orderFulfilment, orderDetails: shipxDeps.orderDetails },
    }));
  });
  app.post(API_PATHS.shipxDiscard, async (c) => {
    const shipxDeps = orderDeps();
    if (shipxDeps === null) return unavailable();
    return respond(await discardInpostShipmentAttempt(ctxOf(c), { orderId: c.req.param('orderId') ?? '' }, shipxDeps));
  });
  app.get(API_PATHS.shipxLabel, async (c) => {
    const shipxDeps = orderDeps();
    if (shipxDeps === null) return unavailable();
    const result = await inpostShipmentLabel(ctxOf(c), { orderId: c.req.param('orderId') ?? '' }, shipxDeps);
    if (!result.ok) return respond(result);
    return new Response(Uint8Array.from(result.value.bytes).buffer, {
      headers: {
        'content-type': result.value.contentType,
        'content-disposition': `attachment; filename="${attachmentName(result.value.filename)}"`,
        'content-length': String(result.value.bytes.byteLength),
        'cache-control': 'private, no-store',
      },
    });
  });
};
