import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { CART_LINES_PARAM, HOSTED_CART_PATH } from '#core/domain/index.js';

import checkout from '../fixtures/checkout.json';
import { withPage } from '../page-decorators.js';

const recordedOffer = checkout.calls['publicOffer:["product-studio-course-101"]'].value;
const recordedProduct = recordedOffer.products[0];
const recordedPaymentConfig = checkout.calls['publicPaymentConfig:[]'].value;
const tenant = { ...recordedOffer.tenant, legal: { termsUrl: 'https://studio.togethercommunity.app/terms', privacyUrl: 'https://studio.togethercommunity.app/privacy' } };
const shippingRates = [
  { id: 'locker', label: 'InPost parcel locker', amountCents: 0, carrier: 'inpost', pickupPoint: 'inpost_locker', deliveryEstimateDays: { min: 1, max: 3 } },
  { id: 'courier', label: 'InPost courier', amountCents: 1000, carrier: 'inpost', pickupPoint: 'none', deliveryEstimateDays: { min: 1, max: 3 } },
];
const untracked = { tracked: false, soldOut: false, low: false, available: null };

const ids = {
  stand: '5f0c2a1e-7d3b-4c8a-9e61-2b4d8f0a6c21',
  workbook: '5f0c2a1e-7d3b-4c8a-9e61-2b4d8f0a6c22',
  course: '5f0c2a1e-7d3b-4c8a-9e61-2b4d8f0a6c23',
  mug: '5f0c2a1e-7d3b-4c8a-9e61-2b4d8f0a6c24',
  membership: '5f0c2a1e-7d3b-4c8a-9e61-2b4d8f0a6c25',
} as const;
type CartProduct = keyof typeof ids;

const product = (key: CartProduct, change: Record<string, unknown>) => ({
  ...recordedProduct,
  id: ids[key],
  slug: key,
  coverUrl: '/icons/pwa-512.png',
  marketingConsents: [],
  stock: untracked,
  ...change,
});
const oneTime = (key: CartProduct, amountCents: number) => [{ id: `price-${key}`, kind: 'one_time', interval: null, amountCents, currency: 'PLN' }];
const physical = (key: CartProduct, title: string, amountCents: number) => ({
  type: 'physical', deliveryMethod: 'shipping', title, priceCents: amountCents, prices: oneTime(key, amountCents), maxQuantity: 10,
});
const products: Record<CartProduct, Record<string, unknown>> = {
  stand: product('stand', physical('stand', 'Printed desk stand', 15900)),
  workbook: product('workbook', physical('workbook', 'Printed workbook', 4200)),
  course: product('course', { type: 'course', deliveryMethod: 'pickup', title: 'Together 101 Course', priceCents: 12300, prices: oneTime('course', 12300), maxQuantity: 1 }),
  mug: product('mug', { ...physical('mug', 'Studio mug', 3900), stock: { tracked: true, soldOut: true, low: true, available: 0 }, maxQuantity: 0 }),
  membership: product('membership', { type: 'membership', deliveryMethod: 'pickup', title: 'Studio membership', priceCents: 9900, prices: oneTime('membership', 9900), maxQuantity: 1 }),
};

type CartLineSpec = { key: CartProduct; quantity: number; change?: Record<string, unknown> };
const cartFixture = (scenario: string, lines: readonly CartLineSpec[], extra: { code?: string; calls?: Record<string, unknown> } = {}) => ({
  ...checkout,
  scenario,
  route: `${HOSTED_CART_PATH}?${CART_LINES_PARAM}=${lines.map((line) => `${ids[line.key]}.${String(line.quantity)}`).join('~')}${extra.code === undefined ? '' : `&code=${extra.code}`}`,
  calls: {
    ...checkout.calls,
    ...Object.fromEntries(lines.map((line) => [
      `publicOffer:["${ids[line.key]}"]`,
      { ok: true, value: { ...recordedOffer, tenant, products: [{ ...products[line.key], ...line.change }] } },
    ])),
    'publicPaymentConfig:[]': {
      ok: true,
      value: { ...recordedPaymentConfig, simulatedPaymentsEnabled: false, stripeConfigured: true, shippingRates, inpostGeowidgetToken: null, inpostGeowidgetWithheld: false, canTest: false, testEnabled: false },
    },
    ...extra.calls,
  },
});

const buyerEmail = 'buyer@example.org';
const couponCode = 'STUDIO20';
const discountLines: CartLineSpec[] = [{ key: 'stand', quantity: 2 }, { key: 'workbook', quantity: 1 }];
const discountCall = `validateCartCouponForCheckout:[{"couponCode":"${couponCode}","email":"${buyerEmail}","lines":[${discountLines
  .map((line) => `{"productId":"${ids[line.key]}","quantity":${String(line.quantity)}}`).join(',')}]}]`;

const twoLinesFixture = cartFixture('together-cart-two-lines', [{ key: 'stand', quantity: 2 }, { key: 'workbook', quantity: 1 }]);
const blockedLinesFixture = cartFixture('together-cart-blocked-lines', [{ key: 'stand', quantity: 1 }, { key: 'mug', quantity: 1 }, { key: 'membership', quantity: 1 }]);
const stockCappedFixture = cartFixture('together-cart-stock-capped', [
  { key: 'workbook', quantity: 2, change: { stock: { tracked: true, soldOut: false, low: true, available: 2 }, maxQuantity: 2 } },
  { key: 'stand', quantity: 1 },
]);
const stockLoweredFixture = cartFixture('together-cart-stock-lowered', [
  { key: 'workbook', quantity: 3, change: { stock: { tracked: true, soldOut: false, low: true, available: 1 }, maxQuantity: 1 } },
  { key: 'stand', quantity: 1 },
]);
const limitOneFixture = cartFixture('together-cart-limit-one', [{ key: 'course', quantity: 1 }, { key: 'stand', quantity: 1 }]);
const discountFixture = cartFixture('together-cart-discount-delivery', discountLines, {
  code: couponCode,
  calls: {
    [discountCall]: {
      ok: true,
      value: {
        recurringDuration: 'first_invoice',
        breakdown: { couponId: 'coupon-studio-20', code: couponCode, originalCents: 36000, discountCents: 7200, finalCents: 28800, lowestPriceLast30DaysCents: 36000, currency: 'PLN' },
      },
    },
  },
});

const applyDiscountWithCourier = async (canvasElement: HTMLElement, emailLabel = 'Email') => {
  const canvas = within(canvasElement);
  await userEvent.type(await canvas.findByLabelText(emailLabel), buyerEmail);
  await canvas.findByTestId('cart-summary-discount', {}, { timeout: 5000 });
  await userEvent.click(await canvas.findByRole('radio', { name: /courier/u }));
  await expect(canvas.getByTestId('cart-summary-total')).toHaveTextContent('298');
};

const mobile375 = { parameters: { viewport: { defaultViewport: 'mobile-375' } }, globals: { viewport: { value: 'mobile-375' } } };
const dark = { colorScheme: 'dark' } as const;

const meta = {
  title: 'Pages/Cart checkout', render: () => <></>, decorators: [withPage],
  parameters: { layout: 'fullscreen', locale: 'en', fixture: twoLinesFixture },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const withMobile = (story: Story): Story => ({ ...mobile375, ...story, parameters: { ...mobile375.parameters, ...story.parameters } });
const withDark = (story: Story): Story => ({ ...story, parameters: { ...story.parameters, ...dark } });

export const TwoLines: Story = {};
export const TwoLinesMobile: Story = withMobile(TwoLines);
export const TwoLinesDark: Story = withDark(TwoLines);
export const TwoLinesMobileDark: Story = withDark(TwoLinesMobile);
export const TwoLinesPolish: Story = { parameters: { locale: 'pl' } };
export const SoldOutAndUnavailableLines: Story = {
  parameters: {
    fixture: blockedLinesFixture,
    docs: { description: { story: 'A sold-out line and a membership line are error alerts with Remove; the pay button keeps the amount, disabled, with the reason under it.' } },
  },
};
export const SoldOutAndUnavailableLinesMobile: Story = withMobile(SoldOutAndUnavailableLines);
export const SoldOutAndUnavailableLinesDark: Story = withDark(SoldOutAndUnavailableLines);
export const StockCappedLine: Story = {
  parameters: {
    fixture: stockCappedFixture,
    docs: { description: { story: 'Two pieces are left, so the stepper stops at 2 and the line says how many are left instead of the order limit.' } },
  },
};
export const StockCappedLineMobile: Story = withMobile(StockCappedLine);
export const StockCappedLinePolish: Story = { parameters: { ...StockCappedLine.parameters, locale: 'pl' } };
export const StockLoweredLine: Story = {
  parameters: {
    fixture: stockLoweredFixture,
    docs: { description: { story: 'The link asks for three workbooks and one is left, so the line has no stepper and says the quantity was lowered to the one left.' } },
  },
};
export const StockLoweredLineMobile: Story = withMobile(StockLoweredLine);
export const StockLoweredLineMobilePolish: Story = withMobile({ parameters: { ...StockLoweredLine.parameters, locale: 'pl' } });
export const LimitOneLine: Story = {
  parameters: {
    fixture: limitOneFixture,
    docs: { description: { story: 'A course is sold one per order, so its line has no stepper and no limit note, only Remove.' } },
  },
};
export const LimitOneLineMobile: Story = withMobile(LimitOneLine);
export const SummaryWithDiscountAndDelivery: Story = {
  parameters: {
    fixture: discountFixture,
    docs: { description: { story: 'A discount code from the link and a paid courier: the summary above the pay button lists products, discount, delivery and the total to pay.' } },
  },
  play: async ({ canvasElement }) => applyDiscountWithCourier(canvasElement),
};
export const SummaryWithDiscountAndDeliveryMobile: Story = withMobile(SummaryWithDiscountAndDelivery);
export const SummaryWithDiscountAndDeliveryDark: Story = withDark(SummaryWithDiscountAndDelivery);
export const SummaryWithDiscountAndDeliveryPolish: Story = {
  parameters: { ...SummaryWithDiscountAndDelivery.parameters, locale: 'pl' },
  play: async ({ canvasElement }) => applyDiscountWithCourier(canvasElement, 'E-mail'),
};
