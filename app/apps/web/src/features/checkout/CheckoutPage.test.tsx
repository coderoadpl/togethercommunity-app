import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const offerBody = {
  tenant: { slug: 'acme', name: 'Acme School' },
  contentVersion: 1,
  products: [
    {
      id: 'course-1',
      title: 'Intro Course',
      description: 'Start here.',
      priceCents: 4900,
      currency: 'PLN',
      prices: [],
    },
  ],
};

describe('CheckoutPage', () => {
  beforeEach(() => window.history.replaceState(null, '', '/checkout/course-1'));

  it('loads the public offer and completes the simulated purchase flow', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: true } }),
      ),
      http.post('/api/dev/simulate-purchase', () =>
        HttpResponse.json({
          ok: true,
          data: {
            memberId: 'm1',
            productId: 'course-1',
            alreadyOwned: false,
            subscriptionId: null,
            orderId: null,
            magicLink: {
              email: 'buyer@together.dev',
              url: 'https://acme.test/magic',
              token: 'token-1',
            },
          },
        }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
    expect(screen.getByText('49,00 zł')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: pl.checkout.submitIdle }));

    const link = await screen.findByRole('link', { name: pl.checkout.openCourse });
    expect(link).toHaveAttribute('href', 'https://acme.test/magic');
    expect(screen.getByRole('heading', { name: pl.checkout.accessGrantedTitle })).toBeInTheDocument();
    expect(screen.queryByText(pl.checkout.alreadyOwnedTitle)).not.toBeInTheDocument();
    expect(screen.getByText(pl.checkout.productionNote)).toBeInTheDocument();
  });

  it('uses free-claim copy for a zero-price product', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            ...offerBody,
            products: [{
              ...offerBody.products[0],
              prices: [
                { id: 'price-free', kind: 'one_time', interval: null, amountCents: 0, currency: 'PLN' },
              ],
            }],
          },
        }),
      ),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: true } }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(await screen.findByRole('button', { name: pl.checkout.freeIdle })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: pl.checkout.payIdle })).not.toBeInTheDocument();
  });

  it('tells a repeat buyer they already own the product', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: true } }),
      ),
      http.post('/api/dev/simulate-purchase', () =>
        HttpResponse.json({
          ok: true,
          data: {
            memberId: 'm1',
            productId: 'course-1',
            alreadyOwned: true,
            subscriptionId: null,
            orderId: null,
            magicLink: {
              email: 'buyer@together.dev',
              url: 'https://acme.test/magic',
              token: 'token-1',
            },
          },
        }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    await userEvent.type(await screen.findByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: pl.checkout.submitIdle }));

    expect(await screen.findByRole('heading', { name: pl.checkout.alreadyOwnedTitle })).toBeInTheDocument();
    expect(screen.getByText(pl.checkout.alreadyOwnedNote)).toBeInTheDocument();
  });

  it('shows the Stripe primary action when the tenant is configured', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: true } }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(await screen.findByRole('button', { name: pl.checkout.payIdle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.checkout.submitIdle })).toBeInTheDocument();
  });

  it('renders a picker for multiple prices and sends the recurring choice', async () => {
    const requests: unknown[] = [];
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            ...offerBody,
            products: [{
              ...offerBody.products[0],
              prices: [
                { id: 'price-once', kind: 'one_time', interval: null, amountCents: 39_900, currency: 'PLN' },
                { id: 'price-monthly', kind: 'recurring', interval: 'month', amountCents: 3_900, currency: 'PLN' },
              ],
            }],
          },
        }),
      ),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: true } }),
      ),
      http.post('/api/dev/simulate-purchase', async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: {
            memberId: 'm1',
            productId: 'course-1',
            alreadyOwned: false,
            subscriptionId: 'sub-1',
            orderId: 'order-1',
            magicLink: null,
          },
        });
      }),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(await screen.findByRole('radio', { name: /Kup teraz.*399,00/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Subskrybuj.*39,00/ }));
    await userEvent.type(screen.getByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: pl.checkout.submitIdle }));

    expect(requests).toEqual([{
      email: 'buyer@together.dev',
      productId: 'course-1',
      priceId: 'price-monthly',
      language: 'pl',
    }]);
    expect(await screen.findByRole('heading', { name: pl.checkout.subscriptionSuccessTitle })).toBeInTheDocument();
  });

  it('keeps a single active price as the existing non-picker checkout', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            ...offerBody,
            products: [{
              ...offerBody.products[0],
              prices: [
                { id: 'price-once', kind: 'one_time', interval: null, amountCents: 4_900, currency: 'PLN' },
              ],
            }],
          },
        }),
      ),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false } }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(await screen.findByText('49,00 zł')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.checkout.payIdle })).toBeInTheDocument();
  });

  it('renders webhook-driven success guidance without fulfilling from the page', () => {
    window.history.replaceState(null, '', '/checkout/course-1?status=success&session_id=cs_1');
    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(screen.getByRole('heading', { name: pl.checkout.successTitle })).toBeInTheDocument();
    expect(screen.getByText(pl.checkout.successBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.checkout.goToLogin })).toHaveAttribute('href', '/login');
  });

  it('renders subscription-specific webhook success guidance', () => {
    window.history.replaceState(
      null,
      '',
      '/checkout/course-1?status=success&purchase_kind=subscription&session_id=cs_1',
    );
    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(screen.getByRole('heading', { name: pl.checkout.subscriptionSuccessTitle })).toBeInTheDocument();
    expect(screen.getByText(pl.checkout.subscriptionSuccessBody)).toBeInTheDocument();
    expect(screen.queryByText(pl.checkout.successBody)).not.toBeInTheDocument();
  });

  it('renders an unavailable offer as a not-found state with an escape action', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: true } }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="missing-product" />);

    const heading = await screen.findByRole('heading', { name: pl.checkout.unavailableTitle });
    expect(heading.closest('[data-state]')).toHaveAttribute('data-state', 'not-found');
    expect(screen.getByRole('link', { name: pl.checkout.goToLogin })).toHaveAttribute('href', '/login');
  });

  it('renders cancellation guidance and returns to retry', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?status=cancelled');
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: true } }),
      ),
    );
    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(screen.getByRole('heading', { name: pl.checkout.cancelledTitle })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: pl.checkout.retry }));
    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
  });
});
