import {
  adjustStockInputSchema,
  changeProposalIdInputSchema,
  changeProposalInputSchema,
  changeProposalProductIdInputSchema,
  changeProposalSubmitCapability,
  enableStockTrackingInputSchema,
  err,
  newProductPriceSchema,
  newProductSchema,
  ok,
  stockThresholdInputSchema,
  updateProductInputSchema,
  validation,
  type AppError,
  type Capability,
  type ChangeProposalEffect,
  type ChangeProposalInput,
  type ChangeProposalOperation,
  type ChangeProposalTarget,
  type Product,
  type ProductPrice,
  type Result,
} from '#core/domain/index.js';

import { storageWithDeletesAfterCommit } from '../change-proposal-effects.js';
import type { Ctx } from '../context.js';
import type {
  ChangeProposalRepositories,
  ChangeProposalTransactionScope,
  Clock,
  IdGenerator,
  StorageProvider,
} from '../ports.js';
import { createProductPrice, deactivateProductPrice } from './product-prices.js';
import { deleteProductDraft } from './product-drafts.js';
import { createProduct, publishProduct, unpublishProduct, updateProduct } from './products.js';
import { adjustProductStock, enableProductStock, setProductStockThreshold } from './stock.js';

type ChangeProposalSnapshot = ChangeProposalInput;

// The only deps outside the transaction: ids and clock are pure, the logger writes only to the log, and storage deletes wait for a commit (which a dry run never makes) while every other storage call fails.
export interface ChangeProposalRunDeps {
  ids: IdGenerator;
  clock: Clock;
  storage: StorageProvider;
  logger: { error(message: string): void };
}

interface PreparedChangeProposalOperation {
  input: ChangeProposalInput;
  target: ChangeProposalTarget;
  snapshot(repositories: ChangeProposalRepositories, tenantId: string, resourceId: string | null): Promise<ChangeProposalSnapshot>;
  effect(before: ChangeProposalSnapshot, after: ChangeProposalSnapshot): ChangeProposalEffect;
  run(ctx: Ctx, scope: ChangeProposalTransactionScope, deps: ChangeProposalRunDeps): Promise<Result<string | null, AppError>>;
}

interface ChangeProposalOperationEntry {
  capability: Capability;
  prepare(rawInput: unknown): Result<PreparedChangeProposalOperation, AppError>;
}

interface InputParser<I> {
  safeParse(value: unknown): { success: true; data: I } | { success: false; error: { flatten(): unknown } };
}

interface ChangeProposalOperationDefinition<I> {
  schema: InputParser<I>;
  invalidInputMessage: string;
  target(input: I): ChangeProposalTarget;
  snapshot(repositories: ChangeProposalRepositories, tenantId: string, input: I, resourceId: string | null): Promise<ChangeProposalSnapshot>;
  effect?(before: ChangeProposalSnapshot, after: ChangeProposalSnapshot): ChangeProposalEffect;
  run(ctx: Ctx, input: I, scope: ChangeProposalTransactionScope, deps: ChangeProposalRunDeps): Promise<Result<string | null, AppError>>;
}

const jsonRoundTrip = (value: unknown): unknown => {
  const encoded = JSON.stringify(value);
  const decoded: unknown = encoded === undefined ? null : JSON.parse(encoded);
  return decoded;
};

const toSnapshot = (value: unknown): ChangeProposalSnapshot => changeProposalInputSchema.parse(jsonRoundTrip(value));

const canonical = (value: unknown): string => JSON.stringify(value, (_key, nested: unknown) => {
  if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) return nested;
  return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)));
});

const changeProposalFieldDiff = (before: ChangeProposalSnapshot, after: ChangeProposalSnapshot): ChangeProposalEffect => {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const effect: ChangeProposalEffect = {};
  for (const field of fields) {
    const was = before[field] ?? null;
    const becomes = after[field] ?? null;
    if (canonical(was) !== canonical(becomes)) effect[field] = { before: was, after: becomes };
  }
  return effect;
};

const stockDeltaEffect = (before: ChangeProposalSnapshot, after: ChangeProposalSnapshot): ChangeProposalEffect => {
  const { onHand: onHandBefore, ...restBefore } = before;
  const { onHand: onHandAfter, ...restAfter } = after;
  const effect = changeProposalFieldDiff(restBefore, restAfter);
  const delta = (typeof onHandAfter === 'number' ? onHandAfter : 0) - (typeof onHandBefore === 'number' ? onHandBefore : 0);
  return delta === 0 ? effect : { ...effect, onHand: { delta } };
};

const productFields = (product: Product) => ({
  type: product.type,
  slug: product.slug,
  title: product.title,
  description: product.description,
  coverUrl: product.coverUrl,
  priceCents: product.priceCents,
  currency: product.currency,
  published: product.published,
  visibility: product.visibility,
  salesChannel: product.salesChannel,
  deliveryMethod: product.deliveryMethod,
  parcelTemplate: product.parcelTemplate ?? null,
  compliance: product.compliance ?? null,
  personalization: product.personalization ?? null,
  variantGroup: product.variantGroup ?? null,
  variantLabel: product.variantLabel ?? null,
  vatRate: product.vatRate ?? null,
  vatExemptionBasis: product.vatExemptionBasis ?? null,
  accessItems: product.accessItems,
});

const priceFields = (price: ProductPrice) => ({
  kind: price.kind,
  interval: price.interval,
  amountCents: price.amountCents,
  currency: price.currency,
});

const byDisplayOrder = (left: ReturnType<typeof priceFields>, right: ReturnType<typeof priceFields>): number =>
  canonical(left).localeCompare(canonical(right));

const productSnapshot = async (
  repositories: ChangeProposalRepositories,
  tenantId: string,
  productId: string | null,
): Promise<ChangeProposalSnapshot> => {
  const product = productId === null ? null : await repositories.products.findById(tenantId, productId);
  if (product === null) return { exists: false };
  const activePrices = await repositories.prices.listActiveByProducts(tenantId, [product.id]);
  return toSnapshot({
    exists: true,
    ...productFields(product),
    activePrices: activePrices.map(priceFields).sort(byDisplayOrder),
  });
};

const priceSnapshot = async (
  repositories: ChangeProposalRepositories,
  tenantId: string,
  priceId: string,
): Promise<ChangeProposalSnapshot> => {
  const price = await repositories.prices.findById(tenantId, priceId);
  if (price === null) return { exists: false };
  return toSnapshot({ exists: true, productId: price.productId, ...priceFields(price), active: price.active });
};

const stockSnapshot = async (
  repositories: ChangeProposalRepositories,
  tenantId: string,
  productId: string,
): Promise<ChangeProposalSnapshot> => {
  const level = await repositories.stock.find(tenantId, productId);
  return level === null
    ? { tracked: false, onHand: null, lowStockThreshold: null }
    : { tracked: true, onHand: level.onHand, lowStockThreshold: level.lowStockThreshold };
};

const resourceIdOf = <T extends { id: string }>(result: Result<T, AppError>): Result<string | null, AppError> =>
  result.ok ? ok(result.value.id) : result;

const productIdOf = <T>(productId: string, result: Result<T, AppError>): Result<string | null, AppError> =>
  result.ok ? ok(productId) : result;

const define = <I>(definition: ChangeProposalOperationDefinition<I>) => (rawInput: unknown): Result<PreparedChangeProposalOperation, AppError> => {
  const first = definition.schema.safeParse(rawInput);
  if (!first.success) return err(validation(definition.invalidInputMessage, first.error.flatten()));
  const stored = changeProposalInputSchema.safeParse(jsonRoundTrip(first.data));
  if (!stored.success) return err(validation(definition.invalidInputMessage, stored.error.flatten()));
  const replayed = definition.schema.safeParse(stored.data);
  if (!replayed.success) return err(validation(definition.invalidInputMessage, replayed.error.flatten()));
  const input = replayed.data;
  return ok({
    input: stored.data,
    target: definition.target(input),
    snapshot: (repositories, tenantId, resourceId) => definition.snapshot(repositories, tenantId, input, resourceId),
    effect: definition.effect ?? changeProposalFieldDiff,
    run: (ctx, scope, deps) => definition.run(ctx, input, scope, deps),
  });
};

const catalogDeps = (scope: ChangeProposalTransactionScope, deps: ChangeProposalRunDeps) => ({
  tenants: scope.repositories.tenants,
  products: scope.repositories.products,
  prices: scope.repositories.prices,
  downloadAssets: scope.repositories.downloadAssets,
  spaces: scope.repositories.spaces,
  stock: scope.repositories.stock,
  ids: deps.ids,
  clock: deps.clock,
});

const entry = <I>(operation: ChangeProposalOperation, definition: ChangeProposalOperationDefinition<I>): ChangeProposalOperationEntry => ({
  capability: changeProposalSubmitCapability(operation),
  prepare: define(definition),
});

export const CHANGE_PROPOSAL_OPERATIONS: Readonly<Record<ChangeProposalOperation, ChangeProposalOperationEntry>> = {
  'product.create': entry('product.create', {
    schema: newProductSchema,
    invalidInputMessage: 'Invalid product payload',
    target: () => ({ kind: 'product', id: null }),
    snapshot: (repositories, tenantId, _input, resourceId) => productSnapshot(repositories, tenantId, resourceId),
    run: async (ctx, input, scope, deps) => resourceIdOf(await createProduct(ctx, input, catalogDeps(scope, deps))),
  }),
  'product.update': entry('product.update', {
    schema: updateProductInputSchema,
    invalidInputMessage: 'Invalid product update payload',
    target: (input) => ({ kind: 'product', id: input.id }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => resourceIdOf(await updateProduct(ctx, input, catalogDeps(scope, deps))),
  }),
  'product.publish': entry('product.publish', {
    schema: changeProposalIdInputSchema,
    invalidInputMessage: 'Invalid publish payload',
    target: (input) => ({ kind: 'product', id: input.id }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => resourceIdOf(await publishProduct(ctx, input, catalogDeps(scope, deps))),
  }),
  'product.unpublish': entry('product.unpublish', {
    schema: changeProposalIdInputSchema,
    invalidInputMessage: 'Invalid unpublish payload',
    target: (input) => ({ kind: 'product', id: input.id }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => resourceIdOf(await unpublishProduct(ctx, input, catalogDeps(scope, deps))),
  }),
  'product.delete-draft': entry('product.delete-draft', {
    schema: changeProposalProductIdInputSchema,
    invalidInputMessage: 'Invalid product deletion payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.productId),
    run: async (ctx, input, scope, deps) => productIdOf(input.productId, await deleteProductDraft(ctx, input, {
      productDrafts: scope.repositories.productDrafts,
      storage: storageWithDeletesAfterCommit(deps.storage, scope.afterCommit, deps.logger),
      secretResolver: scope.secretResolver,
      logger: deps.logger,
    })),
  }),
  'price.create': entry('price.create', {
    schema: newProductPriceSchema,
    invalidInputMessage: 'Invalid price payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.productId),
    run: async (ctx, input, scope, deps) => resourceIdOf(await createProductPrice(ctx, input, catalogDeps(scope, deps))),
  }),
  'price.deactivate': entry('price.deactivate', {
    schema: changeProposalIdInputSchema,
    invalidInputMessage: 'Invalid price payload',
    target: (input) => ({ kind: 'price', id: input.id }),
    snapshot: (repositories, tenantId, input) => priceSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => resourceIdOf(await deactivateProductPrice(ctx, input, catalogDeps(scope, deps))),
  }),
  'stock.enable': entry('stock.enable', {
    schema: enableStockTrackingInputSchema,
    invalidInputMessage: 'Invalid stock tracking payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => stockSnapshot(repositories, tenantId, input.productId),
    run: async (ctx, input, scope, deps) => productIdOf(input.productId, await enableProductStock(ctx, input, catalogDeps(scope, deps))),
  }),
  'stock.adjust': entry('stock.adjust', {
    schema: adjustStockInputSchema,
    invalidInputMessage: 'Invalid stock adjustment payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => stockSnapshot(repositories, tenantId, input.productId),
    effect: stockDeltaEffect,
    run: async (ctx, input, scope, deps) => productIdOf(input.productId, await adjustProductStock(ctx, input, catalogDeps(scope, deps))),
  }),
  'stock.set-threshold': entry('stock.set-threshold', {
    schema: stockThresholdInputSchema,
    invalidInputMessage: 'Invalid low-stock threshold payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => stockSnapshot(repositories, tenantId, input.productId),
    run: async (ctx, input, scope, deps) => productIdOf(input.productId, await setProductStockThreshold(ctx, input, catalogDeps(scope, deps))),
  }),
};
