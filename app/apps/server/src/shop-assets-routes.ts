import type { Context } from 'hono';
import type { z } from 'zod';

import { SHOP_ASSETS_ROUTES, shopAssetsContracts } from '#core/contract/index.js';
import { err, internal, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import {
  beginProductCoverUpload,
  beginProposedProductCoverUpload,
  completeProductCoverUpload,
  completeProposedProductCoverUpload,
  createSalesLink,
  deleteSalesLink,
  getSalesLink,
  listSalesLinks,
  updateSalesLink,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond, retryAfterHeaders } from './respond.js';
import { imageUploadAnswer, isProposeModeKey, PROPOSED_IMAGE_UPLOAD, type ShopMachineRoute } from './shop-machine-auth.js';

type SalesLinkCreateInput = z.output<typeof shopAssetsContracts.createSalesLink.input>;
type SalesLinkUpdateInput = z.output<typeof shopAssetsContracts.updateSalesLink.input>;

const salesLinkCreateInput = async (c: Context<AppVars>): Promise<Result<SalesLinkCreateInput, AppError>> => {
  const parsed = shopAssetsContracts.createSalesLink.input.safeParse(await readJson(c.req.raw));
  return parsed.success ? ok(parsed.data) : err(validation('Invalid sales link'));
};

const salesLinkUpdateInput = async (c: Context<AppVars>): Promise<Result<SalesLinkUpdateInput, AppError>> => {
  const parsed = shopAssetsContracts.updateSalesLink.input.safeParse(await readJson(c.req.raw));
  return parsed.success && parsed.data.id === c.req.param('id') ? ok(parsed.data) : err(validation('Invalid sales-link update'));
};

const salesLinkDeleteInput = (c: Context<AppVars>): { id: string } => ({ id: c.req.param('id') ?? '' });

export const shopAssetsRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...SHOP_ASSETS_ROUTES.productCoverUpload,
    proposeMode: PROPOSED_IMAGE_UPLOAD,
    handler: async (c, request) => {
      const parsed = shopAssetsContracts.productCoverUpload.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset payload', parsed.error.flatten())));
      const quarantined = isProposeModeKey(request);
      const result = quarantined
        ? await beginProposedProductCoverUpload(request.ctx, parsed.data, deps)
        : await beginProductCoverUpload(request.ctx, parsed.data, deps);
      return respond(result.ok ? ok(imageUploadAnswer(result.value, parsed.data.contentType, quarantined)) : result);
    },
  },
  {
    ...SHOP_ASSETS_ROUTES.productCoverComplete,
    proposeMode: PROPOSED_IMAGE_UPLOAD,
    handler: async (c, request) => {
      const parsed = shopAssetsContracts.productCoverComplete.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset completion', parsed.error.flatten())));
      const result = isProposeModeKey(request)
        ? await completeProposedProductCoverUpload(request.ctx, parsed.data, deps)
        : await completeProductCoverUpload(request.ctx, parsed.data, deps);
      return respond(result, result.ok ? {} : { headers: retryAfterHeaders(result.error) });
    },
  },
  {
    ...SHOP_ASSETS_ROUTES.listSalesLinks,
    handler: async (_c, { ctx }) => deps.salesLinkManagement === undefined
      ? respond(err(internal('Sales links are unavailable')))
      : respond(await listSalesLinks(ctx, deps.salesLinkManagement)),
  },
  {
    ...SHOP_ASSETS_ROUTES.getSalesLink,
    handler: async (c, { ctx }) => deps.salesLinkManagement === undefined
      ? respond(err(internal('Sales links are unavailable')))
      : respond(await getSalesLink(ctx, { id: c.req.param('id') ?? '' }, deps.salesLinkManagement)),
  },
  {
    ...SHOP_ASSETS_ROUTES.createSalesLink,
    proposeMode: { kind: 'proposal', operation: 'sales-link.create', toInput: salesLinkCreateInput },
    handler: async (c, { ctx }) => {
      if (deps.salesLinkManagement === undefined) return respond(err(internal('Sales links are unavailable')));
      const input = await salesLinkCreateInput(c);
      return input.ok
        ? respond(await createSalesLink(ctx, input.value, deps.salesLinkManagement), { successStatus: 201 })
        : respond(input);
    },
  },
  {
    ...SHOP_ASSETS_ROUTES.updateSalesLink,
    proposeMode: { kind: 'proposal', operation: 'sales-link.update', toInput: salesLinkUpdateInput },
    handler: async (c, { ctx }) => {
      if (deps.salesLinkManagement === undefined) return respond(err(internal('Sales links are unavailable')));
      const input = await salesLinkUpdateInput(c);
      return input.ok ? respond(await updateSalesLink(ctx, input.value, deps.salesLinkManagement)) : respond(input);
    },
  },
  {
    ...SHOP_ASSETS_ROUTES.deleteSalesLink,
    proposeMode: { kind: 'proposal', operation: 'sales-link.delete', toInput: async (c) => ok(salesLinkDeleteInput(c)) },
    handler: async (c, { ctx }) => deps.salesLinkManagement === undefined
      ? respond(err(internal('Sales links are unavailable')))
      : respond(await deleteSalesLink(ctx, salesLinkDeleteInput(c), deps.salesLinkManagement)),
  },
];
