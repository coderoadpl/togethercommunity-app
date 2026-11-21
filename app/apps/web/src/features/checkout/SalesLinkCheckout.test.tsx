import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';
import { en } from '../../i18n/en.js';
import { formatPrice } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server } from '../../test/server.js';
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
  server.use(anonymousMe(), http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Community' }, contentVersion: 1, products: [] } })));
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
  const pay = screen.getByTestId('checkout-pay-cta');
  expect(pay.textContent?.replace(/\s+/gu, ' ')).toBe(en.checkout.payIdle({ price: formatPrice(18660, 'PLN', 'en') }).replace(/\s+/gu, ' '));
  await userEvent.click(pay);
  expect(await screen.findByText(en.checkout.accessGrantedTitle)).toBeVisible();
  expect(payload).toMatchObject({ productId: 'product-1', salesLinkSlug: 'complete-bundle', email: 'buyer@example.test', termsAccepted: true });
});

it('shows unavailable notice for an unknown or inactive offer', async () => {
  server.use(http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Sales link not found' } }, { status: 404 })));
  renderOffer();
  expect(await screen.findByText(en.salesLinks.offerUnavailableTitle)).toBeVisible();
  expect(screen.getByText(en.salesLinks.offerUnavailableBody)).toBeVisible();
  expect(screen.getByRole('link', { name: en.salesLinks.goHome })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('link', { name: en.checkout.goToLogin })).toBeNull();
  expect(screen.queryByTestId('checkout-pay-cta')).toBeNull();
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
  expect(await screen.findByText(en.salesLinks.offerUnavailableBody)).toBeVisible();
  expect(screen.getByRole('link', { name: en.salesLinks.goHome })).toHaveAttribute('href', '/');
  expect(screen.queryByLabelText(en.checkout.emailLabel)).toBeNull();
  expect(screen.queryByTestId('checkout-pay-cta')).toBeNull();
  expect(document.querySelector('form')).toBeNull();
});

it('names the lines that ran out above the summary of a sold-out bundle', async () => {
  window.history.replaceState(null, '', '/offer/complete-bundle?checkout=together');
  server.use(http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: {
    ...offer, soldOut: true, lines: offer.lines.map((line, index) => ({ ...line, maxQuantity: index === 0 ? 0 : 1 })),
  } })));
  renderOffer();
  const notice = await screen.findByTestId('bundle-sold-out-notice');
  expect(notice).toHaveTextContent(en.salesLinks.soldOutTitle);
  expect(notice).toHaveTextContent(en.salesLinks.soldOutLines({ names: 'Printed workbook' }));
});

it.each([
  ['in stock', false, en.salesLinks.variantSoldOutTitle, en.salesLinks.variantSoldOutLines({ names: 'Printed workbook (Oak)' })],
  ['sold out too', true, en.salesLinks.soldOutTitle, en.salesLinks.soldOutLines({ names: 'Printed workbook' })],
] as const)('tells the buyer to pick another variant only when a sibling variant is %s', async (_case, siblingSoldOut, title, body) => {
  window.history.replaceState(null, '', '/offer/complete-bundle?checkout=together');
  const variants = [
    { productId: 'product-1', slug: 'workbook-oak', label: 'Oak', soldOut: true, available: 0 },
    { productId: 'product-1-walnut', slug: 'workbook-walnut', label: 'Walnut', soldOut: siblingSoldOut, available: siblingSoldOut ? 0 : 4 },
  ];
  server.use(http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: {
    ...offer, soldOut: true, lines: offer.lines.map((line, index) => index === 0 ? { ...line, baseProductId: 'product-1', variants, maxQuantity: 0 } : { ...line, maxQuantity: 1 }),
  } })));
  renderOffer();
  const notice = await screen.findByTestId('bundle-sold-out-notice');
  expect(notice).toHaveTextContent(title);
  expect(notice).toHaveTextContent(body);
});

it('puts the gross price on the line name row and the tax detail and delivery in captions', async () => {
  window.history.replaceState(null, '', '/offer/complete-bundle?checkout=together');
  server.use(http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: {
    ...offer, lines: offer.lines.map((line, index) => index === 0 ? { ...line, type: 'physical', deliveryMethod: 'shipping' } : line),
  } })));
  renderOffer();
  await userEvent.click(await screen.findByRole('button', { name: en.checkout.summaryDetails }));
  const first = screen.getByTestId('offer-line-product-1');
  expect(within(first).getByRole('heading', { level: 2, name: 'Printed workbook' })).toBeVisible();
  expect(within(first).getByTestId('offer-line-gross').textContent).toBe(formatPrice(4200, 'PLN', 'en'));
  expect(within(first).getByTestId('offer-line-kind')).toHaveTextContent(`${en.salesLinks.lineTypes.physical} · ${en.salesLinks.lineDelivery.shipping}`);
  const taxes = within(first).getByTestId('offer-line-cells');
  expect(within(first).getByTestId('offer-line-kind').compareDocumentPosition(taxes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(taxes.tagName).toBe('DL');
  expect(within(taxes).getByText(en.salesLinks.net).tagName).toBe('DT');
  expect(within(taxes).queryByText(en.salesLinks.gross)).toBeNull();
  expect(within(screen.getByTestId('offer-line-product-3')).getByTestId('offer-line-kind')).toHaveTextContent(en.salesLinks.lineTypes.course);
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

it('retries a live sales link through the server handoff with its attribution after cancellation', async () => {
  window.history.replaceState(null, '', '/offer/complete-bundle?status=cancelled&utm_source=meta&utm_medium=paid&fbclid=X&gclid=%3Cinvalid%3E');
  renderOffer();
  expect(await screen.findByRole('link', { name: en.checkout.retry })).toHaveAttribute('href', '/offer/complete-bundle?utm_source=meta&utm_medium=paid&fbclid=X');
});

it('resubmits attribution after cancellation on the manual sales-link checkout', async () => {
  window.history.replaceState(null, '', '/offer/complete-bundle?status=cancelled&checkout=together&utm_source=meta&utm_medium=paid&fbclid=X');
  let payload: unknown;
  server.use(
    http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: offer })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false } })),
    http.post('/api/public/checkout/session', async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Checkout unavailable' } }, { status: 400 });
    }),
  );
  renderOffer();
  await userEvent.click(await screen.findByRole('button', { name: en.checkout.retry }));
  await userEvent.click(await screen.findByTestId('checkout-pay-cta'));
  await waitFor(() => expect(payload).toMatchObject({ attribution: { utmSource: 'meta', utmMedium: 'paid', fbclid: 'X' } }));
  expect(new URLSearchParams(window.location.search).get('checkout')).toBe('together');
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
  expect(screen.queryByLabelText(en.checkout.emailLabel)).toBeNull();
  expect(screen.queryByLabelText(/I accept/)).toBeNull();
  await userEvent.click(screen.getByTestId('checkout-pay-cta'));
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
  await userEvent.click(screen.getByTestId('checkout-pay-cta'));
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
  expect(modes).toEqual(['test', 'test']);
  locationSpy.mockRestore();
});
