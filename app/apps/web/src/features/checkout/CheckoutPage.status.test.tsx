import { act, screen } from '@testing-library/react';
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('shows the pending card before the first status response', async () => {
  let resolveResponse: (response: Response) => void = () => undefined;
  const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  server.use(http.get('/api/public/checkout/session-status', () => response));
  await renderReturn('&session_id=cs_live_example');

  expect(screen.getByRole('heading', { name: en.checkout.successPendingTitle })).toBeVisible();
  expect(screen.getByText(en.checkout.successPendingBody)).toBeVisible();
  expect(screen.getByRole('progressbar', { name: en.checkout.successPendingTitle })).toBeVisible();
  await act(async () => {
    resolveResponse(HttpResponse.json({ ok: true, data: { status: 'paid' } }));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByRole('heading', { name: en.checkout.successTitle })).toBeVisible();
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

it('shows the timeout guidance after three minutes and stops polling', async () => {
  let requests = 0;
  server.use(http.get('/api/public/checkout/session-status', () => {
    requests += 1;
    return HttpResponse.json({ ok: true, data: { status: 'pending' } });
  }));
  await renderReturn('&session_id=cs_test_example');
  expect(screen.getByText(en.checkout.successPendingBody)).toBeVisible();

  await act(() => vi.advanceTimersByTimeAsync(179_998));
  expect(screen.queryByText(en.checkout.successPendingTimeout)).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText(en.checkout.successPendingTimeout)).toBeVisible();
  expect(screen.getByRole('heading', { name: en.checkout.successPendingTitle })).toBeVisible();
  const requestsAtTimeout = requests;
  expect(requestsAtTimeout).toBeGreaterThan(1);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(requests).toBe(requestsAtTimeout);
});

it('keeps legacy return links pending without polling or a timeout', async () => {
  const statusRequest = vi.fn(() => HttpResponse.json({ ok: true, data: { status: 'paid' } }));
  server.use(http.get('/api/public/checkout/session-status', statusRequest));
  await renderReturn('');
  expect(screen.getByText(en.checkout.successPendingBody)).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(210_000));
  expect(statusRequest).not.toHaveBeenCalled();
  expect(screen.getByText(en.checkout.successPendingBody)).toBeVisible();
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
