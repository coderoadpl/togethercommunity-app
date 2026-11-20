import { SHOP_ASSETS_ROUTES, shopAssetsContracts } from '#core/contract/index.js';
import { err, internal, ok, validation } from '#core/domain/index.js';
import {
  beginProductCoverUpload,
  completeProductCoverUpload,
  createSalesLink,
  deleteSalesLink,
  getSalesLink,
  listSalesLinks,
  updateSalesLink,
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

export const shopAssetsRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...SHOP_ASSETS_ROUTES.productCoverUpload,
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => {
      const parsed = shopAssetsContracts.productCoverUpload.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset payload', parsed.error.flatten())));
      const result = await beginProductCoverUpload(ctx, parsed.data, deps);
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
    ...SHOP_ASSETS_ROUTES.productCoverComplete,
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => {
      const parsed = shopAssetsContracts.productCoverComplete.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset completion', parsed.error.flatten())));
      return respond(await completeProductCoverUpload(ctx, parsed.data, deps));
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
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => {
      if (deps.salesLinkManagement === undefined) return respond(err(internal('Sales links are unavailable')));
      const parsed = shopAssetsContracts.createSalesLink.input.safeParse(await readJson(c.req.raw));
      return parsed.success
        ? respond(await createSalesLink(ctx, parsed.data, deps.salesLinkManagement), { successStatus: 201 })
        : respond(err(validation('Invalid sales link')));
    },
  },
  {
    ...SHOP_ASSETS_ROUTES.updateSalesLink,
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => {
      if (deps.salesLinkManagement === undefined) return respond(err(internal('Sales links are unavailable')));
      const parsed = shopAssetsContracts.updateSalesLink.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success || parsed.data.id !== c.req.param('id')) return respond(err(validation('Invalid sales-link update')));
      return respond(await updateSalesLink(ctx, parsed.data, deps.salesLinkManagement));
    },
  },
  {
    ...SHOP_ASSETS_ROUTES.deleteSalesLink,
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => deps.salesLinkManagement === undefined
      ? respond(err(internal('Sales links are unavailable')))
      : respond(await deleteSalesLink(ctx, { id: c.req.param('id') ?? '' }, deps.salesLinkManagement)),
  },
];
