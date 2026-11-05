import { describe, expect, it, vi } from 'vitest';

import {
  appError,
  emailOutboxPayloadSchema,
  err,
  memberSchema,
  ok,
  orderListItemSchema,
  orderShipped,
  renderEmailOutboxPayload,
  type Capability,
  type Identity,
  type OrderLine,
  type OrderListItem,
  type OrderShipping,
} from '#core/domain/index.js';

import type { OrderFulfilmentRepository } from '../order-fulfilment-ports.js';
import type { OrderRepository } from '../ports.js';
import { createInMemoryTenantDomainRepository } from '../testing/tenant-domain-fakes.js';
import { exportPackingList, shipOrder, type ShipOrderDeps } from './order-fulfilment.js';

const identity: Identity = {
  userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true,
  image: null, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'acme', tenantName: 'Acme Shop', staffRole: 'owner',
  memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
};

const ctx = (capabilities: Capability[]) => ({ identity, capabilities });

const shipping: OrderShipping = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'WAW01M', name: 'Locker WAW01M', address: 'Main Street 1, Warsaw' },
  address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: '+48500000000',
};

const line = (productId: string, name: string, productType: 'physical' | 'shipping', grossCents: number): OrderLine => ({
  productId, name, productType, grossCents, netCents: grossCents, vatRate: 23, vatCents: 0, vatExemptionBasis: null,
  issuedCount: productType === 'physical' ? 0 : null,
});

const baseOrder = orderListItemSchema.parse({
  id: 'order-1', tenantId: 'workspace', memberId: 'member-1', productId: 'stand', priceId: null, kind: 'one_time',
  status: 'paid', amountCents: 7398, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null,
  discountCents: 0, createdAt: '2026-11-04T09:00:00.000Z', paidAt: '2026-11-04T09:01:00.000Z',
  memberEmail: 'buyer@example.org', memberName: 'Jane Buyer', productTitle: 'Printed stand', couponCode: null,
  lines: [line('stand', 'Printed stand', 'physical', 5899), line('shipping:locker', 'Parcel locker', 'shipping', 1499)],
  shipping, fulfilmentStatus: 'to_pack',
});

const orderWith = (change: Partial<OrderListItem>): OrderListItem => ({ ...baseOrder, ...change });

const harness = (order: OrderListItem | null = baseOrder) => {
  let id = 0;
  const ship = vi.fn<OrderFulfilmentRepository['ship']>(async (_tenantId, input) => ok({
    ...baseOrder, fulfilmentStatus: 'shipped', shipment: input.shipment,
  }));
  const findById = vi.fn(async () => order);
  const dispatchEmail = vi.fn();
  const deps: ShipOrderDeps = {
    tenantDomains: createInMemoryTenantDomainRepository(),
    appBaseUrl: 'https://app.together.test',
    baseDomain: 'together.test',
    singleTenantMode: false,
    orderDetails: { findById },
    fulfilment: { ship },
    members: {
      findById: async () => memberSchema.parse({
        id: 'member-1', tenantId: 'workspace', userId: 'user-1', email: 'buyer@example.org', displayName: 'Jane Buyer',
        language: 'pl', tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: '2026-07-01T00:00:00.000Z', deletedAt: null,
      }),
    },
    tenants: { findSettings: async () => null },
    ids: { nextId: () => `id-${String(++id)}` },
    clock: { nowIso: () => '2026-11-05T10:00:00.000Z' },
    dispatchEmail,
  };
  return { deps, ship, findById, dispatchEmail };
};

const shipInput = { orderId: 'order-1', carrier: 'inpost', trackingNumber: ' 520000011395200025754311 ' };

describe('ship order', () => {
  it('records the shipment with the staff identity and clock and queues one e-mail in the same repository call', async () => {
    const h = harness();
    const result = await shipOrder(ctx(['order:write']), shipInput, h.deps);
    expect(result).toMatchObject({ ok: true, value: { order: { fulfilmentStatus: 'shipped' } } });
    expect(h.ship).toHaveBeenCalledTimes(1);
    const [tenantId, input] = h.ship.mock.calls[0] ?? [];
    expect(tenantId).toBe('workspace');
    expect(input?.shipment).toEqual({
      carrier: 'inpost', trackingNumber: '520000011395200025754311', shippedAt: '2026-11-05T10:00:00.000Z', shippedBy: 'staff',
    });
    expect(input?.email).toEqual({
      id: 'id-1',
      to: 'buyer@example.org',
      payload: {
        kind: 'order-shipped',
        language: 'pl',
        tenantName: 'Acme Shop',
        shipment: {
          orderNumber: 'order-1',
          items: ['Printed stand'],
          delivery: {
            method: 'Parcel locker',
            pickupPoint: { code: 'WAW01M', name: 'Locker WAW01M', address: 'Main Street 1, Warsaw' },
            address: null,
          },
          carrier: 'inpost',
          trackingNumber: '520000011395200025754311',
          trackingUrl: 'https://inpost.pl/sledzenie-przesylek?number=520000011395200025754311',
        },
      },
    });
    expect(emailOutboxPayloadSchema.safeParse(input?.email?.payload).success).toBe(true);
    expect(input?.eventId).toBe('id-2');
    expect(h.dispatchEmail).toHaveBeenCalledTimes(1);
  });

  it('renders the queued e-mail with the order number, items, delivery and tracking link', async () => {
    const h = harness();
    await shipOrder(ctx(['order:write']), shipInput, h.deps);
    const payload = h.ship.mock.calls[0]?.[1].email?.payload;
    const rendered = renderEmailOutboxPayload(payload);
    expect(rendered.success).toBe(true);
    if (!rendered.success || payload === undefined) return;
    expect(rendered.data).toEqual(orderShipped('pl', { tenantName: 'Acme Shop', shipment: payload.shipment }));
    expect(rendered.data.subject).toContain('order-1');
    expect(rendered.data.text).toContain('- Printed stand');
    expect(rendered.data.text).not.toContain('- Parcel locker');
    expect(rendered.data.text).toContain('Paczkomat: WAW01M');
    expect(rendered.data.html).toContain('href="https://inpost.pl/sledzenie-przesylek?number=520000011395200025754311"');
  });

  it('sends the postal address for address deliveries and no link for other carriers', async () => {
    const h = harness(orderWith({ shipping: { ...shipping, label: 'Courier', carrier: 'other', pickupPoint: null } }));
    await shipOrder(ctx(['order:write']), { ...shipInput, carrier: 'other', trackingNumber: 'RR123456789PL' }, h.deps);
    const shipment = h.ship.mock.calls[0]?.[1].email?.payload.shipment;
    expect(shipment?.delivery).toEqual({ method: 'Courier', pickupPoint: null, address: shipping.address });
    expect(shipment?.trackingUrl).toBeNull();
  });

  it.each(['refunded', 'partially_refunded'] as const)('ships a %s order', async (status) => {
    const h = harness(orderWith({ status }));
    expect(await shipOrder(ctx(['order:write']), shipInput, h.deps)).toMatchObject({ ok: true });
    expect(h.ship).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'failed'] as const)('refuses an unpaid %s order without writing', async (status) => {
    const h = harness(orderWith({ status }));
    expect(await shipOrder(ctx(['order:write']), shipInput, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.ship).not.toHaveBeenCalled();
    expect(h.dispatchEmail).not.toHaveBeenCalled();
  });

  it('reports a second shipment as a conflict before queuing another e-mail', async () => {
    const h = harness(orderWith({ fulfilmentStatus: 'shipped' }));
    expect(await shipOrder(ctx(['order:write']), shipInput, h.deps)).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
    expect(h.ship).not.toHaveBeenCalled();
    expect(h.dispatchEmail).not.toHaveBeenCalled();
  });

  it('propagates a conflict detected under the row lock and does not dispatch', async () => {
    const h = harness();
    h.ship.mockResolvedValueOnce(err(appError('fulfilment_conflict', 'Order has already been shipped')));
    expect(await shipOrder(ctx(['order:write']), shipInput, h.deps)).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
    expect(h.dispatchEmail).not.toHaveBeenCalled();
  });

  it('refuses orders with nothing to ship', async () => {
    const h = harness(orderWith({ fulfilmentStatus: null, shipping: null }));
    expect(await shipOrder(ctx(['order:write']), shipInput, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.ship).not.toHaveBeenCalled();
  });

  it('skips the e-mail for test-mode orders', async () => {
    const h = harness(orderWith({ mode: 'test' }));
    expect(await shipOrder(ctx(['order:write']), shipInput, h.deps)).toMatchObject({ ok: true });
    expect(h.ship.mock.calls[0]?.[1].email).toBeNull();
    expect(h.dispatchEmail).not.toHaveBeenCalled();
  });

  it('returns not found for unknown orders and validates the input', async () => {
    const h = harness(null);
    expect(await shipOrder(ctx(['order:write']), shipInput, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await shipOrder(ctx(['order:write']), { ...shipInput, trackingNumber: 'abc' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await shipOrder(ctx(['order:write']), { ...shipInput, carrier: 'dhl' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('requires order:write and never reaches storage otherwise', async () => {
    const h = harness();
    expect(await shipOrder(ctx(['order:read', 'order:export']), shipInput, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.findById).not.toHaveBeenCalled();
    expect(h.ship).not.toHaveBeenCalled();
  });
});

describe('packing list', () => {
  const listing = (orders: OrderListItem[]) => {
    const list = vi.fn<OrderRepository['list']>(async () => ({ orders, total: orders.length }));
    return { list, deps: { orders: { list } } };
  };

  it('exports the orders to pack as CSV, oldest payment first, in Warsaw time', async () => {
    const newer = orderWith({ id: 'order-2', paidAt: '2026-11-04T23:30:00.000Z', memberName: null, memberEmail: 'second@example.org', shipping: { ...shipping, pickupPoint: null, label: 'Courier', phone: null } });
    const h = listing([newer, baseOrder]);
    const result = await exportPackingList(ctx(['order:export']), { format: 'csv' }, h.deps);
    expect(h.list).toHaveBeenCalledWith('workspace', { mode: 'live', fulfilmentStatus: 'to_pack', page: 1, pageSize: 100 });
    expect(result).toMatchObject({ ok: true, value: { filename: 'packing-list-acme.csv', mimeType: 'text/csv; charset=utf-8' } });
    if (!result.ok) return;
    expect(result.value.content.split('\n')).toEqual([
      'order_number,paid_at,buyer_name,email,phone,delivery,pickup_point_code,pickup_point_address,shipping_name,address_line1,address_line2,postal_code,city,country,items,notes',
      '"order-1","2026-11-04 10:01","Jane Buyer","buyer@example.org","\'+48500000000","Parcel locker","WAW01M","Main Street 1, Warsaw","Jane Buyer","Garden Street 5","","00-950","Warsaw","PL","Printed stand × 1",""',
      '"order-2","2026-11-05 00:30","","second@example.org","","Courier","","","Jane Buyer","Garden Street 5","","00-950","Warsaw","PL","Printed stand × 1",""',
    ]);
  });

  it('joins several items and neutralises spreadsheet formulas', async () => {
    const h = listing([orderWith({
      memberName: '=HYPERLINK("x")',
      lines: [line('a', '+Stand', 'physical', 100), line('b', 'Cup "large"', 'physical', 100), line('shipping:locker', 'Parcel locker', 'shipping', 1499)],
      shipping: { ...shipping, address: { ...shipping.address, line1: '@Street 1', line2: '-2' } },
    })]);
    const result = await exportPackingList(ctx(['order:export']), { format: 'csv', fulfilmentStatus: 'to_pack' }, h.deps);
    if (!result.ok) throw new Error('packing list failed');
    const row = result.value.content.split('\n')[1] ?? '';
    expect(row).toContain('"\'=HYPERLINK(""x"")"');
    expect(row).toContain('"\'@Street 1","\'-2"');
    expect(row).toContain('"\'+Stand × 1; Cup ""large"" × 1"');
  });

  it('pages through every order to pack', async () => {
    const list = vi.fn<OrderRepository['list']>(async (_tenantId, query) => ({
      orders: [orderWith({ id: `order-${String(query.page)}` })],
      total: 250,
    }));
    const result = await exportPackingList(ctx(['order:export']), { format: 'csv', fulfilmentStatus: 'shipped' }, { orders: { list } });
    expect(list).toHaveBeenCalledTimes(3);
    expect(list.mock.calls.map(([, query]) => [query.page, query.fulfilmentStatus])).toEqual([[1, 'shipped'], [2, 'shipped'], [3, 'shipped']]);
    expect(result.ok && result.value.content.split('\n')).toHaveLength(4);
  });

  it('requires order:export and a CSV format', async () => {
    const h = listing([baseOrder]);
    expect(await exportPackingList(ctx(['order:read', 'order:write']), { format: 'csv' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await exportPackingList(ctx(['order:export']), { format: 'json' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.list).not.toHaveBeenCalled();
  });
});
