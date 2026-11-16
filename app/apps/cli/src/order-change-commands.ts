import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import { err, stripeModeSchema, validation, type AppError, type OrderChangeFeed, type Result } from '#core/domain/index.js';

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

const follow = async (
  ctx: OrderChangeCliContext,
  options: z.output<typeof optionsSchema>,
  signal: AbortSignal,
): Promise<void> => {
  let cursor = options.after;
  while (!signal.aborted) {
    const page = await ctx.api.orderChanges(feedQuery(options, cursor), signal);
    if (signal.aborted) return;
    if (!page.ok) { emit(page, ctx.json, () => ''); return; }
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
  emit(await ctx.api.orderChanges(feedQuery(options.data, options.data.after)), ctx.json, (feed) => [
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
    .option('--follow', 'keep polling and print each new change once; stop with Ctrl+C')
    .option('--interval <seconds>', 'seconds between polls with --follow when nothing changed (default 10)')
    .action(async (raw: unknown) => {
      const ctx = context();
      if (!ctx.ok) { emit(ctx, orders.parent?.opts()['json'] === true, () => ''); return; }
      await runOrderChanges(ctx.value, raw);
    });
};
