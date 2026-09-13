import type { Meta, StoryObj } from '@storybook/react-vite';

import checkout from '../fixtures/checkout.json';
import integrations from '../fixtures/panel-integrations-email.json';
import { withPage } from '../page-decorators.js';

const checkoutFixture = {
  ...checkout,
  scenario: 'stripe-test-checkout',
  calls: {
    ...checkout.calls,
    'publicPaymentConfig:[]': { ok: true, value: {
      stripeConfigured: true, simulatedPaymentsEnabled: false, canTest: true, testConfigured: true, testEnabled: true,
    } },
  },
};
const integrationFixture = {
  ...integrations,
  scenario: 'stripe-test-integration',
  route: '/panel/integrations#stripe',
  calls: {
    ...integrations.calls,
    'listTenantSecrets:[]': { ok: true, value: {
      stripeMode: 'live', stripeWebhookUrl: 'https://example.test/api/webhooks/stripe/studio',
      stripeTestLastEventAt: '2026-07-01T12:00:00.000Z',
      secrets: ['stripe.restrictedKey', 'stripe.webhookSecret', 'stripe.testRestrictedKey', 'stripe.testWebhookSecret'].map((key) => ({
        key, maskedPreview: '••••1234', updatedAt: '2026-07-01T12:00:00.000Z',
      })),
    } },
  },
};
const meta = {
  title: 'Pages/Stripe test mode', render: () => <></>, decorators: [withPage],
  parameters: { layout: 'fullscreen', locale: 'en', fixture: checkoutFixture },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const StaffCheckout: Story = {};
export const StaffCheckoutPolish: Story = { parameters: { locale: 'pl' } };
export const Integration: Story = { parameters: { fixture: integrationFixture } };
export const IntegrationPolish: Story = { parameters: { fixture: integrationFixture, locale: 'pl' } };
