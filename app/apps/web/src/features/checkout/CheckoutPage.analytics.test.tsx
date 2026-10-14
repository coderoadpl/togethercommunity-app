import { act, screen } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const analytics = vi.hoisted(() => ({ loadGoogleTag: vi.fn(), trackCheckoutPurchase: vi.fn() }));
vi.mock('./analytics.js', () => analytics);
const config = {
  tagId: 'GTM-ABC1234', consentCookieName: 'consent',
  consentCookieValue: null, consentEvent: null, loadWithoutConsent: false,
};
const purchase = {
  transactionId: 'order-1', value: 99, currency: 'PLN', offerSlug: 'bundle',
  items: [{ itemId: 'course-1', itemName: 'Course', price: 99 }],
};

const renderCheckout = async (path: string) => {
  window.history.replaceState(null, '', path);
  const root = createRootRoute({ component: () => <CheckoutPage productRef="course-1" {...(path.startsWith('/offer/') ? { salesLinkSlug: 'bundle' } : {})} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [path] }) });
  const rendered = renderWithProviders(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
    await vi.advanceTimersByTimeAsync(1);
  });
  return rendered;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  analytics.loadGoogleTag.mockReturnValue(true);
  server.use(http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
    stripeConfigured: true, simulatedPaymentsEnabled: false, analytics: config,
  } })));
});
afterEach(() => vi.useRealTimers());

it.each(['/checkout/course-1', '/offer/bundle'])('loads on %s success and sends only after the paid payload arrives', async (path) => {
  let paid = false;
  server.use(http.get('/api/public/checkout/session-status', () => HttpResponse.json({ ok: true, data:
    paid ? { status: 'paid', analytics: purchase } : { status: 'pending' },
  })));
  await renderCheckout(`${path}?status=success&session_id=cs_live_one`);
  expect(screen.getByRole('heading', { name: en.checkout.successPendingTitle })).toBeVisible();
  expect(analytics.loadGoogleTag).toHaveBeenCalledExactlyOnceWith(config);
  expect(analytics.trackCheckoutPurchase).not.toHaveBeenCalled();
  paid = true;
  await act(() => vi.advanceTimersByTimeAsync(3001));
  expect(analytics.loadGoogleTag).toHaveBeenCalledTimes(1);
  expect(analytics.trackCheckoutPurchase).toHaveBeenCalledExactlyOnceWith(config, 'cs_live_one', purchase);
});

it('does not reconsider declined consent when payment becomes paid', async () => {
  analytics.loadGoogleTag.mockReturnValue(false);
  let paid = false;
  server.use(http.get('/api/public/checkout/session-status', () => HttpResponse.json({ ok: true, data:
    paid ? { status: 'paid', analytics: purchase } : { status: 'pending' },
  })));
  await renderCheckout('/checkout/course-1?status=success&session_id=cs_live_one');
  analytics.loadGoogleTag.mockReturnValue(true);
  paid = true;
  await act(() => vi.advanceTimersByTimeAsync(3001));
  expect(analytics.loadGoogleTag).toHaveBeenCalledTimes(1);
  expect(analytics.trackCheckoutPurchase).not.toHaveBeenCalled();
});

it.each(['', '&session_id='])('loads without sending for a success return without session ID (%s)', async (query) => {
  await renderCheckout(`/checkout/course-1?status=success${query}`);
  expect(analytics.loadGoogleTag).toHaveBeenCalledExactlyOnceWith(config);
  expect(analytics.trackCheckoutPurchase).not.toHaveBeenCalled();
});

it.each(['/offer/bundle?status=cancelled', '/checkout/course-1?status=cancelled', '/checkout/course-1'])('does not load on %s', async (path) => {
  await renderCheckout(path);
  expect(analytics.loadGoogleTag).not.toHaveBeenCalled();
  expect(analytics.trackCheckoutPurchase).not.toHaveBeenCalled();
});

it.each(['&test_purchase=1', ''])('ignores test sessions even when the visitor cannot test (%s)', async (query) => {
  server.use(http.get('/api/public/checkout/session-status', () => HttpResponse.json({ ok: true, data: { status: 'paid', analytics: purchase } })));
  await renderCheckout(`/checkout/course-1?status=success&session_id=cs_test_one${query}`);
  expect(analytics.loadGoogleTag).not.toHaveBeenCalled();
  expect(analytics.trackCheckoutPurchase).not.toHaveBeenCalled();
});

it('does not load in an active staff test session', async () => {
  server.use(http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
    stripeConfigured: true, simulatedPaymentsEnabled: false, canTest: true, testEnabled: true, analytics: config,
  } })));
  await renderCheckout('/checkout/course-1?status=success');
  expect(analytics.loadGoogleTag).not.toHaveBeenCalled();
});

it('loads the tag but sends nothing for a paid response without analytics', async () => {
  server.use(http.get('/api/public/checkout/session-status', () => HttpResponse.json({ ok: true, data: { status: 'paid' } })));
  await renderCheckout('/checkout/course-1?status=success&session_id=cs_live_one');
  expect(analytics.loadGoogleTag).toHaveBeenCalledExactlyOnceWith(config);
  expect(analytics.trackCheckoutPurchase).not.toHaveBeenCalled();
});
