import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { createApiClient, type ApiClient } from '#core/client/index.js';
import { err, feedCursorReset, forbidden, internal, notFound, ok, orderListItemSchema, rateLimited, tenantNotFound, unauthorized, validation, type AppError, type OrderChangeFeed } from '#core/domain/index.js';

import { runOrderChanges } from './order-change-commands.js';

const order = (id: string, over: Record<string, unknown> = {}) => orderListItemSchema.parse({
  id, tenantId: 'workspace', memberId: 'member', productId: 'stand', priceId: null, kind: 'one_time', status: 'paid', mode: 'live',
  amountCents: 7398, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: '2026-11-04T09:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed stand',
  couponCode: null, ...over,
});

const FRESH = '0123456789abcdef0123456789abcdef.12.4';

const pollThrough = (reply: () => Promise<Response>) =>
  createApiClient({ baseUrl: 'https://api.example.test', fetchImpl: reply }).orderChanges({ after: '8.7' });

const networkFailure = () => pollThrough(async () => { throw new TypeError('fetch failed'); });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const serverError = (status: number, error: AppError) => pollThrough(async () => json(status, { ok: false, error }));

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

  it('retries a rejected poll from the same cursor and prints the change once when the next poll succeeds', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.orderChanges
        .mockResolvedValueOnce(await networkFailure())
        .mockResolvedValueOnce(ok(page([{ cursor: '9.1', order: order('order-1') }], '9.1')))
        .mockImplementationOnce(async () => {
          h.controller.abort();
          return ok(page([], '9.1'));
        });
      const running = h.run({ after: '8.7', follow: true, interval: '5' });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(h.orderChanges).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(h.orderChanges.mock.calls.map(([input]) => input)).toEqual([{ after: '8.7' }, { after: '8.7' }, { after: '9.1' }]);
      expect(logSpy.mock.calls.map(([line]) => line)).toEqual(['9.1\torder-1\tpaid']);
      expect(errorSpy).toHaveBeenCalledExactlyOnceWith('orders changes: Network error calling /api/orders/changes?after=8.7: TypeError: fetch failed; retrying in 5 s');
      expect(process.exitCode).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('doubles the pause after each failed poll up to 60 s and starts again from the interval after a success', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const busy = await serverError(429, rateLimited());
      h.orderChanges
        .mockResolvedValueOnce(busy).mockResolvedValueOnce(busy).mockResolvedValueOnce(busy).mockResolvedValueOnce(busy).mockResolvedValueOnce(busy)
        .mockResolvedValueOnce(ok(page([{ cursor: '9.1', order: order('order-1') }], '9.1')))
        .mockResolvedValueOnce(busy)
        .mockImplementationOnce(async () => {
          h.controller.abort();
          return busy;
        });
      const running = h.run({ after: '8.7', follow: true, interval: '10' });
      await vi.advanceTimersByTimeAsync(10_000 + 20_000 + 40_000 + 60_000 + 60_000 + 10_000);
      await running;
      expect(errorSpy.mock.calls.map(([line]) => line)).toEqual([10, 20, 40, 60, 60, 10].map((seconds) => `orders changes: Too many requests; retrying in ${String(seconds)} s`));
      expect(h.orderChanges).toHaveBeenCalledTimes(8);
      expect(h.orderChanges.mock.calls.at(-1)?.[0]).toEqual({ after: '9.1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { error: unauthorized(), status: 401, exitCode: 3 },
    { error: forbidden(), status: 403, exitCode: 4 },
    { error: validation('Invalid order changes query'), status: 400, exitCode: 2 },
    { error: notFound(), status: 404, exitCode: 5 },
    { error: tenantNotFound(), status: 404, exitCode: 7 },
    { error: feedCursorReset(FRESH), status: 409, exitCode: 30 },
  ])('stops following on $error.code with exit code $exitCode', async ({ error, status, exitCode }) => {
    const h = harness();
    h.orderChanges.mockResolvedValue(await serverError(status, error));
    await h.run({ after: '8.7', follow: true, interval: '1' });
    expect(h.orderChanges).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(`error(${error.code}): ${error.message}`);
    expect(process.exitCode).toBe(exitCode);
  });

  it.each([
    { reason: 'an answer that does not match the contract', reply: async () => json(200, { ok: true, data: { orders: [] } }), message: 'Response data from /api/orders/changes?after=8.7 does not match the contract' },
    { reason: 'a 4xx answer that is not JSON', reply: async () => new Response('<html>Not found</html>', { status: 404 }), message: 'Non-JSON response from /api/orders/changes?after=8.7 (HTTP 404)' },
    { reason: 'a 5xx answer that is not JSON', reply: async () => new Response('Bad gateway', { status: 502 }), message: 'Non-JSON response from /api/orders/changes?after=8.7 (HTTP 502)' },
  ])('stops following with the internal exit code on $reason', async ({ reply, message }) => {
    const h = harness();
    h.orderChanges.mockResolvedValue(await pollThrough(reply));
    await h.run({ after: '8.7', follow: true, interval: '1' });
    expect(h.orderChanges).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(`error(internal): ${message}`);
    expect(process.exitCode).toBe(10);
  });

  it.each([
    { reason: 'a network error', failure: networkFailure, message: 'Network error calling /api/orders/changes?after=8.7: TypeError: fetch failed' },
    { reason: 'a 500 internal error envelope', failure: () => serverError(500, internal()), message: 'Internal error' },
    { reason: 'a 503 envelope', failure: () => serverError(503, { code: 'unavailable', message: 'Service unavailable' }), message: 'Service unavailable' },
    { reason: 'a 429 envelope', failure: () => serverError(429, rateLimited()), message: 'Too many requests' },
  ])('retries $reason', async ({ failure, message }) => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.orderChanges
        .mockResolvedValueOnce(await failure())
        .mockImplementationOnce(async () => {
          h.controller.abort();
          return ok(page([], '8.7'));
        });
      const running = h.run({ after: '8.7', follow: true, interval: '1' });
      await vi.advanceTimersByTimeAsync(1_000);
      await running;
      expect(h.orderChanges).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledExactlyOnceWith(`orders changes: ${message}; retrying in 1 s`);
      expect(process.exitCode).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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
