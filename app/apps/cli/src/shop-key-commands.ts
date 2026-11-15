import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import type { Command } from 'commander';
import { z } from 'zod';

import {
  createShopManagementClient,
  type ShopManagementClient,
  type ShopManagementClientOptions,
} from '#core/client/index.js';
import { shopCatalogContracts, shopSettingsContracts } from '#core/contract/index.js';
import {
  currencySchema,
  deliveryMethodSchema,
  err,
  fulfilmentStatusSchema,
  IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION,
  ok,
  parcelTemplateSchema,
  priceKindSchema,
  priceMajorSchema,
  productVisibilitySchema,
  shippingCarrierSchema,
  stripeModeSchema,
  validation,
  type AppError,
  type OrderListItem,
  type ProductPrice,
  type ProductStock,
  type Result,
  type ShipxOrderView,
} from '#core/domain/index.js';

import { emit } from './output.js';
import { formatProductStock } from './stock-commands.js';

export const DEFAULT_SHOP_KEY_ENV = 'TOGETHER_SHOP_KEY';

type ShopCliContext = { apiUrl: string; tenant: string | null; json: boolean };
type ShopClientFactory = (options: ShopManagementClientOptions) => ShopManagementClient;

const keyEnvSchema = z.object({ apiKeyEnv: z.string().min(1).default(DEFAULT_SHOP_KEY_ENV) }).passthrough();
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
  deliveryMethod: deliveryMethodSchema.optional(),
  parcelTemplate: parcelTemplateSchema.optional(),
  description: z.string().optional(),
  coverUrl: z.string().url().optional(),
  compliance: z.string().optional(),
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
const labelSchema = keyOnlySchema.extend({ out: z.string().min(1) });
const settingsSetSchema = keyOnlySchema.extend({ jsonFile: z.string().min(1) });
const brandingKindSchema = z.enum(['logo', 'logo-dark', 'favicon', 'share-image']);
const imageExtensionSchema = z.enum(['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'])
  .transform((extension) => IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION[extension === 'jpeg' ? 'jpg' : extension]);

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
};

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

const brandingUploadInput = async (kind: z.output<typeof brandingKindSchema>, file: string) => {
  const contentType = imageExtensionSchema.safeParse(extname(file).slice(1).toLowerCase());
  if (!contentType.success) return err(validation('The image file must end in .png, .jpg, .jpeg, .webp, .svg or .ico'));
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch (cause) {
    return err(validation(`Could not read the image file "${file}": ${String(cause)}`));
  }
  const input = contractInput(shopSettingsContracts.brandingAssetUpload.input, {
    kind, fileName: basename(file), contentType: contentType.data, sizeBytes: bytes.byteLength,
  }, 'Invalid branding image');
  return input.ok ? ok({ ...input.value, body: bytes }) : input;
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
  `${order.createdAt}\t${order.status}\t${order.mode ?? 'live'}\t${order.fulfilmentStatus ?? '-'}\t${String(order.amountCents)} ${order.currency}\t${order.productTitle}\t${order.memberEmail}\t(${order.id})`;

const shipxOrderLines = (view: ShipxOrderView): string => [
  `available: ${String(view.available)}${view.reason === null ? '' : ` (${view.reason})`}`,
  `service: ${view.service ?? '(none)'}`,
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

const sharedProductFields = (options: z.output<typeof productFieldsSchema>, compliance: unknown) => ({
  vatRate: options.vatRate,
  vatExemptionBasis: options.vatExemptionBasis,
  visibility: options.visibility,
  deliveryMethod: options.deliveryMethod,
  parcelTemplate: options.parcelTemplate,
  description: options.description,
  coverUrl: options.coverUrl,
  compliance,
  variantGroup: options.variantGroup,
  variantLabel: options.variantLabel,
});

const shopProductCreateInput = (options: z.output<typeof productCreateSchema>) => {
  const priceCents = singleAmount(options.price, options.priceCents, 'a price');
  if (!priceCents.ok) return priceCents;
  const compliance = inlineJson(options.compliance, 'product safety information');
  if (!compliance.ok) return compliance;
  const accessItems = inlineJson(options.accessItems, 'access items');
  if (!accessItems.ok) return accessItems;
  return contractInput(shopCatalogContracts.createProduct.input, {
    ...sharedProductFields(options, compliance.value),
    title: options.title,
    priceCents: priceCents.value,
    type: options.type,
    slug: options.slug,
    currency: options.currency,
    accessItems: accessItems.value,
  }, 'Invalid product');
};

const shopProductUpdateInput = (id: string, options: z.output<typeof productUpdateSchema>) => {
  if (options.coverUrl !== undefined && options.clearCover) return err(validation('Provide only one of --cover-url and --clear-cover'));
  if (options.clearVariant && (options.variantGroup !== undefined || options.variantLabel !== undefined)) {
    return err(validation('Provide only one of --clear-variant and --variant-group/--variant-label'));
  }
  const compliance = inlineJson(options.compliance, 'product safety information');
  if (!compliance.ok) return compliance;
  return contractInput(shopCatalogContracts.updateProduct.input, {
    ...sharedProductFields(options, compliance.value),
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

export const registerShopKeyCommands = (
  program: Command,
  context: () => Result<ShopCliContext, AppError>,
  createClient: ShopClientFactory = createShopManagementClient,
): void => {
  const shop = program.command('shop').description(`Manage the shop catalog, orders and settings with a shop management key read from an environment variable (default ${DEFAULT_SHOP_KEY_ENV})`);
  const run = <S extends z.ZodTypeAny, T>(
    schema: S,
    action: (client: ShopManagementClient, input: z.output<S>) => Promise<Result<T, AppError>> | Result<T, AppError>,
    format: (value: T) => string,
  ) => async (...args: unknown[]): Promise<void> => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
    const raw = args.slice(0, -1);
    const keyEnv = keyEnvSchema.safeParse(raw.at(-1));
    if (!keyEnv.success) { emit(err(validation('Invalid --api-key-env option')), ctx.value.json, () => ''); return; }
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
    emit(await action(client, input.data), ctx.value.json, format);
  };
  const keyed = (command: Command): Command =>
    command.option('--api-key-env <name>', 'Environment variable holding the shop management key', DEFAULT_SHOP_KEY_ENV);
  const withProductFields = (command: Command): Command => command
    .option('--visibility <visibility>', 'listed or unlisted')
    .option('--delivery-method <method>', 'pickup or shipping (physical products only)')
    .option('--parcel-template <size>', 'InPost parcel size: small, medium or large')
    .option('--vat-rate <rate>', '5, 8, 23 or exempt')
    .option('--vat-exemption-basis <text>', 'legal basis for VAT exemption')
    .option('--description <description>')
    .option('--cover-url <url>', 'absolute cover image URL')
    .option('--compliance <json>', 'product safety information (GPSR) as a JSON object')
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
  keyed(withProductFields(products.command('create').description('Create a product draft')
    .requiredOption('--title <title>')
    .option('--type <type>', 'course, digital_download, membership or physical')
    .option('--slug <slug>', 'tenant-unique product slug')
    .option('--price-cents <cents>', 'price in integer cents')
    .option('--price <amount>', 'price in currency units, e.g. 199 or 199.99')
    .option('--currency <currency>', '3-letter uppercase currency code')
    .option('--access-items <json>', 'inline JSON access items')))
    .action(run(z.tuple([productCreateSchema]), async (client, [options]) => {
      const input = shopProductCreateInput(options);
      return input.ok ? client.createProduct(input.value) : input;
    }, (data) => `created: ${productLine(data.product)}`));
  keyed(withProductFields(products.command('update <id>').description('Update product fields')
    .option('--title <title>')
    .option('--clear-cover', 'remove the current cover image')
    .option('--clear-variant', 'remove the variant group and label')))
    .action(run(z.tuple([idSchema, productUpdateSchema]), async (client, [id, options]) => {
      const input = shopProductUpdateInput(id, options);
      return input.ok ? client.updateProduct(input.value) : input;
    }, (data) => `updated: ${productLine(data.product)}`));
  keyed(products.command('publish <id>').description('Publish a product'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.publishProduct({ id }), (data) => `published: ${productLine(data.product)}`));
  keyed(products.command('unpublish <id>').description('Return a published product to draft'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.unpublishProduct({ id }), (data) => `unpublished: ${productLine(data.product)}`));
  keyed(products.command('delete <id>').description('Permanently delete an eligible product draft').option('--confirm', 'confirm permanent deletion'))
    .action(run(z.tuple([idSchema, keyOnlySchema.extend({ confirm: z.boolean().optional() })]), (client, [productId, options]) =>
      options.confirm === true ? client.deleteProductDraft({ productId }) : err(validation('Product deletion requires --confirm')),
    () => 'deleted product draft'));

  const prices = shop.command('prices').description('Product prices of the key\'s workspace');
  keyed(prices.command('list').description('List the prices of a product').requiredOption('--product <id>'))
    .action(run(z.tuple([keyOnlySchema.extend({ product: idSchema })]), (client, [options]) => client.listProductPrices(options.product), (data) =>
      data.prices.length === 0 ? 'no prices' : data.prices.map(formatPrice).join('\n')));
  keyed(prices.command('add').description('Add a price to a product')
    .requiredOption('--product <id>')
    .requiredOption('--kind <kind>', 'one_time or recurring')
    .option('--interval <interval>', 'month or year (required for recurring)')
    .option('--price-cents <cents>', 'amount in integer cents')
    .option('--price <amount>', 'amount in currency units, e.g. 199 or 199.99')
    .option('--currency <currency>', '3-letter uppercase currency code'))
    .action(run(z.tuple([priceAddSchema]), async (client, [options]) => {
      const input = shopPriceCreateInput(options);
      return input.ok ? client.createProductPrice(input.value) : input;
    }, (data) => `created price: ${formatPrice(data.price)}`));
  keyed(prices.command('deactivate <id>').description('Deactivate a price (existing subscriptions keep renewing)'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [id]) => client.deactivateProductPrice({ id }), (data) => `deactivated price: ${formatPrice(data.price)}`));

  const stock = shop.command('stock').description('Stock of a physical product');
  keyed(stock.command('show <productId>').description('Show on hand, reserved and available pieces'))
    .action(run(z.tuple([idSchema, keyOnlySchema]), (client, [productId]) => client.getProductStock(productId), (data) =>
      data.stock === null ? 'stock is not tracked for this product' : describeStock(data.stock)));
  keyed(stock.command('enable <productId>').description('Start tracking stock for a product')
    .requiredOption('--on-hand <count>', 'pieces on hand')
    .option('--threshold <count>', 'low-stock e-mail threshold'))
    .action(run(z.tuple([idSchema, keyOnlySchema.extend({ onHand: countSchema, threshold: countSchema.optional() })]), (client, [productId, options]) =>
      client.enableProductStock({ productId, onHand: options.onHand, lowStockThreshold: options.threshold ?? null }),
    (data) => `stock tracking enabled: ${describeStock(data.stock)}`));
  keyed(stock.command('adjust <productId>').description('Add or remove pieces on hand; use the reason "returned" for goods put back')
    .requiredOption('--delta <count>', 'signed change, e.g. 5 or -1')
    .requiredOption('--reason <text>', 'why the stock changed'))
    .action(run(z.tuple([idSchema, keyOnlySchema.extend({ delta: deltaSchema, reason: z.string().trim().min(1).max(200) })]), (client, [productId, options]) =>
      client.adjustProductStock({ productId, delta: options.delta, reason: options.reason }),
    (data) => `stock adjusted: ${describeStock(data.stock)}`));
  keyed(stock.command('threshold <productId>').description('Set the low-stock e-mail threshold, or "none" to clear it')
    .requiredOption('--value <count>', 'threshold or none'))
    .action(run(z.tuple([idSchema, keyOnlySchema.extend({ value: z.union([z.literal('none').transform(() => null), countSchema]) })]), (client, [productId, options]) =>
      client.setProductStockThreshold({ productId, lowStockThreshold: options.value }),
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
  keyed(orders.command('issue <orderId> <productId>').description('Record collection of a physical order line'))
    .action(run(z.tuple([idSchema, idSchema, keyOnlySchema]), (client, [orderId, productId]) => client.issueOrderLine({ orderId, productId }), (data) => JSON.stringify(data.order, null, 2)));

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
  keyed(settings.command('set').description('Change the shop settings fields given in a JSON object; omitted fields keep their value and null clears a clearable field')
    .requiredOption('--json-file <path>', 'JSON file with the changed fields, or - to read it from stdin'))
    .action(run(z.tuple([settingsSetSchema]), async (client, [options]) => {
      const input = await shopSettingsPatchInput(options.jsonFile);
      return input.ok ? client.updateSettings(input.value) : input;
    }, (data) => JSON.stringify(data.settings, null, 2)));

  const branding = shop.command('branding').description('Brand images of the key\'s workspace');
  keyed(branding.command('upload <kind> <file>').description('Upload a logo, logo-dark, favicon or share-image file and print its URL for shop settings set'))
    .action(run(z.tuple([brandingKindSchema, z.string().min(1), keyOnlySchema]), async (client, [kind, file]) => {
      const input = await brandingUploadInput(kind, file);
      return input.ok ? client.uploadBrandingAsset(input.value) : input;
    }, (data) => data.url));
};
