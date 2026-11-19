import type { Meta, StoryObj } from '@storybook/react-vite';

import checkout from '../fixtures/checkout.json';
import { withPage } from '../page-decorators.js';

const offerKey = 'publicOffer:["product-studio-course-101"]';
const recordedOffer = checkout.calls[offerKey].value;
const price = (amountCents: number) => ({ id: 'price-product-studio-course-101', kind: 'one_time', interval: null, amountCents, currency: 'PLN' });
const legal = { termsUrl: 'https://studio.togethercommunity.app/terms', privacyUrl: 'https://studio.togethercommunity.app/privacy' };
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

const fixtureFor = (scenario: string, product: Record<string, unknown>, payment: Record<string, unknown>) => ({
  ...checkout,
  scenario,
  calls: {
    ...checkout.calls,
    [offerKey]: { ok: true, value: { ...recordedOffer, tenant: { ...recordedOffer.tenant, legal }, products: [{ ...recordedOffer.products[0], ...product }] } },
    'publicPaymentConfig:[]': { ok: true, value: { ...checkout.calls['publicPaymentConfig:[]'].value, simulatedPaymentsEnabled: false, stripeConfigured: true, ...payment } },
  },
});

const deliveryFixture = fixtureFor('together-checkout-delivery', {
  type: 'physical',
  deliveryMethod: 'shipping',
  title: 'Printed desk stand',
  description: '<p>A sturdy stand for a laptop or a book, printed to order.</p>',
  priceCents: 15900,
  prices: [price(15900)],
  compliance,
}, { shippingRates });

const freeFixture = fixtureFor('together-checkout-free', { priceCents: 0, prices: [price(0)] }, {});

const meta = {
  title: 'Pages/Together checkout', render: () => <></>, decorators: [withPage],
  parameters: { layout: 'fullscreen', locale: 'en', fixture: deliveryFixture },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Delivery: Story = {};
export const DeliveryPolish: Story = { parameters: { locale: 'pl' } };
export const DeliveryMobile: Story = { parameters: { viewport: { defaultViewport: 'mobile-375' } }, globals: { viewport: { value: 'mobile-375' } } };
export const DeliveryDark: Story = { parameters: { colorScheme: 'dark' } };
export const FreeOrder: Story = { parameters: { fixture: freeFixture } };
