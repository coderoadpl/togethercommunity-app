import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-order-detail.json';
import { withPage } from '../page-decorators.js';

const ORDER_ID = 'order-studio-active-js';
const recorded = fixture.calls[`getOrder:["${ORDER_ID}"]`].value;

const order = {
  ...recorded.order,
  provider: 'stripe',
  providerObjectIds: { checkoutSession: 'cs_demo_refund', paymentIntent: 'pi_demo_refund' },
  amountCents: 24900,
  discountCents: 0,
  couponCode: null,
  couponId: null,
  createdAt: '2026-11-18T13:32:00.000Z',
  paidAt: '2026-11-18T13:33:00.000Z',
  memberName: 'Alex Morgan',
  memberEmail: 'alex.morgan@example.com',
  productTitle: 'Ceramic mug',
  attribution: { utmSource: 'newsletter', utmMedium: 'email' },
  lines: [
    { productId: 'product-mug', name: 'Ceramic mug', productType: 'physical', quantity: 1, grossCents: 8900, netCents: 7236, vatRate: 23, vatCents: 1664, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null },
    { productId: 'product-pottery-course', name: 'Pottery basics course', productType: 'course', quantity: 1, grossCents: 14500, netCents: 11789, vatRate: 23, vatCents: 2711, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null },
    { productId: 'shipping-courier', name: 'Courier delivery', productType: 'shipping', quantity: 1, grossCents: 1500, netCents: 1220, vatRate: 23, vatCents: 280, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null },
  ],
  shipping: {
    rateId: 'courier', label: 'Courier delivery', amountCents: 1500, vatRatePercent: 23, carrier: 'other', pickupPoint: null,
    address: { name: 'Alex Morgan', line1: 'Sample Street 1', line2: null, postalCode: '00-001', city: 'Warsaw', country: 'PL' }, phone: '+48 600 100 200',
  },
  fulfilmentStatus: 'to_pack',
  shipment: null,
};

const preview = {
  orderId: ORDER_ID, refundable: true, blockedReason: null, paidCents: 24900, refundedCents: 0, remainderCents: 24900, currency: 'PLN', mode: 'live',
  remainderSource: 'provider', returnableStock: [{ productId: 'product-mug', quantity: 1 }], onPackingList: true, hasShipment: false, hasInvoice: false,
  fullRefundOptions: { restockOffered: true, restockDefault: true, removeFromPackingListOffered: true, removeFromPackingListDefault: true }, waitingRefundId: null,
};

const refund = (overrides: Record<string, unknown>) => ({
  id: 'refund-demo-1', kind: 'amount', status: 'succeeded', amountCents: 5000, currency: 'PLN', attempts: 1, nextAttemptAt: null, lastError: null,
  providerRefundStatus: 'succeeded', submittedAt: '2026-11-19T15:40:00.000Z', permissionBlockedAt: null, requestedByUserId: 'fixture-user-f9e5468247b51d08', requestedByEmail: 'creator@together.dev',
  note: null, restocked: false, removedFromPackingList: false, createdAt: '2026-11-19T15:40:00.000Z', updatedAt: '2026-11-19T15:41:00.000Z',
  ...overrides,
});

type RefundState = {
  order: Record<string, unknown>;
  staffRefunds: Record<string, unknown>[];
  refunded: number;
  preview: Record<string, unknown>;
  calls?: Record<string, unknown>;
};

const meta = { title: 'Pages/PanelOrderRefund', id: 'panel-order-refund', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const refundStory = (state: RefundState): Story => ({
  parameters: {
    fixture: {
      ...fixture,
      scenario: 'panel-order-refund',
      calls: {
        ...fixture.calls,
        [`getOrder:["${ORDER_ID}"]`]: { ok: true, value: {
          ...recorded,
          order: { ...order, ...state.order },
          staffRefunds: state.staffRefunds,
          refundTotals: { paidCents: 24900, refundedCents: state.refunded, remainingCents: 24900 - state.refunded, currency: 'PLN' },
        } },
        [`orderRefundPreview:[{"orderId":"${ORDER_ID}"}]`]: { ok: true, value: { ...preview, ...state.preview } },
        ...state.calls,
      },
    },
  },
});

// A capture that pins crypto.randomUUID to this key gets the refusal a reused request key answers.
const REFUSED_REQUEST_KEY = 'story-refused-request';

export const Paid: Story = refundStory({
  order: {}, staffRefunds: [], refunded: 0, preview: {},
  calls: {
    [`createOrderRefund:[{"orderId":"${ORDER_ID}","removeFromPackingList":true,"requestKey":"${REFUSED_REQUEST_KEY}","restock":true}]`]: {
      ok: false, error: { code: 'conflict', message: 'This refund request key was already used' },
    },
  },
});

export const PartiallyRefunded: Story = refundStory({
  order: { status: 'partially_refunded' },
  staffRefunds: [
    refund({ id: 'refund-demo-2', status: 'running', amountCents: 4900, providerRefundStatus: null, submittedAt: null, requestedByEmail: 'admin@example.com', note: 'Discount for the late delivery, agreed with the buyer by e-mail', createdAt: '2026-11-21T09:12:00.000Z', updatedAt: '2026-11-21T09:12:00.000Z' }),
    refund({ note: 'Engraving cancelled, add-on refunded' }),
  ],
  refunded: 9900,
  preview: { refundable: false, blockedReason: 'Another refund of this order is still waiting to reach the payment provider', refundedCents: 9900, remainderCents: 15000, waitingRefundId: 'refund-demo-2' },
});

export const RefundedOffPackingList: Story = refundStory({
  order: { status: 'refunded', fulfilmentStatus: null },
  staffRefunds: [refund({ kind: 'remainder', amountCents: 24900, restocked: true, removedFromPackingList: true, note: 'The buyer cancelled before shipping' })],
  refunded: 24900,
  preview: { refundable: false, blockedReason: 'The order is refunded; only paid or partially refunded orders can be refunded', refundedCents: 24900, remainderCents: 0, onPackingList: false },
});

export const BlockedPermission: Story = refundStory({
  order: { fulfilmentStatus: null },
  staffRefunds: [refund({ kind: 'remainder', status: 'blocked_permission', amountCents: 24900, providerRefundStatus: null, submittedAt: null, restocked: true, removedFromPackingList: true, note: 'The buyer cancelled before shipping', nextAttemptAt: '2026-11-22T10:05:00.000Z', permissionBlockedAt: '2026-11-22T09:05:00.000Z', createdAt: '2026-11-22T09:05:00.000Z', updatedAt: '2026-11-22T09:05:00.000Z' })],
  refunded: 24900,
  preview: { refundable: false, blockedReason: 'Another refund of this order is still waiting to reach the payment provider', refundedCents: 24900, remainderCents: 0, onPackingList: false, waitingRefundId: 'refund-demo-1' },
});

const listed = (overrides: Record<string, unknown>) => ({ ...order, invoice: null, ...overrides });

const toPack = [
  listed({ id: 'order-demo-1', createdAt: '2026-11-22T07:14:00.000Z', memberName: 'Sam Taylor', memberEmail: 'sam.taylor@example.com', amountCents: 10400 }),
  listed({ id: 'order-demo-2', createdAt: '2026-11-21T18:40:00.000Z', memberName: 'Jamie Lee', memberEmail: 'jamie.lee@example.com' }),
  listed({ id: 'order-demo-3', createdAt: '2026-11-20T08:27:00.000Z', memberName: 'Robin Park', memberEmail: 'robin.park@example.com', amountCents: 10400, status: 'partially_refunded', staffRefundStatus: 'running', staffRefundAmountCents: 4900 }),
];

const allOrders = [
  ...toPack,
  listed({ id: 'order-demo-4', createdAt: '2026-11-18T13:32:00.000Z', status: 'refunded', fulfilmentStatus: null }),
  listed({ id: 'order-demo-5', createdAt: '2026-11-17T20:05:00.000Z', memberName: 'Casey Kim', memberEmail: 'casey.kim@example.com', fulfilmentStatus: 'shipped' }),
];

export const OrdersToPack: Story = {
  parameters: {
    fixture: {
      ...fixture,
      scenario: 'panel-order-refund-list',
      route: '/panel/sales',
      calls: {
        ...fixture.calls,
        'consumerSalesSummary:[{"from":"2026-06-01","to":"2026-06-30"}]': { ok: true, value: {
          from: '2026-06-01', to: '2026-06-30', timezone: 'Europe/Warsaw', currency: 'PLN', rates: [],
          totals: { orderCount: 0, lineCount: 0, netCents: 0, vatCents: 0, grossCents: 0 }, orderIds: [], orders: [],
        } },
        'listProducts:[]': { ok: true, value: { products: [] } },
        'listCouponOptions:[]': { ok: true, value: { coupons: [] } },
        'listOrderReconciliation:[{}]': { ok: true, value: { rows: [], checkedThrough: '2026-06-01T12:00:00.000Z' } },
        'listOrders:[{"page":1,"pageSize":25}]': { ok: true, value: { orders: allOrders, total: allOrders.length, page: 1, pageSize: 25, sources: [] } },
        'listOrders:[{"fulfilmentStatus":"to_pack","page":1,"pageSize":25}]': { ok: true, value: { orders: toPack, total: toPack.length, page: 1, pageSize: 25, sources: [] } },
      },
    },
  },
};
