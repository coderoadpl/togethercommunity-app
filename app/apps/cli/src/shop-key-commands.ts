import { openAsBlob } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import type { Command } from 'commander';
import { z } from 'zod';

import {
  changeProposalCreatedKind,
  createShopManagementClient,
  isProposedChange,
  type ProposalRequestOptions,
  type ShopManagementClient,
  type ShopManagementClientOptions,
} from '#core/client/index.js';
import {
  changeProposalGroupCreateInputSchema,
  changeProposalGroupIdSchema,
  changeProposalListQuerySchema,
  type ChangeProposalProposedOutput,
  shopAssetsContracts,
  shopCatalogContracts,
  shopDownloadContracts,
  shopIntegrationContracts,
  shopSettingsContracts,
} from '#core/contract/index.js';
import {
  accessItemSchema,
  currencySchema,
  deliveryMethodSchema,
  err,
  fulfilmentStatusSchema,
  isChangeProposalReference,
  KEY_DOWNLOAD_CONTENT_TYPE_BY_EXTENSION,
  keyDownloadAttachInputSchema,
  notFound,
  ok,
  parcelTemplateSchema,
  priceKindSchema,
  priceMajorSchema,
  productSalesChannelSchema,
  productVisibilitySchema,
  shippingCarrierSchema,
  shipxEnvironmentSchema,
  shipxSendingMethodSchema,
  stripeModeSchema,
  validation,
  type AccessItem,
  type AppError,
  type ChangeProposalGroupKeyReceipt,
  type ChangeProposalKeyReceipt,
  type KeyDownloadFileCap,
  type KeyDownloadStagedFileView,
  type OrderListItem,
  type ProductDownloadAssetMetadata,
  type ProductPrice,
  type ProductStock,
  type Result,
  type ShipxOrderView,
} from '#core/domain/index.js';

import { changeProposalAppliedLine } from './change-proposal-output.js';
import { imageUploadInput, productImagesFileOption } from './image-files.js';
import { emit, orderStatusLabel } from './output.js';
import { readStdin, secretInput } from './secret-input.js';
import { SHIPX_SENDING_METHOD_HELP, shipxSettingsLines, shipxSlotPatch } from './shipx-settings.js';
import { formatProductStock } from './stock-commands.js';

export const DEFAULT_SHOP_KEY_ENV = 'TOGETHER_SHOP_KEY';

type ShopCliContext = { apiUrl: string; tenant: string | null; json: boolean };
type ShopClientFactory = (options: ShopManagementClientOptions) => ShopManagementClient;

const keyEnvSchema = z.object({ apiKeyEnv: z.string().min(1).default(DEFAULT_SHOP_KEY_ENV) }).passthrough();
const proposalGroupOptionSchema = z.object({ group: changeProposalGroupIdSchema.optional() }).passthrough();
const idSchema = z.string().min(1);
const keyOnlySchema = z.object({ apiKeyEnv: z.string() });
const centsSchema = z.string().regex(/^(0|[1-9]\d*)$/, 'Price must be a non-negative integer number of cents').transform((value) => Number.parseInt(value, 10));
const countSchema = z.string().regex(/^(0|[1-9]\d*)$/, 'Expected a non-negative whole number').transform((value) => Number.parseInt(value, 10));
const deltaSchema = z.string().regex(/^[+-]?[1-9]\d*$/, 'Expected a non-zero whole number such as 5 or -2').transform((value) => Number.parseInt(value, 10));
const vatRateSchema = z.enum(['5', '8', '23', 'exempt']).transform((value) => value === 'exempt' ? value : value === '5' ? 5 as const : value === '8' ? 8 as const : 23 as const);

const productFieldsSchema = z.object({
  apiKeyEnv: z.string(),
  vatRate: vatRateSchema.optional(),
  vatExemptionBasis: z.string().optional(),
  visibility: productVisibilitySchema.optional(),
  salesChannel: productSalesChannelSchema.optional(),
  deliveryMethod: deliveryMethodSchema.optional(),
  parcelTemplate: parcelTemplateSchema.optional(),
  description: z.string().optional(),
  coverUrl: z.string().url().optional(),
  compliance: z.string().optional(),
  personalizationFile: z.string().min(1).optional(),
  personalization: z.boolean().default(true),
  imagesFile: z.string().min(1).optional(),
  variantGroup: z.string().optional(),
  variantLabel: z.string().optional(),
});
const productCreateSchema = productFieldsSchema.extend({
  title: z.string(),
  type: z.string().optional(),
  slug: z.string().optional(),
  priceCents: centsSchema.optional(),
  price: priceMajorSchema.optional(),
  currency: currencySchema.optional(),
  accessItems: z.string().optional(),
});
const productUpdateSchema = productFieldsSchema.extend({
  title: z.string().optional(),
  clearCover: z.boolean().default(false),
  clearVariant: z.boolean().default(false),
});
const productAccessSchema = z.object({
  apiKeyEnv: z.string(),
  course: z.array(idSchema).default([]),
  module: z.array(idSchema).default([]),
  lesson: z.array(idSchema).default([]),
  excludeModule: z.array(idSchema).default([]),
  accessItems: z.string().optional(),
  clear: z.boolean().default(false),
});
const priceAddSchema = z.object({
  apiKeyEnv: z.string(),
  product: idSchema,
  kind: z.enum(['one_time', 'recurring']),
  interval: z.enum(['month', 'year']).optional(),
  priceCents: centsSchema.optional(),
  price: priceMajorSchema.optional(),
  currency: currencySchema.optional(),
});

const positiveIntSchema = z.string().regex(/^[1-9]\d*$/, 'Expected a positive whole number').transform((value) => Number.parseInt(value, 10));
const orderFiltersSchema = z.object({
  apiKeyEnv: z.string(),
  status: z.enum(['paid', 'pending', 'failed', 'refunded', 'partially_refunded']).optional(),
  product: idSchema.optional(),
  kind: priceKindSchema.optional(),
  coupon: idSchema.optional(),
  fulfilment: fulfilmentStatusSchema.optional(),
  source: z.string().min(1).max(200).optional(),
  sourceExact: z.boolean().optional(),
  search: z.string().min(1).optional(),
});
const ordersListSchema = orderFiltersSchema.extend({
  mode: stripeModeSchema.optional(),
  page: positiveIntSchema.optional(),
  pageSize: positiveIntSchema.optional(),
});
const ordersExportSchema = orderFiltersSchema.extend({ format: z.enum(['csv', 'json']), out: z.string().min(1).optional() });
const packingListSchema = z.object({
  apiKeyEnv: z.string(),
  format: z.literal('csv'),
  fulfilment: fulfilmentStatusSchema.optional(),
  mode: stripeModeSchema.default('live'),
  out: z.string().min(1).optional(),
});
const shipSchema = keyOnlySchema.extend({ carrier: shippingCarrierSchema, tracking: z.string().min(1) });
const issueSchema = keyOnlySchema.extend({ count: positiveIntSchema.optional() });
const labelSchema = keyOnlySchema.extend({ out: z.string().min(1) });
const settingsSetSchema = keyOnlySchema.extend({ jsonFile: z.string().min(1) });
const brandingKindSchema = z.enum(['logo', 'logo-dark', 'favicon', 'share-image']);

const shopSettingsPatchInput = async (source: string) => {
  let raw: string;
  try {
    raw = source === '-' ? await readStdin() : await readFile(source, 'utf8');
  } catch (cause) {
    return err(validation(`Could not read the shop settings JSON from "${source}": ${String(cause)}`));
  }
  const parsed = inlineJson(raw, 'shop settings');
  return parsed.ok ? contractInput(shopSettingsContracts.updateSettings.input, parsed.value, 'Invalid shop settings') : parsed;
};

const salesLinkFileInput = async <S extends z.ZodTypeAny>(source: string, schema: S, id?: string) => {
  let raw: string;
  try {
    raw = source === '-' ? await readStdin() : await readFile(source, 'utf8');
  } catch (cause) {
    return err(validation(`Could not read the sales-link JSON from "${source}": ${String(cause)}`));
  }
  const parsed = inlineJson(raw, 'sales link');
  if (!parsed.ok) return parsed;
  if (id === undefined) return contractInput(schema, parsed.value, 'Invalid sales link');
  const fields = z.record(z.unknown()).safeParse(parsed.value);
  if (!fields.success) return err(validation('Invalid sales-link update'));
  if (fields.data['id'] !== undefined && fields.data['id'] !== id) return err(validation('Sales-link id must match the command argument'));
  return contractInput(schema, { ...fields.data, id }, 'Invalid sales-link update');
};

const fileNoteSchema = keyOnlySchema.extend({ note: keyDownloadAttachInputSchema.shape.versionNote });

const fileAttachSchema = fileNoteSchema.extend({ replaces: idSchema.optional() });

const replacementCheck = (assets: readonly ProductDownloadAssetMetadata[], replaces: string | undefined): Result<void, AppError> => {
  if (replaces === undefined) return ok(undefined);
  const replaced = assets.find((asset) => asset.id === replaces);
  if (replaced === undefined) return err(notFound(`Replacement file "${replaces}" not found on this product; nothing was uploaded`));
  return replaced.status === 'ready' ? ok(undefined) : err(validation(`Only ready files can be replaced; "${replaces}" is ${replaced.status} and nothing was uploaded`));
};

const downloadFileInput = async (file: string) => {
  const extension = extname(file).slice(1).toLowerCase();
  const contentType = Object.entries(KEY_DOWNLOAD_CONTENT_TYPE_BY_EXTENSION).find(([known]) => known === extension)?.[1];
  if (contentType === undefined) {
    return err(validation(`The file must end in ${Object.keys(KEY_DOWNLOAD_CONTENT_TYPE_BY_EXTENSION).map((known) => `.${known}`).join(', ')}`));
  }
  let body: Blob;
  try {
    body = await openAsBlob(file);
  } catch (cause) {
    return err(validation(`Could not read the file "${file}": ${String(cause)}`));
  }
  const input = contractInput(shopDownloadContracts.uploadStagedDownload.input, {
    fileName: basename(file), contentType, sizeBytes: body.size,
  }, 'Invalid download file');
  return input.ok ? ok({ ...input.value, body }) : input;
};

const FILE_CAP_HINTS = {
  key_staged_files: 'list this key\'s staged files with "together shop files staged" and discard the ones it no longer needs with "together shop files discard <id>"',
  key_staged_bytes: 'list this key\'s staged files with "together shop files staged" and discard the ones it no longer needs with "together shop files discard <id>"',
  workspace_staged_bytes: 'every key of the workspace shares this budget; a staged file that no pending proposal holds is deleted 7 days after it was staged',
  key_file_uploads: 'retry once the uploads and copies of the last 15 minutes fall out of the window',
  key_file_bytes_daily: 'retry once the uploads and copies of the last 24 hours fall out of the window',
  product_files: 'remove a file of the product first with "together shop files remove <productId> <assetId>"',
} as const satisfies Record<KeyDownloadFileCap, string>;

const capDetailsSchema = z.object({ changeProposalCap: z.string() });

const stagedFileState = (attach: { stagedId: string; productId: string }): string =>
  `; check whether the staged file ${attach.stagedId} was attached, proposed or is still staged with `
  + `"together shop files list ${attach.productId}", "together shop files staged" and "together shop proposals list"; `
  + `if it is still staged and no pending proposal holds it, the sweep may remove it from 7 days after it was staged, `
  + `and "together shop files discard ${attach.stagedId}" removes it at once`;

const withFileHint = (error: AppError, attach?: { stagedId: string; productId: string }): AppError => {
  const cap = capDetailsSchema.safeParse(error.details);
  const hint = cap.success ? Object.entries(FILE_CAP_HINTS).find(([known]) => known === cap.data.changeProposalCap)?.[1] : undefined;
  const state = attach === undefined ? '' : stagedFileState(attach);
  return { ...error, message: `${error.message}${hint === undefined ? '' : ` (${hint})`}${state}` };
};

const sizeLabel = (bytes: number): string => `${String(bytes)} bytes`;

const downloadAssetLine = (asset: ProductDownloadAssetMetadata): string =>
  `- ${asset.fileName}  version ${String(asset.versionNumber)}${asset.supersededAt === null ? '' : ' (previous version)'}  ${asset.contentType}  ${sizeLabel(asset.sizeBytes)}  [${asset.status}]  (${asset.id})`;

const stagedFileLine = (file: KeyDownloadStagedFileView, lifetime = `expires ${file.expiresAt}`): string => [
  `- ${file.fileName}  ${file.contentType}  ${sizeLabel(file.sizeBytes)}`,
  file.copiedFrom === null
    ? `sha256 ${file.sha256 ?? '(not shown)'}`
    : `copy of file ${file.copiedFrom.assetId} version ${String(file.copiedFrom.versionNumber)} of product ${file.copiedFrom.productId}`,
  lifetime,
  `(${file.id})`,
].join('  ');

const envNameSchema = z.string().min(1).optional();
const secretSetSchema = keyOnlySchema.extend({ valueEnv: envNameSchema });
const stripeConfigureSchema = keyOnlySchema.extend({ mode: stripeModeSchema, restrictedKeyEnv: envNameSchema });
const storageConfigureSchema = keyOnlySchema.extend({
  provider: z.string(),
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string(),
  accessKeyId: z.string(),
  secretAccessKeyEnv: envNameSchema,
});
const shipxConfigureSchema = keyOnlySchema.extend({
  sendingMethod: shipxSendingMethodSchema.optional(),
  slot: shipxEnvironmentSchema.optional(),
  senderJsonFile: z.string().min(1).optional(),
  clearSender: z.boolean().optional(),
  organizationId: z.string().optional(),
  tokenEnv: envNameSchema,
  tokenStdin: z.boolean().optional(),
  clearCredentials: z.boolean().optional(),
});

const shipxConfigureInput = async (options: z.output<typeof shipxConfigureSchema>) => {
  if (options.senderJsonFile !== undefined && options.clearSender === true) return err(validation('Provide only one of --sender-json-file and --clear-sender'));
  if (options.tokenEnv !== undefined && options.tokenStdin === true) return err(validation('Provide only one of --token-env and --token-stdin'));
  if (options.senderJsonFile === '-' && options.tokenStdin === true) return err(validation('Only one of the sender JSON and the token can come from stdin'));
  let sender: unknown;
  if (options.senderJsonFile !== undefined) {
    let raw: string;
    try {
      raw = options.senderJsonFile === '-' ? await readStdin() : await readFile(options.senderJsonFile, 'utf8');
    } catch (cause) {
      return err(validation(`Could not read the sender JSON from "${options.senderJsonFile}": ${String(cause)}`));
    }
    const parsed = inlineJson(raw, 'ShipX sender');
    if (!parsed.ok) return parsed;
    sender = parsed.value;
  }
  const slot = await shipxSlotPatch(options);
  if (!slot.ok) return slot;
  return contractInput(shopIntegrationContracts.shipxConfigure.input, {
    ...(options.senderJsonFile === undefined ? {} : { sender }),
    ...(options.clearSender === true ? { sender: null } : {}),
    ...(options.sendingMethod === undefined ? {} : { sendingMethod: options.sendingMethod }),
    ...slot.value,
  }, 'Invalid InPost ShipX settings');
};

const orderFilters = (options: z.output<typeof orderFiltersSchema>) => ({
  ...(options.status === undefined ? {} : { status: options.status }),
  ...(options.product === undefined ? {} : { productId: options.product }),
  ...(options.kind === undefined ? {} : { kind: options.kind }),
  ...(options.coupon === undefined ? {} : { couponId: options.coupon }),
  ...(options.fulfilment === undefined ? {} : { fulfilmentStatus: options.fulfilment }),
  ...(options.source === undefined ? {} : { source: options.source }),
  ...(options.sourceExact === true ? { sourceMatch: 'exact' as const } : {}),
  ...(options.search === undefined ? {} : { search: options.search }),
});

const orderLine = (order: OrderListItem): string =>
  `${order.createdAt}\t${orderStatusLabel(order)}\t${order.mode ?? 'live'}\t${order.fulfilmentStatus ?? '-'}\t${String(order.amountCents)} ${order.currency}\t${order.productTitle}\t${order.memberEmail}\t(${order.id})`;

const shipxOrderLines = (view: ShipxOrderView): string => [
  `available: ${String(view.available)}${view.reason === null ? '' : ` (${view.reason})`}`,
  `environment: ${view.environment}`,
  `service: ${view.service ?? '(none)'}`,
  `sending method: ${view.sendingMethod ?? '(none)'}`,
  `parcel template: ${view.parcelTemplate}`,
  `shipment: ${view.shipment === null ? '(none)' : `${view.shipment.shipxShipmentId ?? '(not confirmed by ShipX)'} ${view.shipment.status} ${view.shipment.environment} ${view.shipment.trackingNumber ?? ''}`.trim()}`,
].join('\n');

const writeExport = async <T extends { filename: string; content: string }>(
  result: Result<T, AppError>,
  out: string | undefined,
): Promise<Result<T & { out?: string }, AppError>> => {
  if (!result.ok || out === undefined) return result;
  await writeFile(out, result.value.content);
  return ok({ ...result.value, out });
};

const exportSummary = (file: { filename: string; content: string; out?: string }): string =>
  file.out === undefined ? file.content : `wrote ${file.filename} to ${file.out}`;

const inlineJson = (raw: string | undefined, label: string): Result<unknown, AppError> => {
  if (raw === undefined) return ok(undefined);
  try {
    return ok(JSON.parse(raw));
  } catch (cause) {
    return err(validation(`Invalid ${label} JSON: ${String(cause)}`));
  }
};

const contractInput = <S extends z.ZodTypeAny>(schema: S, input: unknown, message: string): Result<z.output<S>, AppError> => {
  const parsed = schema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err(validation(message, parsed.error.flatten()));
};

const singleAmount = (major: number | undefined, cents: number | undefined, noun: string): Result<number, AppError> => {
  if (major !== undefined && cents !== undefined) return err(validation('Provide only one of --price and --price-cents'));
  const amount = major ?? cents;
  return amount === undefined
    ? err(validation(`Provide ${noun} with --price (currency units) or --price-cents (integer cents)`))
    : ok(amount);
};

const personalizationField = async (options: z.output<typeof productFieldsSchema>): Promise<Result<{ personalization?: unknown }, AppError>> => {
  if (!options.personalization) {
    return options.personalizationFile === undefined
      ? ok({ personalization: null })
      : err(validation('Provide only one of --personalization-file and --no-personalization'));
  }
  if (options.personalizationFile === undefined) return ok({});
  let raw: string;
  try {
    raw = await readFile(options.personalizationFile, 'utf8');
  } catch (cause) {
    return err(validation(`Could not read personalisation file "${options.personalizationFile}": ${String(cause)}`));
  }
  const parsed = inlineJson(raw, 'personalisation');
  return parsed.ok ? ok({ personalization: parsed.value }) : parsed;
};

const sharedProductFields = (options: z.output<typeof productFieldsSchema>, compliance: unknown) => ({
  vatRate: options.vatRate,
  vatExemptionBasis: options.vatExemptionBasis,
  visibility: options.visibility,
  salesChannel: options.salesChannel,
  deliveryMethod: options.deliveryMethod,
  parcelTemplate: options.parcelTemplate,
  description: options.description,
  coverUrl: options.coverUrl,
  compliance,
  variantGroup: options.variantGroup,
  variantLabel: options.variantLabel,
});

const shopProductCreateInput = async (options: z.output<typeof productCreateSchema>) => {
  const priceCents = singleAmount(options.price, options.priceCents, 'a price');
  if (!priceCents.ok) return priceCents;
  const compliance = inlineJson(options.compliance, 'product safety information');
  if (!compliance.ok) return compliance;
  const accessItems = inlineJson(options.accessItems, 'access items');
  if (!accessItems.ok) return accessItems;
  const personalization = await personalizationField(options);
  if (!personalization.ok) return personalization;
  const images = await productImagesFileOption(options.imagesFile);
  if (!images.ok) return images;
  return contractInput(shopCatalogContracts.createProduct.input, {
    ...sharedProductFields(options, compliance.value),
    ...personalization.value,
    ...images.value,
    title: options.title,
    priceCents: priceCents.value,
    type: options.type,
    slug: options.slug,
    currency: options.currency,
    accessItems: accessItems.value,
  }, 'Invalid product');
};

const shopProductUpdateInput = async (id: string, options: z.output<typeof productUpdateSchema>) => {
  if (options.coverUrl !== undefined && options.clearCover) return err(validation('Provide only one of --cover-url and --clear-cover'));
  if (options.clearVariant && (options.variantGroup !== undefined || options.variantLabel !== undefined)) {
    return err(validation('Provide only one of --clear-variant and --variant-group/--variant-label'));
  }
  const compliance = inlineJson(options.compliance, 'product safety information');
  if (!compliance.ok) return compliance;
  const personalization = await personalizationField(options);
  if (!personalization.ok) return personalization;
  const images = await productImagesFileOption(options.imagesFile);
  if (!images.ok) return images;
  return contractInput(shopCatalogContracts.updateProduct.input, {
    ...sharedProductFields(options, compliance.value),
    ...personalization.value,
    ...images.value,
    id,
    title: options.title,
    ...(options.clearCover ? { coverUrl: null } : {}),
    ...(options.clearVariant ? { variantGroup: null, variantLabel: null } : {}),
  }, 'Invalid product update');
};

const shopPriceCreateInput = (options: z.output<typeof priceAddSchema>) => {
  const amountCents = singleAmount(options.price, options.priceCents, 'an amount');
  if (!amountCents.ok) return amountCents;
  return contractInput(shopCatalogContracts.createProductPrice.input, {
    productId: options.product,
    kind: options.kind,
    amountCents: amountCents.value,
    interval: options.interval,
    currency: options.currency,
  }, 'Invalid price');
};

const formatPrice = (price: Pick<ProductPrice, 'id' | 'kind' | 'interval' | 'amountCents' | 'currency' | 'active'>): string => {
  const cadence = price.kind === 'recurring' ? `recurring/${price.interval ?? '?'}` : 'one-time';
  return `- ${String(price.amountCents)} ${price.currency}  ${cadence}  [${price.active ? 'active' : 'inactive'}]  (${price.id})`;
};

const describeStock = (stock: ProductStock): string =>
  `${formatProductStock(stock)}\nlow-stock threshold: ${stock.lowStockThreshold === null ? 'not set' : String(stock.lowStockThreshold)}`;

const productLine = (product: { title: string; id: string }): string => `${product.title} (${product.id.slice(0, 8)})`;

const repeatable = (value: string, previous: string[]): string[] => [...previous, value];

const ACCESS_LIST_REQUIRED = 'State the whole new list of what the product grants: one or more --course, --access-items, or --clear for none';

const shopProductAccessItems = (options: z.output<typeof productAccessSchema>): Result<AccessItem[], AppError> => {
  const { course: courseIds, module: moduleIds, lesson: lessonIds, excludeModule: excludedModuleIds } = options;
  const parts = moduleIds.length > 0 || lessonIds.length > 0;
  const flags = courseIds.length > 0 || parts || excludedModuleIds.length > 0;
  if (options.accessItems !== undefined) {
    if (flags || options.clear) return err(validation('--access-items states the whole list alone; drop the other access options'));
    const parsed = inlineJson(options.accessItems, 'access items');
    if (!parsed.ok) return parsed;
    const items = z.array(accessItemSchema).safeParse(parsed.value);
    return items.success ? ok(items.data) : err(validation('Invalid access items', items.error.flatten()));
  }
  if (options.clear) return flags ? err(validation('--clear cannot be combined with other access options')) : ok([]);
  if (courseIds.length === 0) return err(validation(ACCESS_LIST_REQUIRED));
  const [courseId] = courseIds;
  if (parts || excludedModuleIds.length > 0) {
    if (courseId === undefined || courseIds.length > 1) return err(validation('--module, --lesson and --exclude-module need exactly one --course; state a list of another shape with --access-items'));
    if (parts && excludedModuleIds.length > 0) return err(validation('--exclude-module applies to a whole course and cannot be combined with --module or --lesson'));
    if (excludedModuleIds.length > 0) return ok([{ level: 'course', courseId, excludedModuleIds }]);
    return ok([
      ...(moduleIds.length === 0 ? [] : [{ level: 'modules' as const, courseId, moduleIds }]),
      ...(lessonIds.length === 0 ? [] : [{ level: 'lessons' as const, courseId, lessonIds }]),
    ]);
  }
  return ok(courseIds.map((id) => ({ level: 'course' as const, courseId: id })));
};

const receiptLines = (proposal: ChangeProposalKeyReceipt): string => [
  `proposal ${proposal.id}: ${proposal.operation} [${proposal.status}]`,
  `target: ${proposal.target.kind}${proposal.target.id === null ? ' (new)' : ` ${proposal.target.id}`}`,
  `created: ${proposal.createdAt}`,
  `expires: ${proposal.expiresAt}`,
  ...(proposal.status === 'applied' ? [changeProposalAppliedLine(proposal.operation, proposal.appliedResourceId)] : []),
  ...(proposal.decisionNote === null ? [] : [`decision note: ${proposal.decisionNote}`]),
  ...(proposal.failureCode === null ? [] : [`failure: ${proposal.failureCode}`]),
].join('\n');

const receiptLine = (proposal: ChangeProposalKeyReceipt): string =>
  `${proposal.createdAt}\t${proposal.status}\t${proposal.operation}\t${proposal.target.kind}:${proposal.target.id ?? '(new)'}\t${proposal.groupId === null ? '-' : `group:${proposal.groupId}`}\t(${proposal.id})`;

const referenceHint = (operation: string, proposalId: string, lead: string): string =>
  changeProposalCreatedKind(operation) === null ? '' : `${lead}$proposal:${proposalId}`;

const groupReceiptLines = (group: ChangeProposalGroupKeyReceipt): string => [
  `group ${group.id}: ${group.title} [${group.status}]`,
  `created: ${group.createdAt}`,
  `expires: ${group.expiresAt}`,
  `items: ${String(group.items.length)}`,
  ...group.items.map((item, index) => `  ${String(index + 1)}. ${item.operation} [${item.status}] ${item.target.kind}:${item.target.id ?? '(new)'} (${item.id})${referenceHint(item.operation, item.id, '; refer to what it creates as ')}`),
].join('\n');

const proposedLines = (value: ChangeProposalProposedOutput): string => [
  'proposed, waiting for the owner\'s decision:',
  receiptLines(value.proposal),
  ...(value.group === undefined ? [] : [
    `group: ${value.group.title} (${value.group.id}), item ${String(value.group.items.length)}`,
    ...(changeProposalCreatedKind(value.proposal.operation) === null ? [] : [referenceHint(value.proposal.operation, value.proposal.id, 'refer to what this item creates as ')]),
  ]),
].join('\n');

type ProposableResult<A> = ChangeProposalProposedOutput | ({ outcome: 'applied' } & A);

type StagedAttachResult = (ChangeProposalProposedOutput | { outcome: 'applied'; asset: ProductDownloadAssetMetadata }) & { staged: KeyDownloadStagedFileView };

const attachedOrProposedLines = (data: StagedAttachResult): string => isProposedChange(data)
  ? [proposedLines(data), `file: ${stagedFileLine(data.staged, 'kept while the proposal is pending').slice(2)}`, 'the file stays private until the owner approves this proposal; nothing reaches buyers before that'].join('\n')
  : [`attached: ${downloadAssetLine(data.asset).slice(2)}`, `staged as: ${stagedFileLine(data.staged).slice(2)}`].join('\n');

const BRANDING_FIELDS = {
  logo: 'logoUrl',
  'logo-dark': 'logoDarkUrl',
  favicon: 'faviconUrl',
  'share-image': 'ogImageUrl',
} as const satisfies Record<z.output<typeof brandingKindSchema>, string>;

interface UploadedImage {
  url: string;
  quarantined?: true | undefined;
}

type BrandingUploadResult =
  | (UploadedImage & { field: string })
  | (ProposableResult<{ settings: unknown }> & { image: UploadedImage });

const quarantinedImageLine = (image: UploadedImage): string => image.quarantined === true
  ? `image: ${image.url} (private until the owner approves this proposal; published at this address on approval)`
  : `image: ${image.url}`;

const uploadedBrandingLines = (image: UploadedImage & { field: string }): string => image.quarantined === true
  ? [
      image.url,
      `quarantined: private until the owner approves a proposal that sets it; propose it with --attach on this command, or with: echo '${JSON.stringify({ [image.field]: image.url })}' | together shop settings set --json-file -`,
    ].join('\n')
  : image.url;

export const registerShopKeyCommands = (
  program: Command,
  context: () => Result<ShopCliContext, AppError>,
  createClient: ShopClientFactory = createShopManagementClient,
): void => {
  const shop = (program.commands.find((command) => command.name() === 'shop') ?? program.command('shop'))
    .description(`Plan, apply and detect drift from a declarative shop manifest, or manage the shop catalog, orders, settings and integrations with a shop management key read from an environment variable (default ${DEFAULT_SHOP_KEY_ENV})`);
  const run = <S extends z.ZodTypeAny, T>(
    schema: S,
    action: (client: ShopManagementClient, input: z.output<S>, proposal: ProposalRequestOptions) => Promise<Result<T, AppError>> | Result<T, AppError>,
    format: (value: T) => string,
  ) => async (...args: unknown[]): Promise<void> => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
    const raw = args.slice(0, -1);
    const keyEnv = keyEnvSchema.safeParse(raw.at(-1));
    if (!keyEnv.success) { emit(err(validation('Invalid --api-key-env option')), ctx.value.json, () => ''); return; }
    const group = proposalGroupOptionSchema.safeParse(raw.at(-1));
    if (!group.success) { emit(err(validation('Invalid --group option', group.error.flatten())), ctx.value.json, () => ''); return; }
    const apiKey = process.env[keyEnv.data.apiKeyEnv]?.trim();
    if (!apiKey) {
      emit(err(validation(`Environment variable ${keyEnv.data.apiKeyEnv} must hold the shop management key`)), ctx.value.json, () => '');
      return;
    }
    const input = schema.safeParse(raw);
    if (!input.success) { emit(err(validation('Invalid shop command options', input.error.flatten())), ctx.value.json, () => ''); return; }
    const client = createClient({
      baseUrl: ctx.value.apiUrl,
      apiKey,
      ...(ctx.value.tenant === null ? {} : { tenant: ctx.value.tenant }),
    });
    emit(await action(client, input.data, group.data.group === undefined ? {} : { groupId: group.data.group }), ctx.value.json, format);
  };
  const runProposable = <S extends z.ZodTypeAny, A extends object>(
    schema: S,
    action: (client: ShopManagementClient, input: z.output<S>, proposal: ProposalRequestOptions) => Promise<Result<ProposableResult<A>, AppError>> | Result<ProposableResult<A>, AppError>,
    format: (value: A) => string,
  ) => run(schema, action, (value: ProposableResult<A>) => isProposedChange(value) ? proposedLines(value) : format(value));
  const keyed = (command: Command): Command =>
    command.option('--api-key-env <name>', 'Environment variable holding the shop management key', DEFAULT_SHOP_KEY_ENV);
  const proposableKeyed = (command: Command): Command => keyed(command)
    .option('--group <id>', 'propose-mode key: add the proposal to this change proposal group; an id argument or field may then name what an earlier item creates as \'$proposal:<proposal id>\'');
  const withProductFields = (command: Command): Command => command
    .option('--visibility <visibility>', 'listed or unlisted')
    .option('--sales-channel <channel>', 'any or sales_links_only (sold only as part of a sales link)')
    .option('--delivery-method <method>', 'pickup or shipping (physical products only)')
    .option('--parcel-template <size>', 'InPost parcel size: small, medium or large')
    .option('--vat-rate <rate>', '5, 8, 23 or exempt')
    .option('--vat-exemption-basis <text>', 'legal basis for VAT exemption')
    .option('--description <description>')
    .option('--cover-url <url>', 'absolute cover image URL')
    .option('--images-file <path>', 'JSON file with the ordered gallery, e.g. [{"url":"/api/public/assets/product-image/<file>","alt":"Front view"}], or - for stdin; [] removes every gallery image')
    .option('--compliance <json>', 'product safety information (GPSR) as a JSON object; with manufacturerOutsideEu true it needs responsiblePersonName, responsiblePersonAddress and responsiblePersonEmail')
    .option('--personalization-file <path>', 'JSON file with the buyer personalisation the product offers at checkout')
    .option('--no-personalization', 'offer no buyer personalisation')
    .option('--variant-group <slug>', 'products sharing a variant group are offered as variants of each other')
    .option('--variant-label <label>', 'label of this product in its variant group');

  const products = shop.command('products').description('Products of the key\'s workspace');
  keyed(products.command('list').description('List products with their stock'))
    .action(run(z.tuple([keyOnlySchema]), (client) => client.listProducts(), (data) =>
      data.products.length === 0
        ? 'no products'
        : data.products.map((product) => {
            const stock = data.stock.find((entry) => entry.productId === product.id);
            return `- ${product.title}  ${String(product.priceCents)} ${product.currency}  [${product.published ? 'published' : 'draft'}]${stock === undefined ? '' : `  {${formatProductStock(stock)}}`}  (${product.id.slice(0, 8)})`;
          }).join('\n')));
  proposableKeyed(withProductFields(products.command('create').description('Create a product draft')
    .requiredOption('--title <title>')
    .option('--type <type>', 'course, digital_download, membership or physical')
    .option('--slug <slug>', 'tenant-unique product slug')
    .option('--price-cents <cents>', 'price in integer cents')
    .option('--price <amount>', 'price in currency units, e.g. 199 or 199.99')
    .option('--currency <currency>', '3-letter uppercase currency code')
    .option('--access-items <json>', 'inline JSON access items')))
    .action(runProposable(z.tuple([productCreateSchema]), async (client, [options], proposal) => {
      const input = await shopProductCreateInput(options);
      return input.ok ? client.createProduct(input.value, undefined, proposal) : input;
    }, (data) => `created: ${productLine(data.product)}`));
  proposableKeyed(withProductFields(products.command('update <id>').description('Update product fields')
    .option('--title <title>')
    .option('--clear-cover', 'remove the current cover image')
    .option('--clear-variant', 'remove the variant group and label')))
    .action(runProposable(z.tuple([idSchema, productUpdateSchema]), async (client, [id, options], proposal) => {
      const input = await shopProductUpdateInput(id, options);
      return input.ok ? client.updateProduct(input.value, undefined, proposal) : input;
    }, (data) => `updated: ${productLine(data.product)}`));
  proposableKeyed(products.command('access <productId>').description('Propose replacing the whole list of what a product grants (propose-mode key only; a direct-mode key is refused); once the owner approves, everyone with access to the product, current buyers included, gets the new list. --course alone grants whole courses; with one --course, --module grants those modules and --lesson those lessons, each wherever it is used')
    .option('--course <id>', 'a course the product grants; repeat for several whole courses', repeatable, [])
    .option('--module <id>', 'a module of the one --course to grant instead of the whole course; repeatable', repeatable, [])
    .option('--lesson <id>', 'a lesson of the one --course to grant instead of the whole course; repeatable', repeatable, [])
    .option('--exclude-module <id>', 'a module of the one whole --course the product does not grant; repeatable', repeatable, [])
    .option('--access-items <json>', 'the whole list as inline JSON access items, for a shape the other options cannot state')
    .option('--clear', 'the product grants no course, module or lesson'))
    .action(runProposable(z.tuple([idSchema, productAccessSchema]), (client, [id, options], proposal) => {
      const accessItems = shopProductAccessItems(options);
      return accessItems.ok ? client.setProductAccess({ id, accessItems: accessItems.value }, undefined, proposal) : accessItems;
    }, (data) => `access: ${productLine(data.product)} (${String(data.product.accessItems.length)} item(s))`));
  proposableKeyed(products.command('publish <id>').description('Publish a product'))
    .action(runProposable(z.tuple([idSchema, keyOnlySchema]), (client, [id], proposal) => client.publishProduct({ id }, undefined, proposal), (data) => `published: ${productLine(data.product)}`));
  proposableKeyed(products.command('unpublish <id>').description('Return a published product to draft'))
    .action(runProposable(z.tuple([idSchema, keyOnlySchema]), (client, [id], proposal) => client.unpublishProduct({ id }, undefined, proposal), (data) => `unpublished: ${productLine(data.product)}`));
  proposableKeyed(products.command('delete <id>').description('Permanently delete an eligible product draft').option('--confirm', 'confirm permanent deletion'))
    .action(runProposable(z.tuple([idSchema, keyOnlySchema.extend({ confirm: z.boolean().optional() })]), (client, [productId, options], proposal) =>
      options.confirm === true ? client.deleteProductDraft({ productId }, undefined, proposal) : err(validation('Product deletion requires --confirm')),
    () => 'deleted product draft'));

  const prices = shop.command('prices').description('Product prices of the key\'s workspace');
  keyed(prices.command('list').description('List the prices of a product').requiredOption('--product <id>'))
    .action(run(z.tuple([keyOnlySchema.extend({ product: idSchema })]), (client, [options]) => client.listProductPrices(options.product), (data) =>
      data.prices.length === 0 ? 'no prices' : data.prices.map(formatPrice).join('\n')));
  proposableKeyed(prices.command('add').description('Add a price to a product')
    .requiredOption('--product <id>')
    .requiredOption('--kind <kind>', 'one_time or recurring')
    .option('--interval <interval>', 'month or year (required for recurring)')
    .option('--price-cents <cents>', 'amount in integer cents')
    .option('--price <amount>', 'amount in currency units, e.g. 199 or 199.99')
    .option('--currency <currency>', '3-letter uppercase currency code'))
    .action(runProposable(z.tuple([priceAddSchema]), async (client, [options], proposal) => {
      const input = shopPriceCreateInput(options);
      return input.ok ? client.createProductPrice(input.value, undefined, proposal) : input;
    }, (data) => `created price: ${formatPrice(data.price)}`));
  proposableKeyed(prices.command('deactivate <id>').description('Deactivate a price (existing subscriptions keep renewing)'))
    .action(runProposable(z.tuple([idSchema, keyOnlySchema]), (client, [id], proposal) => client.deactivateProductPrice({ id }, undefined, proposal), (data) => `deactivated price: ${formatPrice(data.price)}`));

  const stock = shop.command('stock').description('Stock of a physical product');
  keyed(stock.command('show <productId>').description('Show on hand, reserved and available pieces'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [productId]) => client.getProductStock(productId), (data) =>
      data.stock === null ? 'stock is not tracked for this product' : describeStock(data.stock)));
  proposableKeyed(stock.command('enable <productId>').description('Start tracking stock for a product')
    .requiredOption('--on-hand <count>', 'pieces on hand')
    .option('--threshold <count>', 'low-stock e-mail threshold'))
    .action(runProposable(z.tuple([idSchema, keyOnlySchema.extend({ onHand: countSchema, threshold: countSchema.optional() })]), (client, [productId, options], proposal) =>
      client.enableProductStock({ productId, onHand: options.onHand, lowStockThreshold: options.threshold ?? null }, undefined, proposal),
    (data) => `stock tracking enabled: ${describeStock(data.stock)}`));
  proposableKeyed(stock.command('adjust <productId>').description('Add or remove pieces on hand; use the reason "returned" for goods put back')
    .requiredOption('--delta <count>', 'signed change, e.g. 5 or -1')
    .requiredOption('--reason <text>', 'why the stock changed'))
    .action(runProposable(z.tuple([idSchema, keyOnlySchema.extend({ delta: deltaSchema, reason: z.string().trim().min(1).max(200) })]), (client, [productId, options], proposal) =>
      client.adjustProductStock({ productId, delta: options.delta, reason: options.reason }, undefined, proposal),
    (data) => `stock adjusted: ${describeStock(data.stock)}`));
  proposableKeyed(stock.command('threshold <productId>').description('Set the low-stock e-mail threshold, or "none" to clear it')
    .requiredOption('--value <count>', 'threshold or none'))
    .action(runProposable(z.tuple([idSchema, keyOnlySchema.extend({ value: z.union([z.literal('none').transform(() => null), countSchema]) })]), (client, [productId, options], proposal) =>
      client.setProductStockThreshold({ productId, lowStockThreshold: options.value }, undefined, proposal),
    (data) => `low-stock threshold updated: ${describeStock(data.stock)}`));

  const orders = shop.command('orders').description('Orders and physical fulfilment of the key\'s workspace');
  const withOrderFilters = (command: Command): Command => command
    .option('--status <status>', 'paid, pending, failed, refunded or partially_refunded')
    .option('--product <id>')
    .option('--kind <kind>', 'one_time or recurring')
    .option('--coupon <id>')
    .option('--fulfilment <status>', 'to_pack (paid orders that still need shipping) or shipped')
    .option('--source <utm_source|none>', 'filter by campaign source or no attribution')
    .option('--source-exact', 'treat --source literally, including the campaign source none')
    .option('--search <text>', 'search by member e-mail or name');
  keyed(withOrderFilters(orders.command('list').description('List orders with filters and paging; use --mode live for fulfilment automation'))
    .option('--mode <mode>', 'live or test (default: both)')
    .option('--page <n>')
    .option('--page-size <n>'))
    .action(run(z.tuple([ordersListSchema]), (client, [options]) =>
      client.listOrders({
        ...orderFilters(options),
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        ...(options.page === undefined ? {} : { page: options.page }),
        ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
      }),
    (data) => data.orders.length === 0
      ? `no orders (total ${String(data.total)})`
      : [...data.orders.map(orderLine), `page ${String(data.page)}/${String(Math.max(1, Math.ceil(data.total / data.pageSize)))} — ${String(data.total)} order(s)`].join('\n')));
  keyed(withOrderFilters(orders.command('export').description('Export live orders as CSV or JSON'))
    .requiredOption('--format <format>', 'csv or json')
    .option('--out <file>', 'write the export to a file instead of stdout'))
    .action(run(z.tuple([ordersExportSchema]), async (client, [options]) =>
      writeExport(await client.exportOrders({ ...orderFilters(options), format: options.format }), options.out),
    exportSummary));
  keyed(orders.command('packing-list').description('Export the orders to pack as a CSV packing list')
    .requiredOption('--format <format>', 'csv')
    .option('--fulfilment <status>', 'to_pack (default) or shipped')
    .option('--mode <mode>', 'live (default) or test')
    .option('--out <file>', 'write the packing list to a file instead of stdout'))
    .action(run(z.tuple([packingListSchema]), async (client, [options]) =>
      writeExport(await client.ordersPackingList({
        format: options.format,
        mode: options.mode,
        ...(options.fulfilment === undefined ? {} : { fulfilmentStatus: options.fulfilment }),
      }), options.out),
    exportSummary));
  keyed(orders.command('verify <reference>').description('Verify an order by QR token or order number'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [reference]) => client.verifyOrder({ reference }), (data) => JSON.stringify(data.order, null, 2)));
  keyed(orders.command('show <orderId>').description('Show one order with its current invoice'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [orderId]) => client.getOrder(orderId), (data) => JSON.stringify(data, null, 2)));
  keyed(orders.command('ship <orderId>').description('Mark a paid order to pack as shipped and e-mail the buyer the tracking number')
    .requiredOption('--carrier <carrier>', 'inpost or other')
    .requiredOption('--tracking <number>', 'parcel tracking number, 4-64 characters'))
    .action(run(z.tuple([idSchema, shipSchema]), (client, [orderId, options]) =>
      client.shipOrder({ orderId, carrier: options.carrier, trackingNumber: options.tracking }),
    (data) => `shipped: ${data.order.id} (${data.order.shipment?.carrier ?? ''} ${data.order.shipment?.trackingNumber ?? ''})`));
  keyed(orders.command('issue <orderId> <productId>').description('Record collection of a physical order line')
    .option('--count <n>', 'units handed over now (default 1, at most the units not yet issued)'))
    .action(run(z.tuple([idSchema, idSchema, issueSchema]), (client, [orderId, productId, options]) =>
      client.issueOrderLine({ orderId, productId, ...(options.count === undefined ? {} : { count: options.count }) }),
    (data) => JSON.stringify(data.order, null, 2)));

  const shipx = orders.command('shipx').description('InPost ShipX shipments and labels');
  keyed(shipx.command('show <orderId>').description('Show whether the order can use InPost ShipX and its stored shipment'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [orderId]) => client.shipxShipment({ orderId }), shipxOrderLines));
  keyed(shipx.command('create <orderId>').description('Create and pay the InPost shipment, then mark the order as shipped'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [orderId]) => client.shipxCreate({ orderId }), (data) =>
      `shipped: ${data.order.id} (inpost ${data.shipment.trackingNumber ?? ''})`));
  keyed(shipx.command('refresh <orderId>').description('Read the live ShipX status of a shipment not yet paid, store it and show the order'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [orderId]) => client.shipxRefresh({ orderId }), shipxOrderLines));
  keyed(shipx.command('discard <orderId>').description('Discard an InPost attempt that ShipX did not confirm, after checking Manager Paczek; this never cancels a shipment in ShipX'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [orderId]) => client.shipxDiscard({ orderId }), () => 'discarded the unconfirmed InPost attempt'));
  keyed(shipx.command('label <orderId>').description('Download the A6 PDF label of the InPost shipment')
    .requiredOption('--out <file>', 'write the PDF label to this file'))
    .action(run(z.tuple([idSchema, labelSchema]), async (client, [orderId, options]) => {
      const result = await client.shipxLabel({ orderId });
      if (!result.ok) return result;
      await writeFile(options.out, result.value.bytes);
      return ok({ filename: result.value.filename, contentType: result.value.contentType, bytes: result.value.bytes.byteLength, out: options.out });
    }, (file) => `wrote ${file.filename} (${String(file.bytes)} bytes) to ${file.out}`));

  const settings = shop.command('settings').description('Shop settings of the key\'s workspace: brand, legal, seller, invoicing and shipping');
  keyed(settings.command('show').description('Show the shop settings'))
    .action(run(z.tuple([keyOnlySchema]), (client) => client.getSettings(), (data) => JSON.stringify(data.settings, null, 2)));
  proposableKeyed(settings.command('set').description('Change the shop settings fields given in a JSON object; omitted fields keep their value and null clears a clearable field')
    .requiredOption('--json-file <path>', 'JSON file with the changed fields, or - to read it from stdin'))
    .action(runProposable(z.tuple([settingsSetSchema]), async (client, [options], proposal) => {
      const input = await shopSettingsPatchInput(options.jsonFile);
      return input.ok ? client.updateSettings(input.value, undefined, proposal) : input;
    }, (data) => JSON.stringify(data.settings, null, 2)));

  const branding = shop.command('branding').description('Brand images of the key\'s workspace');
  proposableKeyed(branding.command('upload <kind> <file>').description('Upload a logo, logo-dark, favicon or share-image file and print its URL for shop settings set; with --attach, also set it as the workspace image of that kind. A propose-mode key\'s image stays private until the owner approves the proposal that attaches it')
    .option('--attach', 'set the uploaded image as the logo, dark logo, favicon or share image (a propose-mode key proposes this change)'))
    .action(run(z.tuple([brandingKindSchema, z.string().min(1), keyOnlySchema.extend({ attach: z.boolean().optional() })]), async (client, [kind, file, options], proposal): Promise<Result<BrandingUploadResult, AppError>> => {
      const input = await imageUploadInput(kind, file);
      if (!input.ok) return input;
      const uploaded = await client.uploadBrandingAsset(input.value);
      if (!uploaded.ok) return uploaded;
      if (options.attach !== true) return ok({ ...uploaded.value, field: BRANDING_FIELDS[kind] });
      const patch = contractInput(shopSettingsContracts.updateSettings.input, { [BRANDING_FIELDS[kind]]: uploaded.value.url }, 'Invalid shop settings');
      if (!patch.ok) return patch;
      const attached = await client.updateSettings(patch.value, undefined, proposal);
      return attached.ok ? ok({ ...attached.value, image: uploaded.value }) : attached;
    }, (data) => {
      if (!('outcome' in data)) return uploadedBrandingLines(data);
      return isProposedChange(data) ? [proposedLines(data), quarantinedImageLine(data.image)].join('\n') : JSON.stringify(data.settings, null, 2);
    }));

  const cover = shop.command('cover').description('Product cover images');
  proposableKeyed(cover.command('upload <productId> <file>').description('Check that the product exists (needs shop:catalog:read; with --group, a $proposal: reference is not checked), upload a product cover and attach the completed image to the product; a propose-mode key proposes the attachment, and its image stays private until the owner approves it'))
    .action(run(z.tuple([idSchema, z.string().min(1), keyOnlySchema]), async (client, [id, file], proposal) => {
      const input = await imageUploadInput('product-cover', file);
      if (!input.ok) return input;
      if (proposal.groupId === undefined || !isChangeProposalReference(id)) {
        const product = await client.listProductPrices(id);
        if (!product.ok) return product;
      }
      const uploaded = await client.uploadProductCover(input.value);
      if (!uploaded.ok) return uploaded;
      const attached = await client.updateProduct({ id, coverUrl: uploaded.value.url }, undefined, proposal);
      return attached.ok ? ok({ ...attached.value, image: uploaded.value }) : attached;
    }, (data) => isProposedChange(data)
      ? [proposedLines(data), quarantinedImageLine(data.image)].join('\n')
      : JSON.stringify(data.product, null, 2)));

  const attachStaged = async (
    client: ShopManagementClient,
    productId: string,
    staged: KeyDownloadStagedFileView,
    options: { replaces?: string | undefined; note?: string | undefined },
    proposal: ProposalRequestOptions,
  ): Promise<Result<StagedAttachResult, AppError>> => {
    const note = options.note === undefined ? {} : { versionNote: options.note };
    const attached = options.replaces === undefined
      ? await client.addProductDownload({ productId, stagedFileId: staged.id, ...note }, undefined, proposal)
      : await client.replaceProductDownload({ productId, replacesAssetId: options.replaces, stagedFileId: staged.id, ...note }, undefined, proposal);
    return attached.ok ? ok({ ...attached.value, staged }) : err(withFileHint(attached.error, { stagedId: staged.id, productId }));
  };

  const targetCheck = async (client: ShopManagementClient, productId: string, proposal: ProposalRequestOptions) =>
    proposal.groupId !== undefined && isChangeProposalReference(productId) ? ok(null) : client.listProductDownloads(productId);

  const files = shop.command('files').description('Download files of digital products, staged by the key and attached live, or proposed for the owner\'s approval by a propose-mode key; no command reads back the bytes of a file');
  keyed(files.command('list <productId>').description('List the files of a digital product with their versions'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [productId]) => client.listProductDownloads(productId), (data) =>
      data.assets.length === 0 ? 'no files' : data.assets.map(downloadAssetLine).join('\n')));
  proposableKeyed(files.command('upload <productId> <file>').description('Check that the product exists (needs shop:catalog:read; with --group, a $proposal: reference is not checked), stage the file (upload, PUT with the signed headers, completion) and attach it as a new file or, with --replaces, as the next version of a file; a propose-mode key proposes the attachment, and its file stays private until the owner approves it')
    .option('--replaces <assetId>', 'attach the upload as the next version of this file of the product')
    .option('--note <text>', 'version note shown with the file'))
    .action(run(z.tuple([idSchema, z.string().min(1), fileAttachSchema]), async (client, [productId, file, options], proposal) => {
      const input = await downloadFileInput(file);
      if (!input.ok) return input;
      const product = await targetCheck(client, productId, proposal);
      if (!product.ok) return product;
      const replacement = product.value === null ? ok(undefined) : replacementCheck(product.value.assets, options.replaces);
      if (!replacement.ok) return replacement;
      const staged = await client.stageProductDownload(input.value);
      if (!staged.ok) return err(withFileHint(staged.error));
      return attachStaged(client, productId, staged.value.file, options, proposal);
    }, attachedOrProposedLines));
  proposableKeyed(files.command('copy <fromProductId> <assetId> <toProductId>').description('Copy a ready file of one product on the server and attach the copy to another product; a propose-mode key proposes the attachment; the bytes never pass through this command')
    .option('--note <text>', 'version note shown with the copied file'))
    .action(run(z.tuple([idSchema, idSchema, idSchema, fileNoteSchema]), async (client, [fromProductId, assetId, toProductId, options], proposal) => {
      const target = await targetCheck(client, toProductId, proposal);
      if (!target.ok) return target;
      const staged = await client.copyProductDownload({ productId: fromProductId, assetId });
      if (!staged.ok) return err(withFileHint(staged.error));
      return attachStaged(client, toProductId, staged.value.file, { note: options.note }, proposal);
    }, attachedOrProposedLines));
  proposableKeyed(files.command('remove <productId> <assetId>').description('Remove one file version of a product; buyers can no longer download it. A propose-mode key proposes the removal'))
    .action(runProposable(z.tuple([idSchema, idSchema, keyOnlySchema]), (client, [productId, assetId], proposal) =>
      client.removeProductDownload({ productId, assetId }, undefined, proposal), () => 'removed'));
  keyed(files.command('staged').description('List this key\'s staged files that are not attached yet'))
    .action(run(z.tuple([keyOnlySchema]), (client) => client.listStagedDownloads(), (data) =>
      data.files.length === 0 ? 'no staged files' : data.files.map((file) => stagedFileLine(file)).join('\n')));
  keyed(files.command('discard <id>').description('Discard a staged file of this key and delete its stored copy; a pending proposal that attaches it can then no longer be applied'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.discardStagedDownload(id), () => 'discarded'));

  const images = shop.command('images').description('Product gallery images');
  keyed(images.command('upload <file>').description('Upload a product gallery image and print its URL for --images-file; the image joins a gallery only through products create or update'))
    .action(run(z.tuple([z.string().min(1), keyOnlySchema]), async (client, [file]) => {
      const input = await imageUploadInput('product-image', file);
      return input.ok ? client.uploadProductImage(input.value) : input;
    }, (data) => data.url));

  const salesLinks = shop.command('sales-links').description('Sales links of the key\'s workspace');
  keyed(salesLinks.command('list').description('List sales links'))
    .action(run(z.tuple([keyOnlySchema]), (client) => client.listSalesLinks(), (data) => JSON.stringify(data.salesLinks, null, 2)));
  keyed(salesLinks.command('show <id>').description('Show a sales link and its current revision'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.getSalesLink({ id }), (data) => JSON.stringify(data.salesLink, null, 2)));
  proposableKeyed(salesLinks.command('create').description('Create a sales link from a JSON object')
    .requiredOption('--json-file <path>', 'JSON file with sales-link fields, or - for stdin'))
    .action(runProposable(z.tuple([settingsSetSchema]), async (client, [options], proposal) => {
      const input = await salesLinkFileInput(options.jsonFile, shopAssetsContracts.createSalesLink.input);
      return input.ok ? client.createSalesLink(input.value, undefined, proposal) : input;
    }, (data) => JSON.stringify(data.salesLink, null, 2)));
  proposableKeyed(salesLinks.command('update <id>').description('Replace sales-link fields using expectedRevision from the JSON object')
    .requiredOption('--json-file <path>', 'JSON file with all fields and expectedRevision, or - for stdin'))
    .action(runProposable(z.tuple([idSchema, settingsSetSchema]), async (client, [id, options], proposal) => {
      const input = await salesLinkFileInput(options.jsonFile, shopAssetsContracts.updateSalesLink.input, id);
      return input.ok ? client.updateSalesLink(input.value, undefined, proposal) : input;
    }, (data) => JSON.stringify(data.salesLink, null, 2)));
  proposableKeyed(salesLinks.command('delete <id>').description('Delete a sales link'))
    .action(runProposable(z.tuple([idSchema, keyOnlySchema]), (client, [id], proposal) => client.deleteSalesLink({ id }, undefined, proposal), () => 'deleted'));

  const proposals = shop.command('proposals').description('Change proposals made by a propose-mode key: only that key\'s own proposals, never the live values they change');
  keyed(proposals.command('list').description('List this key\'s proposals, newest first')
    .option('--status <status>', 'pending, applied, rejected, stale, withdrawn, failed, expired, or decided (every proposal no longer waiting)')
    .option('--group <id>', 'only the items of this group')
    .option('--cursor <id>', 'continue after this proposal id')
    .option('--limit <n>', 'proposals per page (1-100, default 50)'))
    .action(run(z.tuple([keyOnlySchema.extend({ status: z.string().optional(), group: z.string().optional(), cursor: z.string().optional(), limit: z.string().optional() })]), (client, [options]) => {
      const query = contractInput(changeProposalListQuerySchema, {
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.group === undefined ? {} : { groupId: options.group }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      }, 'Invalid proposal list options');
      return query.ok ? client.listProposals(query.value) : query;
    }, (data) => [
      ...(data.proposals.length === 0 ? ['no proposals'] : data.proposals.map(receiptLine)),
      ...(data.nextCursor === null ? [] : [`next: --cursor ${data.nextCursor}`]),
    ].join('\n')));
  keyed(proposals.command('show <id>').description('Show one of this key\'s proposals'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.getProposal(id), (data) => receiptLines(data.proposal)));
  keyed(proposals.command('withdraw <id>').description('Withdraw a pending proposal of this key that belongs to no group'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.withdrawProposal(id), (data) => `withdrawn:\n${receiptLines(data.proposal)}`));

  const groups = proposals.command('group').description('Groups of proposals the owner approves or rejects as one unit, applied completely or not at all');
  keyed(groups.command('create').description('Create an open group; add proposals to it with --group <id> on any proposing command')
    .requiredOption('--title <title>', 'what the group does, shown to the owner (at most 500 characters)'))
    .action(run(z.tuple([keyOnlySchema.extend({ title: z.string() })]), (client, [options]) => {
      const input = contractInput(changeProposalGroupCreateInputSchema, { title: options.title }, 'Invalid change proposal group');
      return input.ok ? client.createProposalGroup(input.value) : input;
    }, (data) => `created:\n${groupReceiptLines(data.group)}`));
  keyed(groups.command('show <id>').description('Show one of this key\'s groups with its items in order'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.getProposalGroup(id), (data) => groupReceiptLines(data.group)));
  keyed(groups.command('withdraw <id>').description('Withdraw every item of an open group of this key'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.withdrawProposalGroup(id), (data) => `withdrawn:\n${groupReceiptLines(data.group)}`));

  const integrations = shop.command('integrations').description('Payment, storage, shipping and invoicing integrations; keep a shop:integrations:write key only in a provisioning backend');
  const secrets = integrations.command('secrets').description('Masked integration secrets and the iFirma and KSeF credentials');
  keyed(secrets.command('list').description('List every stored secret as a masked preview'))
    .action(run(z.tuple([keyOnlySchema]), (client) => client.listIntegrationSecrets(), (data) =>
      [
        ...data.secrets.map((secret) => `- ${secret.key}  ${secret.maskedPreview}  (${secret.updatedAt})`),
        `stripe mode: ${data.stripeMode ?? '(not configured)'}`,
        `stripe webhook URL: ${data.stripeWebhookUrl}`,
      ].join('\n')));
  keyed(secrets.command('set <key>').description('Store an iFirma or KSeF credential read from --value-env or stdin, never from the command line')
    .option('--value-env <name>', 'environment variable holding the value (default: read stdin)'))
    .action(run(z.tuple([z.string(), secretSetSchema]), async (client, [key, options]) => {
      const value = await secretInput(options.valueEnv, `${key} value`);
      if (!value.ok) return value;
      const input = contractInput(shopIntegrationContracts.setSecret.input, { key, value: value.value }, 'Invalid integration secret');
      return input.ok ? client.setIntegrationSecret(input.value) : input;
    }, (data) => `stored ${data.secret.key}: ${data.secret.maskedPreview}`));
  keyed(secrets.command('delete <key>').description('Delete a stored iFirma or KSeF credential'))
    .action(run(z.tuple([z.string(), keyOnlySchema]), (client, [key]) => {
      const input = contractInput(shopIntegrationContracts.deleteSecret.input, { key }, 'Invalid integration secret key');
      return input.ok ? client.deleteIntegrationSecret(input.value) : input;
    }, (data) => `deleted ${data.key}`));

  const stripe = integrations.command('stripe').description('Stripe payments');
  keyed(stripe.command('configure').description('Store a Stripe restricted key read from --restricted-key-env or stdin and register this workspace\'s webhook endpoint')
    .requiredOption('--mode <mode>', 'live or test; must match the restricted key prefix')
    .option('--restricted-key-env <name>', 'environment variable holding the restricted key (default: read stdin)'))
    .action(run(z.tuple([stripeConfigureSchema]), async (client, [options]) => {
      const restrictedKey = await secretInput(options.restrictedKeyEnv, 'Stripe restricted key');
      if (!restrictedKey.ok) return restrictedKey;
      return client.configureStripe({ mode: options.mode, restrictedKey: restrictedKey.value });
    }, (data) => `configured Stripe ${data.mode} mode; webhook ${data.webhookUrl}`));
  keyed(stripe.command('probe').description('Check the permissions of the stored Stripe restricted key')
    .requiredOption('--mode <mode>', 'live or test'))
    .action(run(z.tuple([keyOnlySchema.extend({ mode: stripeModeSchema })]), (client, [options]) => client.probeStripe({ mode: options.mode }), (data) =>
      [...data.checks.map((check) => `- ${check.resource} ${check.permission}: ${check.status}`), `all ok: ${String(data.allOk)}`].join('\n')));

  const storage = integrations.command('storage').description('S3-compatible file storage');
  keyed(storage.command('configure').description('Probe and store an S3-compatible bucket; the secret access key comes from --secret-access-key-env or stdin')
    .requiredOption('--provider <provider>', 'aws_s3, cloudflare_r2, backblaze_b2 or minio')
    .requiredOption('--endpoint <url>')
    .requiredOption('--region <region>')
    .requiredOption('--bucket <bucket>')
    .requiredOption('--access-key-id <id>')
    .option('--secret-access-key-env <name>', 'environment variable holding the secret access key (default: read stdin)'))
    .action(run(z.tuple([storageConfigureSchema]), async (client, [options]) => {
      const secretAccessKey = await secretInput(options.secretAccessKeyEnv, 'secret access key');
      if (!secretAccessKey.ok) return secretAccessKey;
      const input = contractInput(shopIntegrationContracts.storageConfigure.input, {
        provider: options.provider, endpoint: options.endpoint, region: options.region, bucket: options.bucket,
        accessKeyId: options.accessKeyId, secretAccessKey: secretAccessKey.value,
      }, 'Invalid storage configuration');
      return input.ok ? client.configureStorage(input.value) : input;
    }, (data) => `stored storage configuration: ${data.diagnostic.message}`));

  const shipxSettings = integrations.command('shipx').description('InPost ShipX sender and the sandbox and production connections');
  keyed(shipxSettings.command('show').description('Show the sending method, sender and masked credentials of both ShipX connections'))
    .action(run(z.tuple([keyOnlySchema]), (client) => client.getShipxSettings(), shipxSettingsLines));
  keyed(shipxSettings.command('configure').description('Change the ShipX sender, sending method or credentials; omitted parts keep their value')
    .option('--sending-method <method>', SHIPX_SENDING_METHOD_HELP)
    .option('--sender-json-file <path>', 'JSON file with the sender address, or - for stdin')
    .option('--clear-sender', 'remove the sender address; InPost then uses the organization data')
    .option('--slot <slot>', 'connection the credential options change: production (paid orders) or sandbox (test-mode orders)')
    .option('--organization-id <id>', 'ShipX organization id of the --slot connection')
    .option('--token-env <name>', 'environment variable holding the ShipX token of the --slot connection')
    .option('--token-stdin', 'read the ShipX token of the --slot connection from stdin')
    .option('--clear-credentials', 'remove the stored organization id and token of the --slot connection'))
    .action(run(z.tuple([shipxConfigureSchema]), async (client, [options]) => {
      const input = await shipxConfigureInput(options);
      return input.ok ? client.configureShipx(input.value) : input;
    }, shipxSettingsLines));
};
