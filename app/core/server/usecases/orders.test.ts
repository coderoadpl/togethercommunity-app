import { describe, expect, it, vi } from 'vitest';

import { orderListItemSchema, outOfStockRefundJob, type Identity, type OrderListItem } from '#core/domain/index.js';

import type { OrderListQuery } from '../ports.js';
import { createOrderRefundJobFake } from '../testing/order-refund-job-fake.js';
import { exportOrders, getOrder, getSalesSummary, listOrders, type OrdersDeps } from './orders.js';

const identity = (staffRole: 'owner' | 'admin' | null, tenantId: string | null = 't1'): Identity => ({
  userId: 'u1',
  email: 'owner@together.dev',
  name: 'Owner',
  emailVerified: true,
  tenantAccess: tenantId === null ? 'none' : staffRole === null ? 'member' : 'staff',
  tenantId,
  tenantSlug: tenantId ? 'alpha' : null,
  tenantName: tenantId ? 'Alpha' : null,
  staffRole,
  memberId: null,
image: null,
memberDisplayName: null,
memberBannedAt: null,
memberDmOptOutAt: null,
memberLanguage: null,
memberVideoAutoplay: false,
});

const orderItem = (id: string, over: Partial<OrderListItem> = {}): OrderListItem => ({
  mode: 'live',
  id,
  tenantId: 't1',
  memberId: 'm1',
  productId: 'p1',
  priceId: null,
  kind: 'one_time',
  status: 'paid',
  amountCents: 4900,
  currency: 'PLN',
  provider: 'simulated',
  providerObjectIds: {},
  couponId: null,
  discountCents: 0,
  createdAt: '2026-07-10T00:00:00.000Z',
  memberEmail: 'buyer@together.dev',
  memberName: 'Buyer',
  productTitle: 'Course',
  couponCode: null,
  billing: null,
  ...over,
});

const harness = (rows: OrderListItem[] = []) => {
  const queries: OrderListQuery[] = [];
  const deps: OrdersDeps = {
    orders: {
      completeTestCheckout: async () => null,
      create: async () => undefined,
      list: async (_tenantId, query) => {
        queries.push(query);
        const filtered = rows.filter(
          (row) =>
            (query.status === undefined || row.status === query.status) &&
            (query.productId === undefined || row.productId === query.productId) &&
            (query.kind === undefined || row.kind === query.kind) &&
            (query.couponId === undefined || row.couponId === query.couponId) &&
            (query.search === undefined ||
              row.memberEmail.includes(query.search) ||
              (row.memberName ?? '').includes(query.search)),
        );
        const start = (query.page - 1) * query.pageSize;
        return { orders: filtered.slice(start, start + query.pageSize), total: filtered.length };
      },
      revenueSince: async () => [{ currency: 'PLN', amountCents: 14700 }],
      countSince: async () => 3,
      listPaidWithoutGrant: async () => [],
    },
    subscriptions: {
      findById: async () => null,
      findByProviderSubscriptionId: async () => null,
      listKnownProviderSubscriptionIds: async () => [],
      listForMember: async () => [],
      create: async () => undefined,
      update: async () => null,
      countActive: async () => 2,
    },
    clock: { nowIso: () => '2026-07-14T10:00:00.000Z' },
  };
  return { deps, queries };
};

describe('listOrders', () => {
  it('requires the declared order read capability', async () => {
    const h = harness([orderItem('o1')]);
    const actor = identity('owner');
    expect(await listOrders(
      { identity: actor, capabilities: ['order:read'] },
      {},
      h.deps,
    )).toMatchObject({ ok: true });
    expect(await listOrders(
      { identity: actor, capabilities: ['order:export'] },
      {},
      h.deps,
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('applies status, product, kind and member-search filters with server-side paging', async () => {
    const rows = [
      orderItem('o1'),
      orderItem('o2', { status: 'failed', kind: 'recurring' }),
      orderItem('o3', { productId: 'p2', memberEmail: 'anna@together.dev', memberName: 'Anna' }),
    ];
    const h = harness(rows);

    const byStatus = await listOrders({ identity: identity('owner') }, { status: 'failed' }, h.deps);
    expect(byStatus).toMatchObject({ ok: true, value: { total: 1, orders: [{ id: 'o2' }] } });

    const byProduct = await listOrders({ identity: identity('owner') }, { productId: 'p2' }, h.deps);
    expect(byProduct).toMatchObject({ ok: true, value: { total: 1, orders: [{ id: 'o3' }] } });

    const byKind = await listOrders({ identity: identity('owner') }, { kind: 'recurring' }, h.deps);
    expect(byKind).toMatchObject({ ok: true, value: { total: 1, orders: [{ id: 'o2' }] } });

    const couponRows = [
      orderItem('o4', { couponId: 'coupon-1', couponCode: 'PARTNER20', discountCents: 1000 }),
    ];
    const couponHarness = harness(couponRows);
    const byCoupon = await listOrders(
      { identity: identity('owner') },
      { couponId: 'coupon-1' },
      couponHarness.deps,
    );
    expect(byCoupon).toMatchObject({
      ok: true,
      value: { orders: [{ couponCode: 'PARTNER20', discountCents: 1000 }] },
    });

    const bySearch = await listOrders({ identity: identity('owner') }, { search: 'anna' }, h.deps);
    expect(bySearch).toMatchObject({ ok: true, value: { total: 1, orders: [{ id: 'o3' }] } });

    const paged = await listOrders({ identity: identity('owner') }, { page: 2, pageSize: 2 }, h.deps);
    expect(paged).toMatchObject({ ok: true, value: { total: 3, page: 2, pageSize: 2 } });
    if (paged.ok) expect(paged.value.orders).toHaveLength(1);
  });

  it('defaults paging and coerces string query values', async () => {
    const h = harness([orderItem('o1')]);
    const result = await listOrders({ identity: identity('admin') }, { page: '1', pageSize: '50' }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { page: 1, pageSize: 50 } });
    expect(h.queries[0]).toMatchObject({ page: 1, pageSize: 50 });
  });

  it('rejects an invalid status filter', async () => {
    const h = harness();
    const result = await listOrders({ identity: identity('owner') }, { status: 'bogus' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('is forbidden for non-staff and needs a tenant', async () => {
    const h = harness();
    expect(await listOrders({ identity: identity(null) }, {}, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await listOrders({ identity: identity('owner', null) }, {}, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });
});

describe('getSalesSummary', () => {
  it('combines 30-day revenue, order count and active subscriptions', async () => {
    const h = harness();
    const result = await getSalesSummary({ identity: identity('owner') }, h.deps);
    expect(result).toEqual({
      ok: true,
      value: {
        revenueLast30Days: [{ currency: 'PLN', amountCents: 14700 }],
        ordersLast30Days: 3,
        activeSubscriptions: 2,
      },
    });
  });
});

describe('exportOrders — CSV', () => {
  it('quotes fields and neutralizes spreadsheet formulas, blanking a null member name', async () => {
    const rows = [
      orderItem('o1', { memberName: '=SUM(A1:A9)', memberEmail: 'a@together.dev' }),
      orderItem('o2', { memberName: null, productTitle: 'Course, Deluxe' }),
    ];
    const h = harness(rows);
    const result = await exportOrders({ identity: identity('owner') }, { format: 'csv' }, h.deps);

    expect(result).toMatchObject({ ok: true, value: { filename: 'sales-alpha.csv', mimeType: 'text/csv; charset=utf-8' } });
    if (!result.ok) return;
    const lines = result.value.content.split('\n');
    expect(lines[0]).toBe(
      'date,member,email,product,kind,amount_cents,currency,status,coupon,discount_cents,billing_nip,billing_company,billing_address,billing_postal_code,billing_city,billing_country,utm_source,utm_medium,utm_campaign,utm_content,utm_term,fbclid,gclid,shipping_rate,shipping_point,shipping_name,shipping_phone,shipping_address,shipping_postal_code,shipping_city,shipping_country,fulfilment_status,cancel_reason',
    );
    expect(lines[1]).toContain('"\'=SUM(A1:A9)"');
    expect(lines[2]).toContain('""');
    expect(lines[2]).toContain('"Course, Deluxe"');
  });

  it('appends the cancel reason as the last column, empty for an order that was not cancelled, and keeps the status', async () => {
    const h = harness([orderItem('cancelled', { cancelReason: 'out_of_stock' }), orderItem('kept')]);
    const result = await exportOrders({ identity: identity('owner') }, { format: 'csv' }, h.deps);
    if (!result.ok) throw new Error(result.error.message);
    const [header, cancelled, kept] = result.value.content.split('\n');
    expect(header?.split(',').at(-1)).toBe('cancel_reason');
    expect(header?.split(',').indexOf('status')).toBe(7);
    expect(cancelled).toMatch(/,"out_of_stock"$/u);
    expect(cancelled?.split(',')[7]).toBe('"paid"');
    expect(kept?.split(',')).toHaveLength(header?.split(',').length ?? 0);
    expect(kept?.split(',').at(-1)).toBe('""');
  });

  it('exports the immutable billing snapshot in CSV and JSON', async () => {
    const billing = {
      nip: '5555555555',
      companyName: 'Acme sp. z o.o.',
      address: 'Prosta 1',
      postalCode: '00-001',
      city: 'Warszawa',
      country: 'PL',
    };
    const h = harness([orderItem('o1', { billing })]);
    const csv = await exportOrders({ identity: identity('owner') }, { format: 'csv' }, h.deps);
    const json = await exportOrders({ identity: identity('owner') }, { format: 'json' }, h.deps);

    expect(csv).toMatchObject({ ok: true });
    if (csv.ok) expect(csv.value.content).toContain('"5555555555","Acme sp. z o.o.","Prosta 1","00-001","Warszawa","PL"');
    expect(json).toMatchObject({ ok: true });
    if (json.ok) {
      expect(orderListItemSchema.array().parse(JSON.parse(json.value.content))[0]?.billing).toEqual(billing);
    }
  });

  it('falls back to the tenant id in the filename when no slug is present', async () => {
    const h = harness([orderItem('o1')]);
    const result = await exportOrders(
      { identity: { ...identity('owner'), tenantSlug: null } },
      { format: 'csv' },
      h.deps,
    );
    expect(result).toMatchObject({ ok: true, value: { filename: 'sales-t1.csv' } });
  });

  it('rejects an invalid export query and forbids non-staff', async () => {
    const h = harness();
    expect(await exportOrders({ identity: identity('owner') }, { format: 'xml' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(await exportOrders({ identity: identity(null) }, { format: 'csv' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});

describe('exportOrders', () => {
  it('exports every row matching filters rather than only the first page', async () => {
    const rows = Array.from({ length: 205 }, (_value, index) =>
      orderItem(`o${index}`, { status: index === 204 ? 'failed' : 'paid' }),
    );
    const h = harness(rows);
    const result = await exportOrders(
      { identity: identity('owner') },
      { format: 'json', status: 'paid' },
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, value: { filename: 'sales-alpha.json' } });
    if (!result.ok) return;
    const exported = orderListItemSchema.array().parse(JSON.parse(result.value.content));
    expect(exported).toHaveLength(204);
    expect(h.queries).toHaveLength(3);
    expect(h.queries.every((query) => query.status === 'paid' && query.pageSize === 100)).toBe(true);
  });
});


it('shows the originating sales-link title in staff order details', async () => {
  const order = orderItem('bundle-order', { salesLinkId: 'link', salesLinkTitle: 'In-person offer' });
  const result = await getOrder({ identity: identity('owner') }, order.id, {
    orders: { findById: async () => order },
  });
  expect(result).toMatchObject({ ok: true, value: { order: { salesLinkId: 'link', salesLinkTitle: 'In-person offer' } } });
});


describe('getOrder refund job', () => {
  const cancelled = orderItem('cancelled-order', { cancelReason: 'out_of_stock', provider: 'stripe', providerObjectIds: { paymentIntent: 'pi_cancelled' } });
  const jobOf = (tenantId: string) => ({
    ...outOfStockRefundJob({ ...cancelled, tenantId }, { id: `job-${tenantId}`, now: '2026-07-10T00:01:00.000Z' }),
    status: 'submitted' as const, attempts: 2, keyGeneration: 1, lockedAt: '2026-07-10T00:05:00.000Z', providerRefundId: 're_1', providerRefundStatus: 'pending',
  });

  it('projects the job of the order for staff, with the idempotency key of its current generation and without lease fields', async () => {
    const refundJobs = createOrderRefundJobFake();
    refundJobs.jobs.push(jobOf('t1'));
    const result = await getOrder({ identity: identity('owner') }, cancelled.id, { orders: { findById: async () => cancelled }, refundJobs: refundJobs.repository });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.refundJob).toStrictEqual({
      status: 'submitted', attempts: 2, nextAttemptAt: '2026-07-10T00:01:00.000Z', lastError: null, amountCents: 4900, currency: 'PLN',
      idempotencyKey: 'oos-refund-cancelled-order-1', providerRefundId: 're_1', providerRefundStatus: 'pending', submittedAt: null,
      createdAt: '2026-07-10T00:01:00.000Z', updatedAt: '2026-07-10T00:01:00.000Z',
    });
  });

  it('returns no refund job when the only job for that order id belongs to another workspace or no job repository is wired', async () => {
    const refundJobs = createOrderRefundJobFake();
    refundJobs.jobs.push(jobOf('t2'));
    const foreign = await getOrder({ identity: identity('owner') }, cancelled.id, { orders: { findById: async () => cancelled }, refundJobs: refundJobs.repository });
    expect(foreign).toMatchObject({ ok: true, value: { order: { id: cancelled.id }, refundJob: null } });
    const unwired = await getOrder({ identity: identity('owner') }, cancelled.id, { orders: { findById: async () => cancelled } });
    expect(unwired).toMatchObject({ ok: true, value: { refundJob: null } });
  });
});


it('passes the source filter through to the tenant repository and exposes source options', async () => {
  const h = harness();
  const list = vi.fn(async () => ({ orders: [], total: 0, sources: ['meta', 'search'] }));
  h.deps.orders.list = list;
  expect(await listOrders({ identity: identity('owner') }, { source: 'meta' }, h.deps)).toMatchObject({ ok: true, value: { sources: ['meta', 'search'] } });
  expect(list).toHaveBeenCalledWith('t1', { source: 'meta', page: 1, pageSize: 20 });
});

it('exports all seven attribution columns in CSV and JSON with empty absent values', async () => {
  const attribution = { utmSource: 'meta', utmMedium: 'paid', utmCampaign: 'launch', utmContent: '@creative', utmTerm: 'term', fbclid: 'meta-click', gclid: 'google-click', capturedAt: '2026-10-15T12:00:00.000Z' };
  const h = harness([orderItem('attributed', { attribution }), orderItem('unattributed')]);
  const csv = await exportOrders({ identity: identity('owner') }, { format: 'csv' }, h.deps);
  expect(csv.ok && csv.value.content).toContain('"meta","paid","launch","\'@creative","term","meta-click","google-click"');
  expect(csv.ok && csv.value.content.split('\n')[2]).toMatch(/,"","","","","","",""$/);
  const json = await exportOrders({ identity: identity('owner') }, { format: 'json', source: 'meta' }, h.deps);
  expect(h.queries.at(-1)?.source).toBe('meta');
  if (!json.ok) throw new Error('Expected JSON export');
  const exported: unknown = JSON.parse(json.value.content);
  expect(exported).toMatchObject([{ attribution, utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'launch', utm_content: '@creative', utm_term: 'term', fbclid: 'meta-click', gclid: 'google-click' }, { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '', fbclid: '', gclid: '' }]);
});

it.each(['csv', 'json'] as const)('preserves exact source matching across every %s export page', async (format) => {
  const h = harness(Array.from({ length: 101 }, (_value, index) => orderItem(`order-${String(index)}`, { attribution: { utmSource: 'none', capturedAt: '2026-10-15T12:00:00.000Z' } })));
  await listOrders({ identity: identity('owner') }, { source: 'none', sourceMatch: 'exact' }, h.deps);
  const exported = await exportOrders({ identity: identity('owner') }, { format, source: 'none', sourceMatch: 'exact' }, h.deps);
  expect(exported.ok).toBe(true);
  expect(h.queries).toHaveLength(3);
  expect(h.queries.every((query) => query.source === 'none' && query.sourceMatch === 'exact')).toBe(true);
});
