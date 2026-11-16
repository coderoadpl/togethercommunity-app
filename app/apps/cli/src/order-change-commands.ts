import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import { HTTP_STATUS_BY_ERROR_CODE } from '#core/contract/index.js';
import { err, feedCursorResetCursor, stripeModeSchema, validation, type AppError, type OrderChangeFeed, type Result } from '#core/domain/index.js';

import { emit } from './output.js';

type OrderChangeCliContext = { api: Pick<ApiClient, 'orderChanges'>; json: boolean };

const interruptOnSigint = () => {
  const controller = new AbortController();
  const abort = () => { controller.abort(); };
  process.once('SIGINT', abort);
  return { signal: controller.signal, dispose: () => { process.off('SIGINT', abort); } };
};

type Interrupt = ReturnType<typeof interruptOnSigint>;

const optionsSchema = z.object({
  after: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  mode: stripeModeSchema.optional(),
  follow: z.boolean().default(false),
  interval: z.coerce.number().int().min(1).max(3600).default(10),
});

const changeLine = ({ cursor, order }: OrderChangeFeed['changes'][number]): string =>
  [cursor, order.id, order.status, order.fulfilmentStatus ?? '', order.clientReference == null ? '' : `ref ${order.clientReference}`]
    .join('\t')
    .trimEnd();

const feedQuery = (options: z.output<typeof optionsSchema>, after: string | undefined) => ({
  ...(after === undefined ? {} : { after }),
  ...(options.limit === undefined ? {} : { limit: options.limit }),
  ...(options.mode === undefined ? {} : { mode: options.mode }),
});

const pause = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) { resolve(); return; }
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, milliseconds);
  const stop = () => { clearTimeout(timer); resolve(); };
  signal.addEventListener('abort', stop, { once: true });
});

const RETRY_DELAY_CAP_MS = 60_000;

const isTransient = (error: AppError): boolean => {
  const status = HTTP_STATUS_BY_ERROR_CODE[error.code];
  return status >= 500 || status === 429;
};

const retryDelay = (intervalSeconds: number, failures: number): number =>
  Math.min(intervalSeconds * 1000 * 2 ** (failures - 1), Math.max(RETRY_DELAY_CAP_MS, intervalSeconds * 1000));

const report = <T>(ctx: OrderChangeCliContext, result: Result<T, AppError>, human: (value: T) => string): void => {
  emit(result, ctx.json, human);
  const resetCursor = result.ok ? null : feedCursorResetCursor(result.error);
  if (resetCursor !== null && !ctx.json) {
    console.error(`Resync from the order list, then continue with: orders changes --after '${resetCursor}'`);
  }
};

const follow = async (
  ctx: OrderChangeCliContext,
  options: z.output<typeof optionsSchema>,
  signal: AbortSignal,
): Promise<void> => {
  let cursor = options.after;
  let failures = 0;
  while (!signal.aborted) {
    const page = await ctx.api.orderChanges(feedQuery(options, cursor), signal);
    if (signal.aborted) return;
    if (!page.ok) {
      if (!isTransient(page.error)) { report(ctx, page, () => ''); return; }
      failures += 1;
      const delay = retryDelay(options.interval, failures);
      console.error(`orders changes: ${page.error.message}; retrying in ${String(delay / 1000)} s`);
      await pause(delay, signal);
      continue;
    }
    failures = 0;
    if (page.value.changes.length > 0) {
      console.log(ctx.json ? JSON.stringify({ ok: true, data: page.value }) : page.value.changes.map(changeLine).join('\n'));
    }
    const advanced = page.value.nextCursor !== null && page.value.nextCursor !== cursor;
    cursor = page.value.nextCursor ?? cursor;
    if (!advanced) await pause(options.interval * 1000, signal);
  }
};

export const runOrderChanges = async (
  ctx: OrderChangeCliContext,
  raw: unknown,
  interrupt: () => Interrupt = interruptOnSigint,
): Promise<void> => {
  const options = optionsSchema.safeParse(raw);
  if (!options.success) { emit(err(validation('Invalid order changes options', options.error.flatten())), ctx.json, () => ''); return; }
  if (options.data.follow) {
    const { signal, dispose } = interrupt();
    try {
      await follow(ctx, options.data, signal);
    } finally {
      dispose();
    }
    return;
  }
  report(ctx, await ctx.api.orderChanges(feedQuery(options.data, options.data.after)), (feed) => [
    ...feed.changes.map(changeLine),
    `next cursor: ${feed.nextCursor ?? 'none'}`,
  ].join('\n'));
};

export const registerOrderChangeCommands = (
  orders: Command,
  context: () => Result<OrderChangeCliContext, AppError>,
): void => {
  orders
    .command('changes')
    .description('Orders changed after a cursor, oldest first, each in its current state')
    .option('--after <cursor>', 'the cursor of the last change already processed; omit to start from the oldest change')
    .option('--limit <n>', 'changes read per request, 1-200 (default 100)')
    .option('--mode <mode>', 'live or test; omit to include both')
    .option('--follow', 'keep polling and print each new change once; retry failed polls with a growing pause of up to 60 s; stop with Ctrl+C')
    .option('--interval <seconds>', 'seconds between polls with --follow when nothing changed (default 10)')
    .action(async (raw: unknown) => {
      const ctx = context();
      if (!ctx.ok) { emit(ctx, orders.parent?.opts()['json'] === true, () => ''); return; }
      await runOrderChanges(ctx.value, raw);
    });
};
