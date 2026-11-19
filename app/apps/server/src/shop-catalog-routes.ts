import type { Context } from 'hono';
import type { z } from 'zod';

import { SHOP_CATALOG_ROUTES, shopCatalogContracts } from '#core/contract/index.js';
import { err, ok, validation } from '#core/domain/index.js';
import {
  adjustProductStock,
  createProduct,
  createProductPrice,
  deactivateProductPrice,
  deleteProductDraft,
  enableProductStock,
  getProductStock,
  listProductPrices,
  listProducts,
  listProductStock,
  publishProduct,
  setProductStockThreshold,
  unpublishProduct,
  updateProduct,
  type Ctx,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

type Handler = ShopMachineRoute['handler'];

const withBody = <S extends z.ZodTypeAny>(
  schema: S,
  message: string,
  run: (ctx: Ctx, input: z.output<S>) => Promise<Response>,
): Handler => async (c, { ctx }) => {
  const parsed = schema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return respond(err(validation(message, parsed.error.flatten())));
  return run(ctx, parsed.data);
};

const productIdParam = (c: Context<AppVars>): string => c.req.param('productId') ?? '';

export const shopCatalogRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...SHOP_CATALOG_ROUTES.listProducts,
    handler: async (_c, { ctx }) => {
      const result = await listProducts(ctx, deps);
      if (!result.ok) return respond(result);
      const stock = await listProductStock(ctx, result.value.map((product) => product.id), deps);
      return respond(stock.ok ? ok({ products: result.value, stock: stock.value }) : stock);
    },
  },
  {
    ...SHOP_CATALOG_ROUTES.createProduct,
    handler: withBody(shopCatalogContracts.createProduct.input, 'Invalid product payload', async (ctx, input) => {
      const result = await createProduct(ctx, input, deps);
      return respond(result.ok ? ok({ product: result.value }) : result);
    }),
  },
  {
    ...SHOP_CATALOG_ROUTES.updateProduct,
    handler: withBody(shopCatalogContracts.updateProduct.input, 'Invalid product update payload', async (ctx, input) => {
      const result = await updateProduct(ctx, input, deps);
      return respond(result.ok ? ok({ product: result.value }) : result);
    }),
  },
  {
    ...SHOP_CATALOG_ROUTES.publishProduct,
    handler: withBody(shopCatalogContracts.publishProduct.input, 'Invalid publish payload', async (ctx, input) => {
      const result = await publishProduct(ctx, input, deps);
      return respond(result.ok ? ok({ product: result.value }) : result);
    }),
  },
  {
    ...SHOP_CATALOG_ROUTES.unpublishProduct,
    handler: withBody(shopCatalogContracts.unpublishProduct.input, 'Invalid unpublish payload', async (ctx, input) => {
      const result = await unpublishProduct(ctx, input, deps);
      return respond(result.ok ? ok({ product: result.value }) : result);
    }),
  },
  {
    ...SHOP_CATALOG_ROUTES.deleteProductDraft,
    handler: withBody(shopCatalogContracts.deleteProductDraft.input, 'Invalid product deletion payload', async (ctx, input) =>
      respond(await deleteProductDraft(ctx, input, deps))),
  },
  {
    ...SHOP_CATALOG_ROUTES.listProductPrices,
    handler: async (c, { ctx }) => {
      const result = await listProductPrices(ctx, productIdParam(c), deps);
      return respond(result.ok ? ok({ prices: result.value }) : result);
    },
  },
  {
    ...SHOP_CATALOG_ROUTES.createProductPrice,
    handler: withBody(shopCatalogContracts.createProductPrice.input, 'Invalid price payload', async (ctx, input) => {
      const result = await createProductPrice(ctx, input, deps);
      return respond(result.ok ? ok({ price: result.value }) : result);
    }),
  },
  {
    ...SHOP_CATALOG_ROUTES.deactivateProductPrice,
    handler: withBody(shopCatalogContracts.deactivateProductPrice.input, 'Invalid price payload', async (ctx, input) => {
      const result = await deactivateProductPrice(ctx, input, deps);
      return respond(result.ok ? ok({ price: result.value }) : result);
    }),
  },
  {
    ...SHOP_CATALOG_ROUTES.getProductStock,
    handler: async (c, { ctx }) => {
      const result = await getProductStock(ctx, productIdParam(c), deps);
      return respond(result.ok ? ok({ stock: result.value }) : result);
    },
  },
  {
    ...SHOP_CATALOG_ROUTES.enableProductStock,
    handler: withBody(shopCatalogContracts.enableProductStock.input, 'Invalid stock tracking payload', async (ctx, input) => {
      const result = await enableProductStock(ctx, input, deps);
      return respond(result.ok ? ok({ stock: result.value }) : result);
    }),
  },
  {
    ...SHOP_CATALOG_ROUTES.adjustProductStock,
    handler: withBody(shopCatalogContracts.adjustProductStock.input, 'Invalid stock adjustment payload', async (ctx, input) => {
      const result = await adjustProductStock(ctx, input, deps);
      return respond(result.ok ? ok({ stock: result.value }) : result);
    }),
  },
  {
    ...SHOP_CATALOG_ROUTES.setProductStockThreshold,
    handler: withBody(shopCatalogContracts.setProductStockThreshold.input, 'Invalid low-stock threshold payload', async (ctx, input) => {
      const result = await setProductStockThreshold(ctx, input, deps);
      return respond(result.ok ? ok({ stock: result.value }) : result);
    }),
  },
];
