import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';
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
  tenant: { slug: 'acme', name: 'Community', defaultLanguage: 'en', signInNotice: { enabled: false, text: '' }, branding: {}, socialLinks: [], legal: { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' }, support: { url: null }, timezone: 'Europe/Warsaw' }, marketingConsents: [],
};

beforeEach(() => {
  window.history.replaceState(null, '', '/offer/complete-bundle');
  server.use(http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Community' }, contentVersion: 1, products: [] } })));
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

it.each([
  { termsUrl: null, privacyUrl: null },
  { termsUrl: 'https://example.test/terms', privacyUrl: null },
  { termsUrl: null, privacyUrl: 'https://example.test/privacy' },
])('shows an error without a fallback form when legal URLs are incomplete: %j', async (legal) => {
  window.history.replaceState(null, '', '/offer/complete-bundle?checkout=together');
  server.use(http.get('/api/public/sales-links/:slug', () => HttpResponse.json({
    ok: true, data: { ...offer, tenant: { ...offer.tenant, legal } },
  })));
  renderOffer();
  expect(await screen.findByRole('alert')).toHaveTextContent(en.checkout.unavailableTitle);
  expect(screen.queryByLabelText(en.checkout.emailLabel)).toBeNull();
  expect(screen.queryByRole('button', { name: en.salesLinks.buyBundle })).toBeNull();
  expect(document.querySelector('form')).toBeNull();
});

it.each([true, false])('shows the sales-link test success notice only to staff: %s', async (canTest) => {
  window.history.replaceState(null, '', '/offer/complete-bundle?status=success&test_purchase=1');
  server.use(http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
    stripeConfigured: true, simulatedPaymentsEnabled: false, canTest, testConfigured: canTest, testEnabled: canTest,
  } })));
  renderOffer();
  expect(await screen.findByText(canTest ? en.checkout.testPurchaseBody : en.checkout.successBody)).toBeVisible();
  await waitFor(() => expect(screen.queryByText(en.checkout.testPurchase) !== null).toBe(canTest));
  expect(screen.queryByText(en.checkout.successBody) !== null).toBe(!canTest);
  expect(screen.queryByText(en.checkout.successPendingBody)).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('retries a live sales link through the server handoff after cancellation', async () => {
  window.history.replaceState(null, '', '/offer/complete-bundle?status=cancelled');
  renderOffer();
  expect(await screen.findByRole('link', { name: en.checkout.retry })).toHaveAttribute('href', '/offer/complete-bundle');
});

it('keeps staff test checkout and cancellation retries on the manual checkout page', async () => {
  window.history.replaceState(null, '', '/offer/complete-bundle?checkout=together');
  let testEnabled = false;
  const modes: string[] = [];
  const assign = vi.fn();
  const location = window.location;
  const locationSpy = vi.spyOn(window, 'location', 'get').mockImplementation(() => ({ ...location, assign }));
  server.use(
    http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: offer })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: true, simulatedPaymentsEnabled: false, canTest: true,
      testConfigured: true, testEnabled,
    } })),
    http.post('/api/checkout/stripe-test-session', () => {
      testEnabled = true;
      return HttpResponse.json({ ok: true, data: { enabled: true } });
    }),
    http.post('/api/public/checkout/session', () => {
      modes.push(testEnabled ? 'test' : 'live');
      testEnabled = false;
      return HttpResponse.json({ ok: true, data: { url: 'https://checkout.stripe.com/session' } });
    }),
  );

  const initial = renderOffer();
  await userEvent.click(await screen.findByTestId('checkout-test-mode-switch'));
  expect(await screen.findByTestId('checkout-test-mode-hint')).toHaveTextContent(en.checkout.testModeHint);
  expect(modes).toEqual([]);
  await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'staff@example.test');
  await userEvent.click(screen.getByLabelText(/I accept/));
  await userEvent.click(screen.getByRole('button', { name: en.salesLinks.buyBundle }));
  await waitFor(() => expect(assign).toHaveBeenCalledOnce());
  expect(modes).toEqual(['test']);
  initial.unmount();

  window.history.replaceState(null, '', '/offer/complete-bundle?status=cancelled&checkout=together');
  renderOffer();
  await userEvent.click(await screen.findByRole('button', { name: en.checkout.retry }));
  expect(await screen.findByTestId('checkout-test-mode-switch')).toBeVisible();
  expect(screen.queryByTestId('checkout-test-mode-hint')).toBeNull();
  expect(window.location.search).toBe('?checkout=together');
  expect(screen.queryByRole('link', { name: en.checkout.retry })).toBeNull();
  expect(modes).toEqual(['test']);
  expect(assign).toHaveBeenCalledOnce();

  await userEvent.click(screen.getByTestId('checkout-test-mode-switch'));
  expect(await screen.findByTestId('checkout-test-mode-hint')).toHaveTextContent(en.checkout.testModeHint);
  await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'staff@example.test');
  await userEvent.click(screen.getByLabelText(/I accept/));
  await userEvent.click(screen.getByRole('button', { name: en.salesLinks.buyBundle }));
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
  expect(modes).toEqual(['test', 'test']);
  locationSpy.mockRestore();
});
