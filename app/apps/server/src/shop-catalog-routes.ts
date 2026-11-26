import type { Context } from 'hono';
import type { z } from 'zod';

import { SHOP_CATALOG_ROUTES, shopCatalogContracts } from '#core/contract/index.js';
import {
  err,
  ok,
  validation,
  type AppError,
  type ChangeProposalOperation,
  type Result,
  type ShopManagementScope,
} from '#core/domain/index.js';
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
  updateProductAccessItems,
  type Ctx,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

interface CatalogWriteRoute {
  method: 'POST';
  path: string;
  scope: ShopManagementScope;
}

const bodyOf = <S extends z.ZodTypeAny>(schema: S, message: string) =>
  async (c: Context<AppVars>): Promise<Result<z.output<S>, AppError>> => {
    const parsed = schema.safeParse(await readJson(c.req.raw));
    return parsed.success ? ok(parsed.data) : err(validation(message, parsed.error.flatten()));
  };

const proposableWrite = <S extends z.ZodTypeAny>(
  route: CatalogWriteRoute,
  operation: ChangeProposalOperation,
  schema: S,
  message: string,
  run: (ctx: Ctx, input: z.output<S>) => Promise<Response>,
): ShopMachineRoute => {
  const parse = bodyOf(schema, message);
  return {
    ...route,
    proposeMode: { kind: 'proposal', operation, toInput: parse },
    handler: async (c, { ctx }) => {
      const input = await parse(c);
      return input.ok ? run(ctx, input.value) : respond(input);
    },
  };
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
  proposableWrite(SHOP_CATALOG_ROUTES.createProduct, 'product.create', shopCatalogContracts.createProduct.input, 'Invalid product payload', async (ctx, input) => {
    const result = await createProduct(ctx, input, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  }),
  proposableWrite(SHOP_CATALOG_ROUTES.updateProduct, 'product.update', shopCatalogContracts.updateProduct.input, 'Invalid product update payload', async (ctx, input) => {
    const result = await updateProduct(ctx, input, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  }),
  proposableWrite(SHOP_CATALOG_ROUTES.publishProduct, 'product.publish', shopCatalogContracts.publishProduct.input, 'Invalid publish payload', async (ctx, input) => {
    const result = await publishProduct(ctx, input, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  }),
  proposableWrite(SHOP_CATALOG_ROUTES.unpublishProduct, 'product.unpublish', shopCatalogContracts.unpublishProduct.input, 'Invalid unpublish payload', async (ctx, input) => {
    const result = await unpublishProduct(ctx, input, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  }),
  proposableWrite(SHOP_CATALOG_ROUTES.deleteProductDraft, 'product.delete-draft', shopCatalogContracts.deleteProductDraft.input, 'Invalid product deletion payload', async (ctx, input) =>
    respond(await deleteProductDraft(ctx, input, deps))),
  proposableWrite(SHOP_CATALOG_ROUTES.setProductAccess, 'product.set-access', shopCatalogContracts.setProductAccess.input, 'Invalid product access payload', async (ctx, input) => {
    const result = await updateProductAccessItems(ctx, input, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  }),
  {
    ...SHOP_CATALOG_ROUTES.listProductPrices,
    handler: async (c, { ctx }) => {
      const result = await listProductPrices(ctx, productIdParam(c), deps);
      return respond(result.ok ? ok({ prices: result.value }) : result);
    },
  },
  proposableWrite(SHOP_CATALOG_ROUTES.createProductPrice, 'price.create', shopCatalogContracts.createProductPrice.input, 'Invalid price payload', async (ctx, input) => {
    const result = await createProductPrice(ctx, input, deps);
    return respond(result.ok ? ok({ price: result.value }) : result);
  }),
  proposableWrite(SHOP_CATALOG_ROUTES.deactivateProductPrice, 'price.deactivate', shopCatalogContracts.deactivateProductPrice.input, 'Invalid price payload', async (ctx, input) => {
    const result = await deactivateProductPrice(ctx, input, deps);
    return respond(result.ok ? ok({ price: result.value }) : result);
  }),
  {
    ...SHOP_CATALOG_ROUTES.getProductStock,
    handler: async (c, { ctx }) => {
      const result = await getProductStock(ctx, productIdParam(c), deps);
      return respond(result.ok ? ok({ stock: result.value }) : result);
    },
  },
  proposableWrite(SHOP_CATALOG_ROUTES.enableProductStock, 'stock.enable', shopCatalogContracts.enableProductStock.input, 'Invalid stock tracking payload', async (ctx, input) => {
    const result = await enableProductStock(ctx, input, deps);
    return respond(result.ok ? ok({ stock: result.value }) : result);
  }),
  proposableWrite(SHOP_CATALOG_ROUTES.adjustProductStock, 'stock.adjust', shopCatalogContracts.adjustProductStock.input, 'Invalid stock adjustment payload', async (ctx, input) => {
    const result = await adjustProductStock(ctx, input, deps);
    return respond(result.ok ? ok({ stock: result.value }) : result);
  }),
  proposableWrite(SHOP_CATALOG_ROUTES.setProductStockThreshold, 'stock.set-threshold', shopCatalogContracts.setProductStockThreshold.input, 'Invalid low-stock threshold payload', async (ctx, input) => {
    const result = await setProductStockThreshold(ctx, input, deps);
    return respond(result.ok ? ok({ stock: result.value }) : result);
  }),
];
