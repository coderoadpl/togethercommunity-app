import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-order-detail.json';
import { withPage } from '../page-decorators.js';

const recorded = fixture.calls['getOrder:["order-studio-active-js"]'].value.order;

const line = (name: string, productType = 'physical') => ({
  productId: `product-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, productType, quantity: 1,
  grossCents: 1000, netCents: 813, vatRate: 23, vatCents: 187, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null,
});

const bundle = [
  'Volume 1 "Plan" — e-book (PDF + EPUB), part of the bundle',
  'Volume 2 "Build" — pre-order',
  'Volume 3 "Live and travel" — pre-order',
  'Interactive edition and community — volume 1',
  'Interactive edition and community — volume 2',
  'Interactive edition and community — volume 3',
  'Volume 1 "Plan" — printed copy',
  'Project notebook "Build notes", 2 pcs.',
  'Workshop recording access',
  'Printable checklists',
  'Bonus chapter',
].map((name) => line(name, 'course'));

const listed = (overrides: Record<string, unknown>) => ({
  ...recorded,
  provider: 'stripe', discountCents: 0, couponCode: null, couponId: null, paidAt: null, invoice: null, fulfilmentStatus: 'to_pack', shipment: null,
  attribution: { utmSource: 'www', utmMedium: 'cta' },
  ...overrides,
});

const orders = [
  listed({
    id: 'order-demo-bundle', createdAt: '2026-11-25T08:44:00.000Z', memberName: null, memberEmail: 'm.kowalczyk-nowak@printing-studio.example.com', amountCents: 15900,
    productTitle: 'Starter bundle', salesLinkId: 'sales-link-demo', salesLinkTitle: 'Bundle: trilogy + printed volume 1 + 2 notebooks',
    lines: [...bundle, line('Parcel locker delivery', 'shipping')],
  }),
  listed({
    id: 'order-demo-personalised', createdAt: '2026-11-24T20:11:00.000Z', memberName: 'Jamie Lee', memberEmail: 'jamie.lee@example.com', amountCents: 15900,
    productTitle: 'Starter bundle', salesLinkId: 'sales-link-demo', salesLinkTitle: 'Bundle: trilogy + printed volume 1 + 2 notebooks',
    attribution: { utmSource: 'meta', utmMedium: 'paid' },
    lines: [{ ...bundle[6], personalization: {
      text: 'For Sam', label: 'Dedication', description: 'Printed on the first page', inputLabel: 'Dedication text', condition: null, maxLength: 60,
      requestedAt: '2026-11-24T20:11:00.000Z', conditionAcceptedAt: null,
    } }, bundle[7], line('Parcel locker delivery', 'shipping')],
  }),
  listed({
    id: 'order-demo-coupon', createdAt: '2026-11-22T21:31:00.000Z', memberName: 'Robin Park', memberEmail: 'robin.park@example.com', amountCents: 12720, discountCents: 3180,
    productTitle: 'Starter bundle', couponCode: 'AUTUMN20-PARTNER-WORKSHOP-EARLYBIRD-2026', couponId: 'coupon-demo',
    lines: [bundle[0], bundle[1], bundle[2]],
  }),
  listed({
    id: 'order-demo-single', createdAt: '2026-11-22T21:26:00.000Z', memberName: 'Casey Kim', memberEmail: 'casey.kim@example.com', amountCents: 4900,
    productTitle: 'Workshop recording access', fulfilmentStatus: null, attribution: null,
    lines: [line('Workshop recording access', 'course')],
  }),
];

const meta = {
  title: 'Pages/PanelSalesList',
  id: 'panel-sales-list',
  render: () => <></>,
  decorators: [withPage],
  parameters: {
    layout: 'fullscreen',
    locale: 'pl',
    fixture: {
      ...fixture,
      scenario: 'panel-sales-list',
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
        'listPaymentEventRejections:[{}]': { ok: true, value: { rejections: [] } },
        'listOrders:[{"page":1,"pageSize":25}]': { ok: true, value: { orders, total: orders.length, page: 1, pageSize: 25, sources: [] } },
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Polish: Story = {};
export const English: Story = { parameters: { locale: 'en' } };
export const Dark: Story = { parameters: { colorScheme: 'dark' } };
