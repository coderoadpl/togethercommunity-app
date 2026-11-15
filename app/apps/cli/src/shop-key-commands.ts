import type { Command } from 'commander';
import { z } from 'zod';

import {
  createShopManagementClient,
  type ShopManagementClient,
  type ShopManagementClientOptions,
} from '#core/client/index.js';
import { shopCatalogContracts } from '#core/contract/index.js';
import {
  currencySchema,
  deliveryMethodSchema,
  err,
  ok,
  parcelTemplateSchema,
  priceMajorSchema,
  productVisibilitySchema,
  validation,
  type AppError,
  type ProductPrice,
  type ProductStock,
  type Result,
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
  const shop = (program.commands.find((command) => command.name() === 'shop') ?? program.command('shop'))
    .description(`Plan, apply and detect drift from a declarative shop manifest, or manage the shop catalog with a shop management key read from an environment variable (default ${DEFAULT_SHOP_KEY_ENV})`);
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
};
