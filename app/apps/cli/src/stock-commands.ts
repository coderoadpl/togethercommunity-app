import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import { err, validation, type AppError, type ProductStock, type Result } from '#core/domain/index.js';

import { emit } from './output.js';

type StockCliContext = {
  api: Pick<ApiClient, 'getProductStock' | 'enableProductStock' | 'adjustProductStock' | 'setProductStockThreshold'>;
  json: boolean;
};

const countSchema = z.string().regex(/^(0|[1-9]\d*)$/, 'Expected a non-negative whole number').transform((value) => Number.parseInt(value, 10));
const deltaSchema = z.string().regex(/^[+-]?[1-9]\d*$/, 'Expected a non-zero whole number such as 5 or -2').transform((value) => Number.parseInt(value, 10));
const productIdSchema = z.string().min(1);

export const formatProductStock = (stock: ProductStock): string =>
  stock.soldOut
    ? `sold out · ${String(stock.onHand)} on hand · ${String(stock.reserved)} reserved`
    : `${String(stock.available)} available · ${String(stock.onHand)} on hand · ${String(stock.reserved)} reserved${stock.low ? ' · low' : ''}`;

const describeStock = (stock: ProductStock): string =>
  `${formatProductStock(stock)}\nlow-stock threshold: ${stock.lowStockThreshold === null ? 'not set' : String(stock.lowStockThreshold)}`;

export const registerStockCommands = (product: Command, context: () => Result<StockCliContext, AppError>): void => {
  const stock = product.command('stock').description('Stock of a physical product (staff only)');
  const run = <S extends z.ZodTypeAny, T>(
    schema: S,
    action: (ctx: StockCliContext, input: z.output<S>) => Promise<Result<T, AppError>>,
    format: (value: T) => string,
  ) => async (...args: unknown[]) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, product.parent?.opts()['json'] === true, () => ''); return; }
    const input = schema.safeParse(args.slice(0, -1));
    if (!input.success) { emit(err(validation('Invalid stock command options', input.error.flatten())), ctx.value.json, () => ''); return; }
    emit(await action(ctx.value, input.data), ctx.value.json, format);
  };

  stock.command('show <productId>').description('Show on hand, reserved and available pieces').action(
    run(z.tuple([productIdSchema, z.object({})]), (ctx, [productId]) => ctx.api.getProductStock(productId),
      (data) => data.stock === null ? 'stock is not tracked for this product' : describeStock(data.stock)),
  );
  stock.command('enable <productId>').description('Start tracking stock for a product')
    .requiredOption('--on-hand <count>', 'pieces on hand')
    .option('--threshold <count>', 'low-stock e-mail threshold')
    .action(run(
      z.tuple([productIdSchema, z.object({ onHand: countSchema, threshold: countSchema.optional() })]),
      (ctx, [productId, options]) => ctx.api.enableProductStock({ productId, onHand: options.onHand, lowStockThreshold: options.threshold ?? null }),
      (data) => `stock tracking enabled: ${describeStock(data.stock)}`,
    ));
  stock.command('adjust <productId>').description('Add or remove pieces on hand; use the reason "returned" for goods put back')
    .requiredOption('--delta <count>', 'signed change, e.g. 5 or -1')
    .requiredOption('--reason <text>', 'why the stock changed')
    .action(run(
      z.tuple([productIdSchema, z.object({ delta: deltaSchema, reason: z.string().trim().min(1).max(200) })]),
      (ctx, [productId, options]) => ctx.api.adjustProductStock({ productId, delta: options.delta, reason: options.reason }),
      (data) => `stock adjusted: ${describeStock(data.stock)}`,
    ));
  stock.command('threshold <productId>').description('Set the low-stock e-mail threshold, or "none" to clear it')
    .requiredOption('--value <count>', 'threshold or none')
    .action(run(
      z.tuple([productIdSchema, z.object({ value: z.union([z.literal('none').transform(() => null), countSchema]) })]),
      (ctx, [productId, options]) => ctx.api.setProductStockThreshold({ productId, lowStockThreshold: options.value }),
      (data) => `low-stock threshold updated: ${describeStock(data.stock)}`,
    ));
};
