import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { stripeTermsUrlMissing } from '#core/domain/index.js';

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
const lockerMapFixture = fixtureFor('together-checkout-locker-map', stand, { shippingRates, inpostGeowidgetToken: 'story-geowidget-token', inpostGeowidgetWithheld: false, canTest: false, testEnabled: false });
const variantsFixture = fixtureFor('together-checkout-variants', { ...stand, variants: standVariants }, { shippingRates });
const freeFixture = fixtureFor('together-checkout-free', { priceCents: 0, prices: [price(0)] }, {});
const signedInFixture = fixtureFor('together-checkout-signed-in', stand, { shippingRates }, { calls: { 'me:[]': account.calls['me:[]'] } });
const personalisationFixture = (scenario: string, condition: string | null) => fixtureFor(scenario, { ...stand, personalization: { ...engraving, condition } }, { shippingRates });

const termsRefusalCall = 'createCheckoutSession:[{"language":"en","priceId":"price-product-studio-course-101","productId":"product-studio-course-101","shipping":{"rateId":"courier"}}]';
const termsFallbackFixture = {
  ...fixtureFor('together-checkout-terms-fallback', stand, { shippingRates }, { calls: { [termsRefusalCall]: { ok: false, error: stripeTermsUrlMissing() } } }),
  expectedErrors: { [termsRefusalCall]: 'integration_not_configured' },
};
const signedInEmail = account.calls['me:[]'].value.email;
const signedInTermsRefusalCall = `createCheckoutSession:[{"email":"${signedInEmail}","language":"en","priceId":"price-product-studio-course-101","productId":"product-studio-course-101","shipping":{"rateId":"courier"}}]`;
const signedInTermsFallbackFixture = {
  ...fixtureFor('together-checkout-terms-fallback-signed-in', stand, { shippingRates }, { calls: { 'me:[]': account.calls['me:[]'], [signedInTermsRefusalCall]: { ok: false, error: stripeTermsUrlMissing() } } }),
  expectedErrors: { [signedInTermsRefusalCall]: 'integration_not_configured' },
};

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

const couponEmailCall = `validateCouponForCheckout:[{"couponCode":"${couponCode}","priceId":"price-product-studio-course-101","productId":"product-studio-course-101"}]`;
const couponEmailFixture = {
  ...fixtureFor('together-checkout-coupon-email', {}, {}, {
    calls: { [couponEmailCall]: { ok: false, error: { code: 'validation', message: 'An email is required to validate this coupon' } } },
  }),
  expectedErrors: { [couponEmailCall]: 'validation' },
};

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
const otherManufacturer = {
  ...compliance,
  manufacturerName: 'Akademia Press',
  manufacturerAddress: 'Sample Avenue 12, 30-002 Cracow',
  manufacturerEmail: 'safety@akademia.togethercommunity.app',
  modelIdentifier: 'BOOK-2',
  safetyWarnings: 'Not suitable for children under 3 years.',
  safetyWarningsHtml: '<p>Not suitable for children under 3 years.</p>',
};
const bundleFixtureWith = (scenario: string, lines: readonly unknown[]) => ({
  ...checkout,
  scenario,
  route: '/offer/desk-set?checkout=together',
  calls: {
    ...checkout.calls,
    'getPublicSalesLink:[{"slug":"desk-set","variant":[]}]': { ok: true, value: {
      salesLink: { slug: 'desk-set', heading: 'Desk set with the online course', description: '', validFrom: null, validTo: null },
      descriptionHtml: '<p>A printed stand, a workbook and the full course in one order.</p>',
      lines,
      currency: 'PLN',
      totalCents: 32400,
      soldOut: false,
      tenant,
      marketingConsents: [],
    } },
    'publicPaymentConfig:[]': { ok: true, value: { ...recordedPaymentConfig, simulatedPaymentsEnabled: false, stripeConfigured: true, shippingRates } },
  },
});
const bundleFixture = bundleFixtureWith('together-checkout-sales-link', bundleLines);
const twoManufacturersFixture = bundleFixtureWith('together-checkout-two-manufacturers', bundleLines.map((line) =>
  line.productId === 'product-studio-workbook' ? { ...line, compliance: otherManufacturer } : line));

const STUB_MAP_TAG = 'inpost-geowidget';
const stubPoint = { name: 'WAW01M', location_description: 'Next to the pharmacy entrance', address: { line1: 'Example Street 5', line2: '00-001 Warsaw' } };
class StubGeowidget extends HTMLElement {
  connectedCallback() {
    this.style.cssText = 'display:grid;place-items:center;height:100%;border-radius:8px;color:inherit;font:inherit;' +
      'background:repeating-linear-gradient(0deg,color-mix(in srgb,currentColor 8%,transparent) 0 1px,transparent 1px 32px),' +
      'repeating-linear-gradient(90deg,color-mix(in srgb,currentColor 8%,transparent) 0 1px,transparent 1px 32px),color-mix(in srgb,currentColor 4%,transparent);';
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.textContent = stubPoint.name;
    pin.dataset['testid'] = 'stub-geowidget-pin';
    pin.style.cssText = 'white-space:nowrap;padding:0.4rem 0.75rem;border-radius:999px;border:1px solid currentColor;background:Canvas;color:inherit;font:inherit;cursor:pointer;';
    pin.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent(this.getAttribute('onpoint') ?? '', { detail: stubPoint }));
    });
    this.replaceChildren(pin);
  }
}
const stubGeowidget = () => {
  if (customElements.get(STUB_MAP_TAG) === undefined) customElements.define(STUB_MAP_TAG, StubGeowidget);
  const placeholders = [document.createElement('script'), document.createElement('link')];
  placeholders[0]?.setAttribute('id', 'inpost-geowidget-script');
  placeholders[1]?.setAttribute('id', 'inpost-geowidget-style');
  document.head.append(...placeholders);
  return () => { for (const element of placeholders) element.remove(); };
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
const chooseLockerOnMap = async (canvasElement: HTMLElement, pick: boolean) => {
  await chooseRate(canvasElement, /parcel locker/u);
  const pin = await within(canvasElement).findByTestId('stub-geowidget-pin');
  if (pick) {
    await userEvent.click(pin);
    await within(canvasElement).findByTestId('checkout-pickup-point-selected');
  }
};
const settled = async () => {
  const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
};
const openSummaryDetails = async (canvasElement: HTMLElement) => {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Details and VAT' }));
};
const mobile375 = { parameters: { viewport: { defaultViewport: 'mobile-375' } }, globals: { viewport: { value: 'mobile-375' } } };
const lockerMap = (scheme: { colorScheme?: 'dark' }, viewport: typeof mobile375 | null, pick: boolean): Story => ({
  ...(viewport === null ? {} : { globals: viewport.globals }),
  parameters: { ...viewport?.parameters, ...scheme, fixture: lockerMapFixture },
  beforeEach: stubGeowidget,
  play: async ({ canvasElement }) => chooseLockerOnMap(canvasElement, pick),
});

const meta = {
  title: 'Pages/Together checkout', render: () => <></>, decorators: [withPage],
  parameters: { layout: 'fullscreen', locale: 'en', fixture: deliveryFixture },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const withMobile = (story: Story): Story => ({ ...mobile375, ...story, parameters: { ...mobile375.parameters, ...story.parameters } });
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
export const DiscountOpenEmpty: Story = {
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    await userEvent.click(await within(canvasElement).findByTestId('checkout-coupon-reveal'));
  },
};
export const DiscountOpenEmptyMobile: Story = {
  ...mobile375,
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    await userEvent.click(await within(canvasElement).findByTestId('checkout-coupon-reveal'));
  },
};
export const CouponApplied: Story = {
  parameters: { fixture: couponFixture },
  play: async ({ canvasElement }) => { await within(canvasElement).findByTestId('checkout-coupon-breakdown', {}, { timeout: 5000 }); },
};
export const CouponAppliedDark: Story = { ...CouponApplied, parameters: { ...CouponApplied.parameters, colorScheme: 'dark' } };
const askForCouponEmail = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByTestId('checkout-coupon-reveal'));
  await userEvent.type(await canvas.findByLabelText('Discount code'), couponCode);
  await userEvent.click(canvas.getByRole('button', { name: 'Apply code' }));
  await expect(await canvas.findByLabelText('Email', {}, { timeout: 5000 })).toBeVisible();
};
export const CouponEmailRequired: Story = {
  parameters: {
    fixture: couponEmailFixture,
    docs: { description: { story: 'The code has a per-person limit, so the discount row asks for the email in place and the buyer applies the code again.' } },
  },
  play: async ({ canvasElement }) => askForCouponEmail(canvasElement),
};
export const CouponEmailRequiredMobile: Story = withMobile(CouponEmailRequired);
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
export const LockerMap: Story = lockerMap({}, null, false);
export const LockerMapMobile: Story = lockerMap({}, mobile375, false);
export const LockerMapDark: Story = lockerMap({ colorScheme: 'dark' }, null, false);
export const LockerMapMobileDark: Story = lockerMap({ colorScheme: 'dark' }, mobile375, false);
export const LockerPicked: Story = lockerMap({}, null, true);
export const LockerPickedMobile: Story = lockerMap({}, mobile375, true);
export const LockerPickedDark: Story = lockerMap({ colorScheme: 'dark' }, null, true);
export const LockerPickedMobileDark: Story = lockerMap({ colorScheme: 'dark' }, mobile375, true);
export const TwoManufacturers: Story = { parameters: { fixture: twoManufacturersFixture } };
export const TwoManufacturersMobile: Story = { ...mobile375, parameters: { ...mobile375.parameters, fixture: twoManufacturersFixture } };
export const TwoManufacturersDetailsOpen: Story = {
  parameters: { fixture: twoManufacturersFixture },
  play: async ({ canvasElement }) => openSafetyDetails(canvasElement),
};
export const TwoManufacturersOnePanelOpen: Story = {
  parameters: { fixture: twoManufacturersFixture },
  play: async ({ canvasElement }) => {
    const [first] = within(await within(canvasElement).findByTestId('product-safety-info')).getAllByRole('button', { name: /Details/u });
    if (first === undefined) throw new Error('expected a Details toggle per manufacturer');
    await userEvent.click(first);
  },
};
export const StripeTermsFallback: Story = {
  parameters: {
    fixture: termsFallbackFixture,
    docs: { description: { story: 'The Stripe account has no terms of service URL in its Dashboard, so the page asks for the email and the terms itself and keeps the chosen delivery.' } },
  },
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    await userEvent.click(await within(canvasElement).findByTestId('checkout-pay-cta'));
    await within(canvasElement).findByTestId('checkout-terms-fallback-line');
    await expect(await within(canvasElement).findByLabelText('Email')).toHaveFocus();
  },
};
export const StripeTermsFallbackSignedIn: Story = {
  parameters: {
    fixture: signedInTermsFallbackFixture,
    docs: { description: { story: 'The same refusal for a signed-in buyer: the page already knows the email, so it asks only for the terms and moves focus to the checkbox.' } },
  },
  play: async ({ canvasElement }) => {
    await chooseRate(canvasElement, /courier/u);
    await userEvent.click(await within(canvasElement).findByTestId('checkout-pay-cta'));
    await within(canvasElement).findByTestId('checkout-terms-fallback-line');
    await expect(within(await within(canvasElement).findByTestId('terms-consent')).getByRole('checkbox')).toHaveFocus();
  },
};
