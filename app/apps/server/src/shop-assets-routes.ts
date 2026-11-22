import type { Context } from 'hono';
import type { z } from 'zod';

import { SHOP_ASSETS_ROUTES, shopAssetsContracts } from '#core/contract/index.js';
import { err, internal, ok, validation, type AppError, type Result, type ShopManagementScope } from '#core/domain/index.js';
import {
  beginProductCoverUpload,
  beginProductImageUpload,
  completeProductCoverUpload,
  completeProductImageUpload,
  createSalesLink,
  deleteSalesLink,
  getSalesLink,
  listSalesLinks,
  updateSalesLink,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

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

type ImageAssetUseCases = {
  begin: typeof beginProductCoverUpload;
  complete: typeof completeProductCoverUpload;
};

type ImageAssetRoute = { method: 'POST'; path: string; scope: ShopManagementScope };

const imageAssetRoutes = (
  deps: AppDeps,
  routes: { upload: ImageAssetRoute; complete: ImageAssetRoute },
  useCases: ImageAssetUseCases,
): readonly ShopMachineRoute[] => [
  {
    ...routes.upload,
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => {
      const parsed = shopAssetsContracts.productCoverUpload.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset payload', parsed.error.flatten())));
      const result = await useCases.begin(ctx, parsed.data, deps);
      return respond(result.ok
        ? ok({
            key: result.value.key,
            servePath: result.value.servePath,
            upload: {
              url: result.value.uploadUrl,
              headers: { 'content-type': parsed.data.contentType },
              expiresAt: result.value.expiresAt,
            },
          })
        : result);
    },
  },
  {
    ...routes.complete,
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => {
      const parsed = shopAssetsContracts.productCoverComplete.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset completion', parsed.error.flatten())));
      return respond(await useCases.complete(ctx, parsed.data, deps));
    },
  },
];

export const shopAssetsRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  ...imageAssetRoutes(
    deps,
    { upload: SHOP_ASSETS_ROUTES.productCoverUpload, complete: SHOP_ASSETS_ROUTES.productCoverComplete },
    { begin: beginProductCoverUpload, complete: completeProductCoverUpload },
  ),
  ...imageAssetRoutes(
    deps,
    { upload: SHOP_ASSETS_ROUTES.productImageUpload, complete: SHOP_ASSETS_ROUTES.productImageComplete },
    { begin: beginProductImageUpload, complete: completeProductImageUpload },
  ),
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
