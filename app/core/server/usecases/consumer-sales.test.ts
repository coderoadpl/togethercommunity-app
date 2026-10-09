import { describe, expect, it, vi } from 'vitest';

import { orderLineSchema, orderSchema, type Identity } from '#core/domain/index.js';

import { consumerSalesToCsv, summarizeUninvoicedConsumerSales } from './consumer-sales.js';

const identity: Identity = { userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };
const query = { from: '2026-09-01', to: '2026-09-30' };
const line = (rate: 5 | 8 | 23 | 'exempt' | null, netCents: number, vatCents: number) => orderLineSchema.parse({ productId: 'product', name: 'Material', productType: 'digital_download', grossCents: netCents + vatCents, netCents, vatRate: rate, vatCents, vatExemptionBasis: null, issuedCount: null });
const order = (id: string, lines: ReturnType<typeof line>[]) => orderSchema.parse({ id, tenantId: 'workspace', memberId: 'member', productId: 'product', priceId: null, kind: 'one_time', status: 'paid', amountCents: lines.reduce((sum, item) => sum + item.grossCents, 0), currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, lines, createdAt: '2026-09-01T22:00:00.000Z' });
const rows = [order('order-a', [line(5, 1000, 50), line(5, 2000, 100), line(8, 10000, 800)]), order('order-b', [line(23, 10000, 2300), line('exempt', 5000, 0)])];

describe('summarizeUninvoicedConsumerSales', () => {
  it('sums stored values and counts each order once per rate and once in totals', async () => {
    const listUninvoicedConsumers = vi.fn(async () => rows);
    const result = await summarizeUninvoicedConsumerSales({ identity }, query, { consumerSales: { listUninvoicedConsumers } });
    expect(listUninvoicedConsumers).toHaveBeenCalledWith('workspace', query);
    expect(result).toEqual({ ok: true, value: {
      ...query, timezone: 'Europe/Warsaw', currency: 'PLN', orderIds: ['order-a', 'order-b'],
      rates: [
        { rate: 5, orderCount: 1, lineCount: 2, netCents: 3000, vatCents: 150, grossCents: 3150 },
        { rate: 8, orderCount: 1, lineCount: 1, netCents: 10000, vatCents: 800, grossCents: 10800 },
        { rate: 23, orderCount: 1, lineCount: 1, netCents: 10000, vatCents: 2300, grossCents: 12300 },
        { rate: 'exempt', orderCount: 1, lineCount: 1, netCents: 5000, vatCents: 0, grossCents: 5000 },
      ],
      totals: { orderCount: 2, lineCount: 5, netCents: 28000, vatCents: 3250, grossCents: 31250 },
      orders: [expect.objectContaining({ id: 'order-a', date: '2026-09-02', grossCents: 13950 }), expect.objectContaining({ id: 'order-b', date: '2026-09-02', grossCents: 17300 })],
    } });
  });

  it('emits four rate rows, a distinct-order TOTAL and a second order section in cents', async () => {
    const result = await summarizeUninvoicedConsumerSales({ identity }, query, { consumerSales: { listUninvoicedConsumers: async () => rows } });
    if (!result.ok) throw new Error('Summary failed');
    const csv = consumerSalesToCsv(result.value).split('\n');
    expect(csv[0]).toBe('"rate","order_count","line_count","net_cents","vat_cents","gross_cents","currency","from","to","timezone"');
    expect(csv[1]).toBe('"5","1","2","3000","150","3150","PLN","2026-09-01","2026-09-30","Europe/Warsaw"');
    expect(csv[5]).toBe('"TOTAL","2","5","28000","3250","31250","PLN","2026-09-01","2026-09-30","Europe/Warsaw"');
    expect(csv[6]).toBe('');
    expect(csv[7]).toBe('"order_number","date","gross_cents","currency","rate_breakdown"');
    expect(csv[8]).toContain('"order-a","2026-09-02","13950","PLN","[{""rate"":5');
    expect(csv).toHaveLength(10);
    const firstOrder = result.value.orders[0];
    if (firstOrder === undefined) throw new Error('Missing order');
    expect(consumerSalesToCsv({ ...result.value, orders: [{ ...firstOrder, id: '=formula' }] })).toContain('"\'=formula"');
  });

  it.each([218, 0])('allocates the paid amount %i across discounted mixed-rate lines and CSV totals', async (amountCents) => {
    const discounted = { ...order('discounted', [line(5, 100, 5), line(8, 100, 8), line(23, 100, 23), line('exempt', 100, 0)]), amountCents, couponId: 'coupon', discountCents: 436 - amountCents };
    const result = await summarizeUninvoicedConsumerSales({ identity }, query, { consumerSales: { listUninvoicedConsumers: async () => [discounted] } });
    if (!result.ok) throw new Error('Summary failed');
    const gross = amountCents === 0 ? [0, 0, 0, 0] : [53, 54, 61, 50];
    expect(result.value.rates.map((row) => row.grossCents)).toEqual(gross);
    expect(result.value.rates.map((row) => row.netCents)).toEqual(amountCents === 0 ? [0, 0, 0, 0] : [50, 50, 50, 50]);
    expect(result.value.rates.map((row) => row.vatCents)).toEqual(amountCents === 0 ? [0, 0, 0, 0] : [3, 4, 11, 0]);
    expect(result.value.totals).toEqual({ orderCount: 1, lineCount: 4, netCents: amountCents === 0 ? 0 : 200, vatCents: amountCents === 0 ? 0 : 18, grossCents: amountCents });
    expect(result.value.orders[0]?.grossCents).toBe(amountCents);
    expect(consumerSalesToCsv(result.value)).toContain(`"discounted","2026-09-02","${String(amountCents)}"`);
  });

  it('allocates mismatched stored gross even without a recorded discount', async () => {
    const paid = { ...order('adjusted', [line(23, 100, 23)]), amountCents: 61 };
    expect(await summarizeUninvoicedConsumerSales({ identity }, query, { consumerSales: { listUninvoicedConsumers: async () => [paid] } })).toMatchObject({ ok: true, value: { totals: { netCents: 50, vatCents: 11, grossCents: 61 } } });
  });

  it('refuses positive payments whose stored line gross cannot provide allocation weights', async () => {
    const paid = { ...order('unallocatable', [line(5, 0, 0)]), amountCents: 105 };
    expect(await summarizeUninvoicedConsumerSales({ identity }, query, { consumerSales: { listUninvoicedConsumers: async () => [paid] } })).toMatchObject({ ok: false, error: { code: 'validation', details: { orderIds: ['unallocatable'] } } });
  });

  it('requires order:export before reading the repository', async () => {
    const listUninvoicedConsumers = vi.fn(async () => rows);
    const deps = { consumerSales: { listUninvoicedConsumers } };
    expect(await summarizeUninvoicedConsumerSales({ identity, capabilities: ['order:read'] }, query, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(listUninvoicedConsumers).not.toHaveBeenCalled();
    expect(await summarizeUninvoicedConsumerSales({ identity, capabilities: ['order:export'] }, query, deps)).toMatchObject({ ok: true });
  });

  it.each([
    { from: '2026-09-31', to: '2026-10-01' },
    { from: '2026-10-01', to: '2026-09-01' },
    { from: '2026-09-01T00:00:00Z', to: '2026-09-30' },
  ])('rejects invalid calendar ranges without reading storage: %j', async (input) => {
    const listUninvoicedConsumers = vi.fn(async () => rows);
    expect(await summarizeUninvoicedConsumerSales({ identity }, input, { consumerSales: { listUninvoicedConsumers } })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(listUninvoicedConsumers).not.toHaveBeenCalled();
  });

  it('returns all four zero rows for an empty period', async () => {
    const result = await summarizeUninvoicedConsumerSales({ identity }, query, { consumerSales: { listUninvoicedConsumers: async () => [] } });
    expect(result).toMatchObject({ ok: true, value: { rates: [ { grossCents: 0 }, { grossCents: 0 }, { grossCents: 0 }, { grossCents: 0 } ], orderIds: [], totals: { orderCount: 0, lineCount: 0, grossCents: 0 } } });
  });

  it('refuses unresolved stored rates, missing lines and mixed currencies', async () => {
    for (const invalid of [[order('missing-rate', [line(null, 100, 0)])], [order('missing-lines', [])], [...rows, { ...order('foreign-currency', [line(5, 100, 5)]), currency: 'EUR' }]]) {
      expect(await summarizeUninvoicedConsumerSales({ identity }, query, { consumerSales: { listUninvoicedConsumers: async () => invalid } })).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
  });
});
