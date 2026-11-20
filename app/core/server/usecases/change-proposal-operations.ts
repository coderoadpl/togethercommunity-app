import {
  CHANGE_PROPOSAL_INPUT_SCHEMAS,
  changeProposalInputSchema,
  changeProposalSubmitCapability,
  err,
  ok,
  shopSettingsSchema,
  validation,
  type AppError,
  type Capability,
  type ChangeProposalEffect,
  type ChangeProposalInput,
  type ChangeProposalOperation,
  type ChangeProposalTarget,
  type Product,
  type ProductDownloadAsset,
  type ProductPrice,
  type Result,
  type SalesLink,
} from '#core/domain/index.js';

import { storageWithDeletesAfterCommit } from '../change-proposal-effects.js';
import type { Ctx } from '../context.js';
import type {
  ChangeProposalRepositories,
  ChangeProposalTargetLockPurpose,
  ChangeProposalTransactionScope,
  Clock,
  IdGenerator,
  StorageProvider,
} from '../ports.js';
import { createProductPrice, deactivateProductPrice } from './product-prices.js';
import { deleteProductDraft } from './product-drafts.js';
import { createProduct, publishProduct, unpublishProduct, updateProduct } from './products.js';
import { createSalesLink, deleteSalesLink, updateSalesLink } from './sales-links.js';
import { updateShopSettings } from './shop-settings.js';
import { adjustProductStock, enableProductStock, setProductStockThreshold } from './stock.js';

type ChangeProposalSnapshot = ChangeProposalInput;

// The only deps outside the transaction: ids and clock are pure, the logger writes only to the log, and storage deletes wait for a commit (which a dry run never makes) while every other storage call fails.
export interface ChangeProposalRunDeps {
  ids: IdGenerator;
  clock: Clock;
  storage: StorageProvider;
  logger: { error(message: string): void };
}

export interface PreparedChangeProposalOperation {
  input: ChangeProposalInput;
  target: ChangeProposalTarget;
  lockPurpose: ChangeProposalTargetLockPurpose;
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
  lockPurpose?: ChangeProposalTargetLockPurpose;
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

export const sameChangeProposalEffect = (left: ChangeProposalEffect, right: ChangeProposalEffect): boolean =>
  canonical(left) === canonical(right);

export const changeProposalTouchedFieldsMoved = (stored: ChangeProposalEffect, before: ChangeProposalSnapshot): boolean =>
  Object.entries(stored).some(([field, change]) => 'delta' in change
    ? typeof before[field] !== 'number'
    : canonical(before[field] ?? null) !== canonical(change.before));

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

const byId = <T extends { id: string }>(left: T, right: T): number => left.id.localeCompare(right.id);

const downloadFields = (asset: ProductDownloadAsset) => ({
  id: asset.id,
  fileName: asset.fileName,
  sizeBytes: asset.sizeBytes,
  status: asset.status,
  versionNumber: asset.versionNumber,
});

const productDeletionSnapshot = async (
  repositories: ChangeProposalRepositories,
  tenantId: string,
  productId: string,
): Promise<ChangeProposalSnapshot> => {
  const product = await repositories.products.findById(tenantId, productId);
  if (product === null) return { exists: false };
  const prices = await repositories.prices.listByProduct(tenantId, product.id);
  const downloads = await repositories.downloadAssets.listByProduct(tenantId, product.id);
  const stock = await repositories.stock.find(tenantId, product.id);
  return toSnapshot({
    exists: true,
    ...productFields(product),
    prices: [...prices].sort(byId).map((price) => ({ id: price.id, ...priceFields(price), active: price.active })),
    downloads: [...downloads].sort(byId).map(downloadFields),
    stock: stock === null
      ? { tracked: false, onHand: null, reserved: null, lowStockThreshold: null }
      : { tracked: true, onHand: stock.onHand, reserved: stock.reserved, lowStockThreshold: stock.lowStockThreshold },
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

const salesLinkSnapshot = async (
  repositories: ChangeProposalRepositories,
  tenantId: string,
  linkId: string | null,
): Promise<ChangeProposalSnapshot> => {
  const link = linkId === null ? null : await repositories.salesLinks.findById(tenantId, linkId);
  if (link === null) return { exists: false };
  return toSnapshot({
    exists: true,
    slug: link.slug,
    title: link.title,
    heading: link.heading,
    description: link.description,
    productIds: link.productIds,
    active: link.active,
    listed: link.listed,
    validFrom: link.validFrom,
    validTo: link.validTo,
    cancelReturnUrl: link.cancelReturnUrl ?? null,
    revision: link.revision,
  });
};

const SHOP_SETTINGS_FIELDS = shopSettingsSchema.keyof().options;

const settingsSnapshot = async (repositories: ChangeProposalRepositories, tenantId: string): Promise<ChangeProposalSnapshot> => {
  const settings = await repositories.tenants.findSettings(tenantId);
  if (settings === null) return { exists: false };
  return toSnapshot(Object.fromEntries(SHOP_SETTINGS_FIELDS.map((field) => [field, settings[field] ?? null])));
};

const resourceIdOf = <T extends { id: string }>(result: Result<T, AppError>): Result<string | null, AppError> =>
  result.ok ? ok(result.value.id) : result;

const idOnSuccess = <T>(productId: string, result: Result<T, AppError>): Result<string | null, AppError> =>
  result.ok ? ok(productId) : result;

const salesLinkIdOf = (result: Result<{ salesLink: SalesLink }, AppError>): Result<string | null, AppError> =>
  result.ok ? ok(result.value.salesLink.id) : result;

const withoutResourceId = <T>(result: Result<T, AppError>): Result<string | null, AppError> =>
  result.ok ? ok(null) : result;

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
    lockPurpose: definition.lockPurpose ?? 'change',
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

const salesLinkDeps = (scope: ChangeProposalTransactionScope, deps: ChangeProposalRunDeps) => ({
  salesLinks: scope.repositories.salesLinks,
  products: scope.repositories.products,
  prices: scope.repositories.prices,
  tenants: scope.repositories.tenants,
  ids: deps.ids,
  clock: deps.clock,
});

const settingsDeps = (scope: ChangeProposalTransactionScope) => ({
  tenants: scope.repositories.tenants,
  spaces: scope.repositories.spaces,
  products: scope.repositories.products,
});

const entry = <I>(operation: ChangeProposalOperation, definition: ChangeProposalOperationDefinition<I>): ChangeProposalOperationEntry => ({
  capability: changeProposalSubmitCapability(operation),
  prepare: define(definition),
});

export const CHANGE_PROPOSAL_OPERATIONS: Readonly<Record<ChangeProposalOperation, ChangeProposalOperationEntry>> = {
  'product.create': entry('product.create', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['product.create'],
    invalidInputMessage: 'Invalid product payload',
    target: () => ({ kind: 'product', id: null }),
    snapshot: (repositories, tenantId, _input, resourceId) => productSnapshot(repositories, tenantId, resourceId),
    run: async (ctx, input, scope, deps) => resourceIdOf(await createProduct(ctx, input, catalogDeps(scope, deps))),
  }),
  'product.update': entry('product.update', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['product.update'],
    invalidInputMessage: 'Invalid product update payload',
    target: (input) => ({ kind: 'product', id: input.id }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => resourceIdOf(await updateProduct(ctx, input, catalogDeps(scope, deps))),
  }),
  'product.publish': entry('product.publish', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['product.publish'],
    invalidInputMessage: 'Invalid publish payload',
    target: (input) => ({ kind: 'product', id: input.id }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => resourceIdOf(await publishProduct(ctx, input, catalogDeps(scope, deps))),
  }),
  'product.unpublish': entry('product.unpublish', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['product.unpublish'],
    invalidInputMessage: 'Invalid unpublish payload',
    target: (input) => ({ kind: 'product', id: input.id }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => resourceIdOf(await unpublishProduct(ctx, input, catalogDeps(scope, deps))),
  }),
  'product.delete-draft': entry('product.delete-draft', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['product.delete-draft'],
    invalidInputMessage: 'Invalid product deletion payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    lockPurpose: 'delete',
    snapshot: (repositories, tenantId, input) => productDeletionSnapshot(repositories, tenantId, input.productId),
    run: async (ctx, input, scope, deps) => idOnSuccess(input.productId, await deleteProductDraft(ctx, input, {
      productDrafts: scope.repositories.productDrafts,
      storage: storageWithDeletesAfterCommit(deps.storage, scope.afterCommit, deps.logger),
      secretResolver: scope.secretResolver,
      logger: deps.logger,
    })),
  }),
  'price.create': entry('price.create', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['price.create'],
    invalidInputMessage: 'Invalid price payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => productSnapshot(repositories, tenantId, input.productId),
    run: async (ctx, input, scope, deps) => resourceIdOf(await createProductPrice(ctx, input, catalogDeps(scope, deps))),
  }),
  'price.deactivate': entry('price.deactivate', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['price.deactivate'],
    invalidInputMessage: 'Invalid price payload',
    target: (input) => ({ kind: 'price', id: input.id }),
    snapshot: (repositories, tenantId, input) => priceSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => resourceIdOf(await deactivateProductPrice(ctx, input, catalogDeps(scope, deps))),
  }),
  'stock.enable': entry('stock.enable', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['stock.enable'],
    invalidInputMessage: 'Invalid stock tracking payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => stockSnapshot(repositories, tenantId, input.productId),
    run: async (ctx, input, scope, deps) => idOnSuccess(input.productId, await enableProductStock(ctx, input, catalogDeps(scope, deps))),
  }),
  'stock.adjust': entry('stock.adjust', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['stock.adjust'],
    invalidInputMessage: 'Invalid stock adjustment payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => stockSnapshot(repositories, tenantId, input.productId),
    effect: stockDeltaEffect,
    run: async (ctx, input, scope, deps) => idOnSuccess(input.productId, await adjustProductStock(ctx, input, catalogDeps(scope, deps))),
  }),
  'stock.set-threshold': entry('stock.set-threshold', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['stock.set-threshold'],
    invalidInputMessage: 'Invalid low-stock threshold payload',
    target: (input) => ({ kind: 'product', id: input.productId }),
    snapshot: (repositories, tenantId, input) => stockSnapshot(repositories, tenantId, input.productId),
    run: async (ctx, input, scope, deps) => idOnSuccess(input.productId, await setProductStockThreshold(ctx, input, catalogDeps(scope, deps))),
  }),
  'sales-link.create': entry('sales-link.create', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['sales-link.create'],
    invalidInputMessage: 'Invalid sales link',
    target: () => ({ kind: 'sales-link', id: null }),
    snapshot: (repositories, tenantId, _input, resourceId) => salesLinkSnapshot(repositories, tenantId, resourceId),
    run: async (ctx, input, scope, deps) => salesLinkIdOf(await createSalesLink(ctx, input, salesLinkDeps(scope, deps))),
  }),
  'sales-link.update': entry('sales-link.update', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['sales-link.update'],
    invalidInputMessage: 'Invalid sales link',
    target: (input) => ({ kind: 'sales-link', id: input.id }),
    snapshot: (repositories, tenantId, input) => salesLinkSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => salesLinkIdOf(await updateSalesLink(ctx, input, salesLinkDeps(scope, deps))),
  }),
  'sales-link.delete': entry('sales-link.delete', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['sales-link.delete'],
    invalidInputMessage: 'Invalid sales link deletion payload',
    target: (input) => ({ kind: 'sales-link', id: input.id }),
    snapshot: (repositories, tenantId, input) => salesLinkSnapshot(repositories, tenantId, input.id),
    run: async (ctx, input, scope, deps) => idOnSuccess(input.id, await deleteSalesLink(ctx, input, salesLinkDeps(scope, deps))),
  }),
  'settings.update': entry('settings.update', {
    schema: CHANGE_PROPOSAL_INPUT_SCHEMAS['settings.update'],
    invalidInputMessage: 'Invalid shop settings',
    target: () => ({ kind: 'settings', id: null }),
    snapshot: (repositories, tenantId) => settingsSnapshot(repositories, tenantId),
    run: async (ctx, input, scope) => withoutResourceId(await updateShopSettings(ctx, input, settingsDeps(scope))),
  }),
};
