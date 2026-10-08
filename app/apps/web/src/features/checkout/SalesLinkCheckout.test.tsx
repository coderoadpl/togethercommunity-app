import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, it } from 'vitest';
import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { sampleBundleLines, sampleSalesLink } from '../../test/sales-link-fixtures.js';
import { CheckoutPage } from './CheckoutPage.js';

const renderOffer = () => {
  const root = createRootRoute({ component: () => <CheckoutPage productRef="" salesLinkSlug="complete-bundle" /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/offer/complete-bundle'] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};
const offer = {
  salesLink: sampleSalesLink, descriptionHtml: '<p>All items together.</p>', lines: sampleBundleLines.map((line) => ({ ...line, type: 'course' })), currency: 'PLN', totalCents: 18660,
  tenant: { slug: 'acme', name: 'Community', defaultLanguage: 'en', signInNotice: { enabled: false, text: '' }, branding: {}, socialLinks: [], legal: { termsUrl: 'https://example.test/terms', privacyUrl: null }, support: { url: null }, timezone: 'Europe/Warsaw' }, marketingConsents: [],
};

beforeEach(() => {
  window.history.replaceState(null, '', '/offer/complete-bundle');
  server.use(http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: true } })));
});

it('reuses consent and simulated checkout with the sales link and first product', async () => {
  let payload: unknown;
  server.use(
    http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: offer })),
    http.post('/api/dev/simulate-purchase', async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({ ok: true, data: { memberId: 'm1', productId: 'product-1', alreadyOwned: false, subscriptionId: null, orderId: 'order-1', magicLink: null } });
    }),
  );
  renderOffer();
  expect(await screen.findByRole('heading', { name: sampleSalesLink.heading })).toBeVisible();
  await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.test');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: en.salesLinks.buyBundle }));
  expect(await screen.findByText(en.checkout.accessGrantedTitle)).toBeVisible();
  expect(payload).toMatchObject({ productId: 'product-1', salesLinkSlug: 'complete-bundle', email: 'buyer@example.test', termsAccepted: true });
});

it('shows unavailable notice for an unknown or inactive offer', async () => {
  server.use(http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Sales link not found' } }, { status: 404 })));
  renderOffer();
  expect(await screen.findByText(en.checkout.unavailableTitle)).toBeVisible();
  expect(screen.queryByRole('button', { name: en.salesLinks.buyBundle })).toBeNull();
});
