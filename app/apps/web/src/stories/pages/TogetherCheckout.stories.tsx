import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import checkout from '../fixtures/checkout.json';
import account from '../fixtures/account.json';
import { withPage } from '../page-decorators.js';

const offerKey = 'publicOffer:["product-studio-course-101"]';
const recordedOffer = checkout.calls[offerKey].value;
const recordedPaymentConfig = checkout.calls['publicPaymentConfig:[]'].value;
const price = (amountCents: number) => ({ id: 'price-product-studio-course-101', kind: 'one_time', interval: null, amountCents, currency: 'PLN' });
const legal = { termsUrl: 'https://studio.togethercommunity.app/terms', privacyUrl: 'https://studio.togethercommunity.app/privacy' };
const tenant = { ...recordedOffer.tenant, legal };
const compliance = {
  manufacturerName: 'Studio Workshop',
  manufacturerAddress: 'Example Street 1, 00-001 Warsaw',
  manufacturerEmail: 'safety@studio.togethercommunity.app',
  modelIdentifier: 'STAND-1',
  batchIdentifier: null,
  safetyWarnings: 'Keep away from open flame.',
  safetyWarningsHtml: '<p>Keep away from open flame.</p>',
  instructionsUrl: null,
};
const shippingRates = [
  { id: 'locker', label: 'InPost parcel locker', amountCents: 0, carrier: 'inpost', pickupPoint: 'inpost_locker', deliveryEstimateDays: { min: 1, max: 3 } },
  { id: 'courier', label: 'InPost courier', amountCents: 1000, carrier: 'inpost', pickupPoint: 'none', deliveryEstimateDays: { min: 1, max: 3 } },
];
const stand = {
  type: 'physical',
  deliveryMethod: 'shipping',
  title: 'Printed desk stand',
  description: '<p>A sturdy stand for a laptop or a book, printed to order.</p>',
  priceCents: 15900,
  prices: [price(15900)],
  compliance,
};
const engraving = { label: 'Add an engraving', description: 'We engrave the text by hand on the base of the stand.', inputLabel: 'Engraving text', maxLength: 60, condition: null };
const engravingCondition = 'I understand a personalised item is made to my order.';
const standVariants = [
  { productId: 'product-studio-course-101', slug: 'course-together-101', label: 'Oak', soldOut: false },
  { productId: 'product-studio-stand-walnut', slug: 'stand-walnut', label: 'Walnut', soldOut: false },
  { productId: 'product-studio-stand-black', slug: 'stand-black', label: 'Black', soldOut: true },
];

type Calls = Record<string, unknown>;
const fixtureFor = (scenario: string, product: Record<string, unknown>, payment: Record<string, unknown>, extra: { route?: string; calls?: Calls } = {}) => ({
  ...checkout,
  scenario,
  route: extra.route ?? checkout.route,
  calls: {
    ...checkout.calls,
    [offerKey]: { ok: true, value: { ...recordedOffer, tenant, products: [{ ...recordedOffer.products[0], ...product }] } },
    'publicPaymentConfig:[]': { ok: true, value: { ...recordedPaymentConfig, simulatedPaymentsEnabled: false, stripeConfigured: true, ...payment } },
    ...extra.calls,
  },
});

const deliveryFixture = fixtureFor('together-checkout-delivery', stand, { shippingRates });
const variantsFixture = fixtureFor('together-checkout-variants', { ...stand, variants: standVariants }, { shippingRates });
const freeFixture = fixtureFor('together-checkout-free', { priceCents: 0, prices: [price(0)] }, {});
const signedInFixture = fixtureFor('together-checkout-signed-in', stand, { shippingRates }, { calls: { 'me:[]': account.calls['me:[]'] } });
const personalisationFixture = (scenario: string, condition: string | null) => fixtureFor(scenario, { ...stand, personalization: { ...engraving, condition } }, { shippingRates });

const couponCode = 'STUDIO20';
const couponFixture = fixtureFor('together-checkout-coupon', {}, {}, {
  route: `${checkout.route}?code=${couponCode}`,
  calls: {
    [`validateCouponForCheckout:[{"couponCode":"${couponCode}","priceId":"price-product-studio-course-101","productId":"product-studio-course-101"}]`]: {
      ok: true,
      value: {
        recurringDuration: 'first_invoice',
        breakdown: { couponId: 'coupon-studio-20', code: couponCode, originalCents: 19900, discountCents: 3980, finalCents: 15920, lowestPriceLast30DaysCents: 17900, currency: 'PLN' },
      },
    },
  },
});

const couponCourierFixture = fixtureFor('together-checkout-coupon-courier', stand, { shippingRates }, {
  route: `${checkout.route}?code=${couponCode}`,
  calls: {
    [`validateCouponForCheckout:[{"couponCode":"${couponCode}","priceId":"price-product-studio-course-101","productId":"product-studio-course-101"}]`]: {
      ok: true,
      value: {
        recurringDuration: 'first_invoice',
        breakdown: { couponId: 'coupon-studio-20', code: couponCode, originalCents: 15900, discountCents: 3180, finalCents: 12720, lowestPriceLast30DaysCents: 15900, currency: 'PLN' },
      },
    },
  },
});

const bundleLines = [
  {
    productId: 'product-studio-stand-oak', baseProductId: 'product-studio-stand-oak', name: 'Printed desk stand', type: 'physical', deliveryMethod: 'shipping',
    compliance, personalization: null, grossCents: 15900, netCents: 12927, vatCents: 2973, vatRate: 23, vatExemptionBasis: null,
    variants: [
      { productId: 'product-studio-stand-oak', slug: 'stand-oak', label: 'Oak', soldOut: false },
      { productId: 'product-studio-stand-walnut', slug: 'stand-walnut', label: 'Walnut', soldOut: false },
    ],
  },
  {
    productId: 'product-studio-workbook', name: 'Printed workbook', type: 'physical', deliveryMethod: 'shipping',
    compliance: { ...compliance, modelIdentifier: 'BOOK-2', safetyWarnings: '', safetyWarningsHtml: '' }, personalization: null,
    grossCents: 4200, netCents: 4000, vatCents: 200, vatRate: 5, vatExemptionBasis: null, variants: [],
  },
  {
    productId: 'product-studio-course-101', name: 'Together 101 Course', type: 'course', deliveryMethod: 'pickup',
    compliance: null, personalization: null, grossCents: 12300, netCents: 10000, vatCents: 2300, vatRate: 23, vatExemptionBasis: null, variants: [],
  },
];
const bundleFixture = {
  ...checkout,
  scenario: 'together-checkout-sales-link',
  route: '/offer/desk-set?checkout=together',
  calls: {
    ...checkout.calls,
    'getPublicSalesLink:[{"slug":"desk-set","variant":[]}]': { ok: true, value: {
      salesLink: { slug: 'desk-set', heading: 'Desk set with the online course', description: '', validFrom: null, validTo: null },
      descriptionHtml: '<p>A printed stand, a workbook and the full course in one order.</p>',
      lines: bundleLines,
      currency: 'PLN',
      totalCents: 32400,
      soldOut: false,
      tenant,
      marketingConsents: [],
    } },
    'publicPaymentConfig:[]': { ok: true, value: { ...recordedPaymentConfig, simulatedPaymentsEnabled: false, stripeConfigured: true, shippingRates } },
  },
};

const chooseRate = async (canvasElement: HTMLElement, name: RegExp) => {
  await userEvent.click(await within(canvasElement).findByRole('radio', { name }));
};
const chooseLocker = async (canvasElement: HTMLElement, code: string) => {
  await chooseRate(canvasElement, /parcel locker/u);
  await userEvent.type(await within(canvasElement).findByTestId('checkout-pickup-point'), code);
};
const tickEngraving = async (canvasElement: HTMLElement, text: string) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('checkbox', { name: /Add an engraving/u }));
  if (text !== '') await userEvent.type(await canvas.findByLabelText('Engraving text'), text);
};
const leaveField = async (canvasElement: HTMLElement, find: (canvas: ReturnType<typeof within>) => Promise<HTMLElement>) => {
  const field = await find(within(canvasElement));
  field.focus();
  field.blur();
};
const openSafetyDetails = async (canvasElement: HTMLElement) => {
  const safety = within(await within(canvasElement).findByTestId('product-safety-info'));
  for (const toggle of safety.getAllByRole('button', { name: /Details/u })) await userEvent.click(toggle);
};
const settled = async () => {
  const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.all(finite.map((animation) => animation.finished));
};
const openSummaryDetails = async (canvasElement: HTMLElement) => {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Details and VAT' }));
};
const mobile375 = { parameters: { viewport: { defaultViewport: 'mobile-375' } }, globals: { viewport: { value: 'mobile-375' } } };

const meta = {
  title: 'Pages/Together checkout', render: () => <></>, decorators: [withPage],
  parameters: { layout: 'fullscreen', locale: 'en', fixture: deliveryFixture },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Delivery: Story = {};
export const DeliveryPolish: Story = { parameters: { locale: 'pl' } };
export const DeliveryMobile: Story = mobile375;
export const DeliveryDark: Story = { parameters: { colorScheme: 'dark' } };
export const LockerChosen: Story = { play: async ({ canvasElement }) => chooseLocker(canvasElement, 'WAW01M') };
export const LockerChosenMobile: Story = { ...mobile375, play: async ({ canvasElement }) => chooseLocker(canvasElement, 'WAW01M') };
export const CourierChosen: Story = { play: async ({ canvasElement }) => chooseRate(canvasElement, /courier/u) };
export const CourierChosenDark: Story = { parameters: { colorScheme: 'dark' }, play: async ({ canvasElement }) => chooseRate(canvasElement, /courier/u) };
export const InvoiceOpen: Story = {
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    const invoiceRow = await within(canvasElement).findByTestId('checkout-invoice-reveal');
    await settled();
    const before = invoiceRow.getBoundingClientRect().top;
    await userEvent.click(invoiceRow);
    await expect(invoiceRow.getBoundingClientRect().top).toBe(before);
  },
};
export const CouponApplied: Story = {
  parameters: { fixture: couponFixture },
  play: async ({ canvasElement }) => { await within(canvasElement).findByTestId('checkout-coupon-breakdown', {}, { timeout: 5000 }); },
};
export const SafetyDetailsOpen: Story = { play: async ({ canvasElement }) => openSafetyDetails(canvasElement) };
export const Variants: Story = { parameters: { fixture: variantsFixture } };
export const ValidationError: Story = {
  parameters: { docs: { description: { story: 'A parcel locker code that does not match the 4-12 letters or digits pattern.' } } },
  play: async ({ canvasElement }) => {
    await chooseLocker(canvasElement, 'A-1');
    await leaveField(canvasElement, (canvas) => canvas.findByTestId('checkout-pickup-point'));
  },
};
export const FreeOrder: Story = { parameters: { fixture: freeFixture } };
export const SignedInBuyer: Story = { parameters: { fixture: signedInFixture }, play: async ({ canvasElement }) => chooseRate(canvasElement, /courier/u) };
export const PersonalisationUnticked: Story = { parameters: { fixture: personalisationFixture('together-checkout-personalisation-unticked', null) } };
export const PersonalisationTicked: Story = {
  parameters: { fixture: personalisationFixture('together-checkout-personalisation-ticked', null) },
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    await tickEngraving(canvasElement, 'For Alex, with love');
  },
};
export const PersonalisationCondition: Story = {
  parameters: { fixture: personalisationFixture('together-checkout-personalisation-condition', engravingCondition) },
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    await tickEngraving(canvasElement, 'For Alex, with love');
  },
};
export const PersonalisationError: Story = {
  parameters: { fixture: personalisationFixture('together-checkout-personalisation-error', null) },
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    await tickEngraving(canvasElement, '');
    await leaveField(canvasElement, (canvas) => canvas.findByLabelText('Engraving text'));
  },
};
export const SalesLink: Story = { parameters: { fixture: bundleFixture } };
export const SalesLinkMobile: Story = { ...mobile375, parameters: { ...mobile375.parameters, fixture: bundleFixture } };
export const SalesLinkDetailsOpen: Story = {
  parameters: { fixture: bundleFixture },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Details and VAT' }));
    await openSafetyDetails(canvasElement);
  },
};
export const SalesLinkCourierDetailsOpen: Story = {
  parameters: { fixture: bundleFixture },
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    await openSummaryDetails(canvasElement);
  },
};
export const CouponCourier: Story = {
  parameters: { fixture: couponCourierFixture },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByTestId('checkout-coupon-breakdown', {}, { timeout: 5000 });
    await chooseRate(canvasElement, /courier/u);
    await openSummaryDetails(canvasElement);
  },
};
