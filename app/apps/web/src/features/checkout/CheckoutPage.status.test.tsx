import { act, screen, within } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const renderReturn = async (query: string) => {
  window.history.replaceState(null, '', `/checkout/course-1?status=success${query}`);
  const root = createRootRoute({ component: () => <CheckoutPage productRef="course-1" /> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [`/checkout/course-1?status=success${query}`] }),
  });
  const rendered = renderWithProviders(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
    await vi.advanceTimersByTimeAsync(1);
  });
  return rendered;
};

const offerWithSupport = (url: string | null) =>
  http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: {
    tenant: { slug: 'acme', name: 'Acme School', support: { url } }, contentVersion: 1, products: [],
  } }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('shows the pending card before the first status response', async () => {
  let resolveResponse: (response: Response) => void = () => undefined;
  const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  server.use(http.get('/api/public/checkout/session-status', () => response));
  await renderReturn('&session_id=cs_live_example');

  expect(screen.getByRole('heading', { name: en.checkout.successPendingTitle })).toBeVisible();
  expect(screen.getByText(en.checkout.successPendingEyebrow)).toBeVisible();
  expect(screen.queryByText(en.checkout.successPaidEyebrow)).toBeNull();
  expect(screen.getByText(en.checkout.successPendingBody)).toBeVisible();
  expect(screen.getByRole('progressbar', { name: en.checkout.successPendingTitle })).toBeVisible();
  await act(async () => {
    resolveResponse(HttpResponse.json({ ok: true, data: { status: 'paid' } }));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(within(screen.getByRole('status')).getByRole('heading', { name: en.checkout.successTitle })).toBeVisible();
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
});

it('renders pending immediately, follows confirmation, and stops polling once paid', async () => {
  let requests = 0;
  let paid = false;
  server.use(http.get('/api/public/checkout/session-status', ({ request }) => {
    expect(new URL(request.url).searchParams.get('session_id')).toBe('cs_live_example');
    requests += 1;
    return HttpResponse.json({ ok: true, data: { status: paid ? 'paid' : 'pending' } });
  }));
  await renderReturn('&session_id=cs_live_example');

  expect(screen.getByRole('heading', { name: en.checkout.successPendingTitle })).toBeVisible();
  expect(screen.getByText(en.checkout.successPendingBody)).toBeVisible();
  expect(screen.getByRole('progressbar', { name: en.checkout.successPendingTitle })).toBeVisible();
  expect(screen.getByRole('link', { name: en.checkout.goToLogin })).toHaveClass('MuiButton-text');
  expect(requests).toBe(1);
  paid = true;
  await act(() => vi.advanceTimersByTimeAsync(3001));

  expect(screen.getByRole('heading', { name: en.checkout.successTitle })).toBeVisible();
  expect(screen.getByText(en.checkout.successPaidEyebrow)).toBeVisible();
  expect(screen.getByText(en.checkout.successBody)).toBeVisible();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('link', { name: en.checkout.goToLogin })).toHaveClass('MuiButton-contained');
  expect(requests).toBe(2);
  await act(() => vi.advanceTimersByTimeAsync(180_000));
  expect(requests).toBe(2);
  expect(screen.queryByText(en.checkout.successPendingTimeout)).toBeNull();
});

it('gives the timed-out card its own title and a check-again action that restarts polling', async () => {
  let requests = 0;
  let paid = false;
  server.use(offerWithSupport(null), http.get('/api/public/checkout/session-status', () => {
    requests += 1;
    return HttpResponse.json({ ok: true, data: { status: paid ? 'paid' : 'pending' } });
  }));
  await renderReturn('&session_id=cs_test_example');
  expect(screen.getByText(en.checkout.successPendingBody)).toBeVisible();

  await act(() => vi.advanceTimersByTimeAsync(179_998));
  expect(screen.queryByText(en.checkout.successPendingTimeout)).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole('heading', { name: en.checkout.successTimedOutTitle })).toBeVisible();
  expect(screen.getByText(en.checkout.successPendingEyebrow)).toBeVisible();
  expect(screen.getByText(en.checkout.successPendingTimeout)).toBeVisible();
  expect(screen.queryByText(en.checkout.successPendingContact)).toBeNull();
  expect(screen.queryByRole('link', { name: en.checkout.contactSeller })).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  const requestsAtTimeout = requests;
  expect(requestsAtTimeout).toBeGreaterThan(1);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(requests).toBe(requestsAtTimeout);

  paid = true;
  await act(async () => {
    screen.getByRole('button', { name: en.checkout.checkAgain }).click();
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(requests).toBe(requestsAtTimeout + 1);
  expect(screen.getByRole('heading', { name: en.checkout.successTitle })).toBeVisible();
});

it('keeps polling after a check again and times out again three minutes later', async () => {
  let requests = 0;
  server.use(offerWithSupport('https://help.example.test/contact'), http.get('/api/public/checkout/session-status', () => {
    requests += 1;
    return HttpResponse.json({ ok: true, data: { status: 'pending' } });
  }));
  await renderReturn('&session_id=cs_live_example');
  await act(() => vi.advanceTimersByTimeAsync(180_000));
  expect(screen.getByText(en.checkout.successPendingContact)).toBeVisible();
  expect(screen.getByRole('link', { name: en.checkout.contactSeller })).toHaveAttribute('href', 'https://help.example.test/contact');

  await act(async () => {
    screen.getByRole('button', { name: en.checkout.checkAgain }).click();
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByRole('heading', { name: en.checkout.successPendingTitle })).toBeVisible();
  expect(screen.getByRole('progressbar', { name: en.checkout.successPendingTitle })).toBeVisible();
  const afterCheck = requests;
  await act(() => vi.advanceTimersByTimeAsync(3001));
  expect(requests).toBe(afterCheck + 1);
  await act(() => vi.advanceTimersByTimeAsync(180_000));
  expect(screen.getByRole('heading', { name: en.checkout.successTimedOutTitle })).toBeVisible();
});

it('shows an inline error with check again when the status request fails instead of the waiting card', async () => {
  let failing = true;
  server.use(http.get('/api/public/checkout/session-status', () => failing
    ? HttpResponse.json({ ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })
    : HttpResponse.json({ ok: true, data: { status: 'paid' } })));
  await renderReturn('&session_id=cs_live_example');
  await act(() => vi.advanceTimersByTimeAsync(1));

  expect(screen.getByRole('heading', { name: en.checkout.statusErrorTitle })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(en.checkout.statusErrorBody);
  expect(screen.queryByText(en.checkout.successPendingBody)).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();

  failing = false;
  await act(async () => {
    screen.getByRole('button', { name: en.checkout.checkAgain }).click();
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByRole('heading', { name: en.checkout.successTitle })).toBeVisible();
});

it('offers the workspace shop and its contact on the sold-out card, with the refund in three short lines', async () => {
  server.use(offerWithSupport('https://help.example.test/contact'), http.get('/api/public/checkout/session-status', () =>
    HttpResponse.json({ ok: true, data: { status: 'cancelled' } })));
  await renderReturn('&session_id=cs_live_example');
  await act(() => vi.advanceTimersByTimeAsync(1));

  expect(screen.getByRole('heading', { name: en.checkout.soldOutRefundTitle })).toBeVisible();
  for (const line of [en.checkout.soldOutRefundBody, en.checkout.soldOutRefundStarted, en.checkout.soldOutRefundTiming]) {
    expect(screen.getByText(line)).toBeVisible();
  }
  expect(screen.getByRole('link', { name: en.checkout.backToShop })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: en.checkout.contactSeller })).toHaveAttribute('href', 'https://help.example.test/contact');
  expect(screen.queryByRole('link', { name: en.checkout.goToLogin })).toBeNull();
});

it('keeps the sold-out card without a contact link when the workspace has no support address', async () => {
  server.use(offerWithSupport(null), http.get('/api/public/checkout/session-status', () =>
    HttpResponse.json({ ok: true, data: { status: 'cancelled', charged: false } })));
  await renderReturn('&session_id=cs_live_example');
  await act(() => vi.advanceTimersByTimeAsync(1));

  expect(screen.getByText(en.checkout.soldOutNothingChargedBody)).toBeVisible();
  expect(screen.getByRole('link', { name: en.checkout.backToShop })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('link', { name: en.checkout.contactSeller })).toBeNull();
});

it.each([
  ['confirms the order without claiming a payment and without polling when session_id is absent', '&purchase_kind=one_time'],
  ['does not poll for an empty session_id and confirms the order', '&purchase_kind=one_time&session_id='],
])('%s', async (_name, query) => {
  const statusRequest = vi.fn(() => HttpResponse.json({ ok: true, data: { status: 'paid' } }));
  server.use(http.get('/api/public/checkout/session-status', statusRequest));
  await renderReturn(query);
  expect(screen.getByRole('heading', { name: en.checkout.successTitle })).toBeVisible();
  expect(screen.getByText(en.checkout.successConfirmedEyebrow)).toBeVisible();
  expect(screen.queryByText(en.checkout.successPaidEyebrow)).toBeNull();
  expect(screen.getByText(en.checkout.successBody)).toBeVisible();
  expect(screen.getByRole('link', { name: en.checkout.goToLogin })).toHaveClass('MuiButton-contained');
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(statusRequest).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(210_000));
  expect(statusRequest).not.toHaveBeenCalled();
  expect(screen.getByText(en.checkout.successBody)).toBeVisible();
  expect(screen.queryByText(en.checkout.successPendingBody)).toBeNull();
  expect(screen.queryByText(en.checkout.successPendingTimeout)).toBeNull();
});

it('keeps the no-email guidance throughout a staff test purchase, including timeout', async () => {
  let paid = false;
  server.use(
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: true, simulatedPaymentsEnabled: false,
      canTest: true, testConfigured: true, testEnabled: false,
    } })),
    http.get('/api/public/checkout/session-status', () =>
      HttpResponse.json({ ok: true, data: { status: paid ? 'paid' : 'pending' } }),
    ),
  );
  const rendered = await renderReturn('&session_id=cs_test_example&test_purchase=1');
  expect(screen.getByText(en.checkout.testPurchaseBody)).toBeVisible();
  expect(screen.queryByText(en.checkout.successPendingBody)).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(180_000));
  expect(screen.getByText(en.checkout.testPurchaseBody)).toBeVisible();
  expect(screen.queryByText(en.checkout.successPendingTimeout)).toBeNull();
  rendered.unmount();

  paid = true;
  await renderReturn('&session_id=cs_test_paid&test_purchase=1');
  expect(screen.getByRole('heading', { name: en.checkout.successTitle })).toBeVisible();
  expect(screen.getByText(en.checkout.testPurchaseBody)).toBeVisible();
  expect(screen.queryByText(en.checkout.successBody)).toBeNull();
});

it('offers a full-document way back to the shop with the encoded result once the session is paid', async () => {
  let paid = false;
  const shopReturn = { returnUrl: 'https://shop.example.test/thanks?lang=pl', checkoutRef: 'checkout-1', clientReference: 'cart 88&12' };
  server.use(http.get('/api/public/checkout/session-status', () =>
    HttpResponse.json({ ok: true, data: paid ? { status: 'paid', ...shopReturn } : { status: 'pending' } })));
  await renderReturn('&session_id=cs_live_example');
  expect(screen.queryByRole('link', { name: en.checkout.backToShop })).toBeNull();

  paid = true;
  await act(() => vi.advanceTimersByTimeAsync(3001));
  const back = screen.getByRole('link', { name: en.checkout.backToShop });
  expect(back).toHaveAttribute('href', 'https://shop.example.test/thanks?lang=pl&checkout_ref=checkout-1&status=paid&client_reference=cart+88%2612');
  expect(back).not.toHaveAttribute('target');
  expect(back).toHaveClass('MuiButton-contained');
  expect(screen.getByRole('link', { name: en.checkout.goToLogin })).toHaveAttribute('href', '/login');
});

it('shows no way back to the shop for a paid session without a return address', async () => {
  server.use(http.get('/api/public/checkout/session-status', () =>
    HttpResponse.json({ ok: true, data: { status: 'paid', checkoutRef: 'checkout-1' } })));
  await renderReturn('&session_id=cs_live_example');
  expect(screen.getByRole('heading', { name: en.checkout.successTitle })).toBeVisible();
  expect(screen.queryByRole('link', { name: en.checkout.backToShop })).toBeNull();
  expect(screen.getByRole('link', { name: en.checkout.goToLogin })).toHaveClass('MuiButton-contained');
});
