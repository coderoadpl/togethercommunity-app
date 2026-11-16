import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { ApiClient } from '#core/client/index.js';
import { err, feedCursorReset, forbidden, ok, orderListItemSchema, type OrderChangeFeed } from '#core/domain/index.js';

import { runOrderChanges } from './order-change-commands.js';

const order = (id: string, over: Record<string, unknown> = {}) => orderListItemSchema.parse({
  id, tenantId: 'workspace', memberId: 'member', productId: 'stand', priceId: null, kind: 'one_time', status: 'paid', mode: 'live',
  amountCents: 7398, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: '2026-11-04T09:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed stand',
  couponCode: null, ...over,
});

const FRESH = '0123456789abcdef0123456789abcdef.12.4';

const page = (changes: OrderChangeFeed['changes'], nextCursor: string | null): OrderChangeFeed => ({ changes, nextCursor });

let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.exitCode = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const harness = (json = false) => {
  const orderChanges = vi.fn<ApiClient['orderChanges']>();
  const controller = new AbortController();
  const dispose = vi.fn();
  const run = (options: Record<string, unknown> = {}) =>
    runOrderChanges({ api: { orderChanges }, json }, options, () => ({ signal: controller.signal, dispose }));
  return { orderChanges, controller, dispose, run };
};

describe('orders changes command', () => {
  it('prints each change with its cursor, then the next cursor', async () => {
    const h = harness();
    h.orderChanges.mockResolvedValue(ok(page([
      { cursor: '9.1', order: order('order-1', { fulfilmentStatus: 'shipped', clientReference: 'shop-cart-8812' }) },
      { cursor: '9.4', order: order('order-2', { status: 'refunded' }) },
    ], '9.4')));
    await h.run({ after: '8.7', limit: '20', mode: 'live' });
    expect(h.orderChanges).toHaveBeenCalledExactlyOnceWith({ after: '8.7', limit: 20, mode: 'live' });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('9.1\torder-1\tpaid\tshipped\tref shop-cart-8812\n9.4\torder-2\trefunded\nnext cursor: 9.4');
  });

  it('prints the feed envelope with --json', async () => {
    const h = harness(true);
    const feed = page([{ cursor: '9.1', order: order('order-1') }], '9.1');
    h.orderChanges.mockResolvedValue(ok(feed));
    await h.run();
    expect(h.orderChanges).toHaveBeenCalledExactlyOnceWith({});
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({ ok: true, data: feed });
  });

  it('maps a refused read to the taxonomy exit code', async () => {
    const h = harness();
    h.orderChanges.mockResolvedValue(err(forbidden()));
    await h.run();
    expect(errorSpy).toHaveBeenCalledWith('error(forbidden): Not allowed');
    expect(process.exitCode).not.toBe(0);
  });

  it('prints the reset message and the cursor to continue from, with its own exit code', async () => {
    const h = harness();
    h.orderChanges.mockResolvedValue(err(feedCursorReset(FRESH)));
    await h.run({ after: 'stale.9.1' });
    expect(errorSpy.mock.calls.map(([line]) => line)).toEqual([
      'error(feed_cursor_reset): Order change feed reset: resync from the order list, then start from the cursor in this answer',
      `Resync from the order list, then continue with: orders changes --after '${FRESH}'`,
    ]);
    expect(process.exitCode).toBe(30);
  });

  it('stops following on a feed reset instead of polling again', async () => {
    const h = harness(true);
    h.orderChanges.mockResolvedValue(err(feedCursorReset(FRESH)));
    await h.run({ after: 'stale.9.1', follow: true, interval: '1' });
    expect(h.orderChanges).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: { code: 'feed_cursor_reset', details: { cursor: FRESH } } });
    expect(process.exitCode).toBe(30);
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it('rejects a limit outside 1-200 without calling the API', async () => {
    const h = harness();
    await h.run({ limit: '201' });
    expect(h.orderChanges).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('error(validation)'));
  });

  it('follows from the last cursor, prints each change once and stops cleanly when interrupted', async () => {
    const h = harness();
    h.orderChanges
      .mockResolvedValueOnce(ok(page([{ cursor: '9.1', order: order('order-1') }], '9.1')))
      .mockResolvedValueOnce(ok(page([{ cursor: '9.3', order: order('order-1', { fulfilmentStatus: 'shipped' }) }], '9.3')))
      .mockImplementationOnce(async () => {
        h.controller.abort();
        return ok(page([], '9.3'));
      });
    await h.run({ after: '8.7', follow: true, interval: '1' });
    expect(h.orderChanges.mock.calls.map(([input]) => input)).toEqual([{ after: '8.7' }, { after: '9.1' }, { after: '9.3' }]);
    expect(logSpy.mock.calls.map(([line]) => line)).toEqual(['9.1\torder-1\tpaid', '9.3\torder-1\tpaid\tshipped']);
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it('waits the interval when nothing changed, then polls from the same cursor', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(true);
      h.orderChanges
        .mockResolvedValueOnce(ok(page([], '8.7')))
        .mockImplementationOnce(async () => {
          h.controller.abort();
          return ok(page([{ cursor: '9.1', order: order('order-1') }], '9.1'));
        });
      const running = h.run({ after: '8.7', follow: true, interval: '5' });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(h.orderChanges).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(h.orderChanges.mock.calls.map(([input]) => input)).toEqual([{ after: '8.7' }, { after: '8.7' }]);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
