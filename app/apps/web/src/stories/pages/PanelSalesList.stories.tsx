import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
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
  provider: 'stripe', discountCents: 0, couponCode: null, couponId: null, paidAt: null, invoice: null, billing: null, fulfilmentStatus: 'to_pack', shipment: null,
  attribution: { utmSource: 'www', utmMedium: 'cta' },
  ...overrides,
});

const companyBilling = { nip: '5555555555', companyName: 'Sample Printing Studio', address: 'Main Street 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' };
const privateBilling = { ...companyBilling, nip: null, companyName: 'Sam Rivera' };

const invoice = (orderId: string, overrides: Record<string, unknown> = {}) => ({
  id: `invoice-${orderId}`, tenantId: recorded.tenantId, orderId, status: 'issued', provider: 'ifirma', providerInvoiceId: '1001',
  invoiceNumber: 'FV/2026/11/001', pdfUrl: null, error: null, issuedAt: '2026-11-21T09:00:00.000Z', createdAt: '2026-11-21T09:00:00.000Z',
  ...overrides,
});

const heldKsef = {
  environment: 'test', credentialMode: 'test', schemaSystemCode: 'FA (3)', schemaVersion: '1-0E', contextNip: '5555555555',
  sellerName: 'Studio', sellerAddress: 'Main Street 1', p2: null, invoiceType: 'VAT', issueDate: null, xmlArtifactKey: null,
  xmlByteSize: null, xmlSha256: null, state: 'held', authConfigVersion: 1, sessionReference: null, invoiceReference: null,
  ksefNumber: null, lastStatusCode: null, lastStatusDescription: null, lastStatusDetails: [], lastStatusExtensions: {},
  lastPolledAt: null, acquisitionAt: null, invoicingAt: null, permanentStorageAt: null, upoArtifactKey: null, upoSha256: null,
  upoRetrievedAt: null, originalSessionReference: null, originalKsefNumber: null, lastTransportError: null, retryAt: null,
  attempt: 0, correlationChecks: 0, version: 0,
};

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
    productTitle: 'Starter bundle', couponCode: 'AUTUMN20', couponId: 'coupon-demo',
    lines: [bundle[0], bundle[1], bundle[2]],
  }),
  listed({
    id: 'order-demo-single', createdAt: '2026-11-22T21:26:00.000Z', memberName: 'Casey Kim', memberEmail: 'casey.kim@example.com', amountCents: 4900,
    productTitle: 'Workshop recording access', fulfilmentStatus: null, attribution: null,
    lines: [line('Workshop recording access', 'course')],
  }),
  listed({
    id: 'order-demo-invoiced', createdAt: '2026-11-21T08:58:00.000Z', memberName: 'Alex Morgan', memberEmail: 'alex.morgan@example.com', amountCents: 8900,
    productTitle: 'Printed workbook', billing: companyBilling, invoice: invoice('order-demo-invoiced'), fulfilmentStatus: 'shipped',
    lines: [line('Printed workbook'), line('Parcel locker delivery', 'shipping')],
  }),
  listed({
    id: 'order-demo-ksef-held', createdAt: '2026-11-20T15:12:00.000Z', memberName: 'Taylor Brooks', memberEmail: 'taylor.brooks@example.com', amountCents: 8900,
    productTitle: 'Printed workbook', billing: companyBilling, invoice: invoice('order-demo-ksef-held', { status: 'requested', provider: 'ksef', providerInvoiceId: null, invoiceNumber: null, issuedAt: null, ksef: heldKsef }),
    lines: [line('Printed workbook'), line('Parcel locker delivery', 'shipping')],
  }),
  listed({
    id: 'order-demo-company', createdAt: '2026-11-19T11:40:00.000Z', memberName: 'Jordan Hale', memberEmail: 'jordan.hale@example.com', amountCents: 4900,
    productTitle: 'Workshop recording access', billing: companyBilling, fulfilmentStatus: null, attribution: { utmSource: 'newsletter', utmMedium: 'email' },
    lines: [line('Workshop recording access', 'course')],
  }),
  listed({
    id: 'order-demo-private', createdAt: '2026-11-18T19:05:00.000Z', memberName: 'Sam Rivera', memberEmail: 'sam.rivera@example.com', amountCents: 4900,
    productTitle: 'Workshop recording access', billing: privateBilling, fulfilmentStatus: null,
    lines: [line('Workshop recording access', 'course')],
  }),
];

const listCall = (filters: Record<string, unknown> = {}) =>
  `listOrders:[${JSON.stringify(Object.fromEntries(Object.entries({ ...filters, page: 1, pageSize: 25 }).sort(([a], [b]) => a.localeCompare(b, 'en'))))}]`;
const requested = orders.filter((order) => order.billing !== null && order.status === 'paid');

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
        'getListLayout:[{"listId":"orders"}]': { ok: true, value: { layout: null } },
        [listCall()]: { ok: true, value: { orders, total: orders.length, page: 1, pageSize: 25, sources: ['meta', 'newsletter', 'www'] } },
        [listCall({ billing: 'requested', status: 'paid' })]: { ok: true, value: { orders: requested, total: requested.length, page: 1, pageSize: 25, sources: ['meta', 'newsletter', 'www'] } },
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const ready = async (canvasElement: HTMLElement) => {
  await document.fonts.ready;
  return within(canvasElement).findByTestId('sales-grid', {}, { timeout: 10_000 });
};

export const Polish: Story = {};
export const English: Story = { parameters: { locale: 'en' } };
export const Dark: Story = { parameters: { colorScheme: 'dark' } };
export const GridCapture: Story = {
  name: 'Grid capture',
  parameters: { locale: 'en', docs: { description: { story: 'Default grid layout in Shadcn, captured at the desktop and mobile widths; phones show the order cards.' } } },
};
export const ColumnsDialogOpen: Story = {
  name: 'Columns dialog open',
  parameters: { locale: 'en' },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Columns' }));
  },
};
export const FilterPopoverOpen: Story = {
  name: 'Filter popover open',
  parameters: { locale: 'en' },
  play: async ({ canvasElement }) => {
    const grid = await ready(canvasElement);
    await userEvent.click(within(grid).getByRole('columnheader', { name: 'Invoice' }));
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Filter' }));
  },
};
export const ActiveFilterChips: Story = {
  name: 'Active filter chips',
  parameters: { locale: 'en', fixture: { ...meta.parameters.fixture, route: '/panel/sales?billing=requested&status=paid' } },
};
