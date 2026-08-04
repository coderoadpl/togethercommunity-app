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
      type: 'course',
      slug: 'intro-course',
      title: 'Intro Course',
      description: 'Start here.',
      coverUrl: null,
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
      http.get('/api/public/offer', () => HttpResponse.json({
        ok: true,
        data: {
          ...offerBody,
          products: [{ ...offerBody.products[0], coverUrl: 'https://cdn.test/intro.jpg' }],
        },
      })),
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
    expect(screen.getByTestId('checkout-product-cover')).toHaveAttribute('src', 'https://cdn.test/intro.jpg');
    expect(screen.getByText('49,00 zł')).toBeInTheDocument();
    expect(screen.getByText(pl.checkout.checkoutEyebrow)).toBeInTheDocument();
    expect(screen.getByText(pl.checkout.simulatedPaymentDevNote)).toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: /^Zapłać/ }));

    const link = await screen.findByRole('link', { name: pl.checkout.openCourse });
    expect(link).toHaveAttribute('href', 'https://acme.test/magic');
    expect(screen.getByRole('heading', { name: pl.checkout.accessGrantedTitle })).toBeInTheDocument();
    expect(screen.queryByText(pl.checkout.alreadyOwnedTitle)).not.toBeInTheDocument();
    expect(screen.getByText(pl.checkout.productionNote)).toBeInTheDocument();
  });

  it('renders tenant social links after the payment controls', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            ...offerBody,
            tenant: {
              ...offerBody.tenant,
              branding: { logoUrl: null, accentColor: null, faviconUrl: null },
              socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@acme' }],
            },
          },
        }),
      ),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({
          ok: true,
          data: { stripeConfigured: false, simulatedPaymentsEnabled: true },
        }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    const submit = await screen.findByRole('button', { name: /^Zapłać/ });
    const socialLink = await screen.findByRole('link', { name: 'YouTube' });
    expect(submit.compareDocumentPosition(socialLink))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

    expect(await screen.findByRole('button', { name: /^Odbierz za darmo/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Zapłać/ })).not.toBeInTheDocument();
  });

  it('prefills an affiliate code and renders the required Omnibus breakdown before purchase', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?code=partner20');
    const purchases: unknown[] = [];
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: true } }),
      ),
      http.post('/api/public/checkout/coupon', () =>
        HttpResponse.json({
          ok: true,
          data: {
            recurringDuration: 'first_invoice',
            breakdown: {
              couponId: 'coupon-1',
              code: 'PARTNER20',
              originalCents: 4900,
              discountCents: 980,
              finalCents: 3920,
              lowestPriceLast30DaysCents: 4500,
              currency: 'PLN',
            },
          },
        }),
      ),
      http.post('/api/dev/simulate-purchase', async ({ request }) => {
        purchases.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: {
            memberId: 'm1',
            productId: 'course-1',
            alreadyOwned: false,
            subscriptionId: null,
            orderId: 'order-1',
            magicLink: null,
          },
        });
      }),
    );
    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(await screen.findByLabelText(pl.checkout.couponLabel)).toHaveValue('partner20');
    expect(screen.getByTestId('checkout-coupon-input')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-coupon-apply')).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    expect(await screen.findByText('Do zapłaty: 39,20 zł')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-coupon-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-coupon-final')).toHaveTextContent('39,20');
    expect(screen.getByText('Najniższa cena z ostatnich 30 dni: 45,00 zł')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Zapłać/ }));
    expect(purchases).toMatchObject([{ couponCode: 'partner20' }]);
  });

  it('explains a forever coupon on a recurring price', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?code=partner20');
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            ...offerBody,
            products: [{
              ...offerBody.products[0],
              prices: [{
                id: 'price-monthly',
                kind: 'recurring',
                interval: 'month',
                amountCents: 4900,
                currency: 'PLN',
              }],
            }],
          },
        }),
      ),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({
          ok: true,
          data: { stripeConfigured: false, simulatedPaymentsEnabled: true },
        }),
      ),
      http.post('/api/public/checkout/coupon', () =>
        HttpResponse.json({
          ok: true,
          data: {
            recurringDuration: 'forever',
            breakdown: {
              couponId: 'coupon-1',
              code: 'PARTNER20',
              originalCents: 4900,
              discountCents: 980,
              finalCents: 3920,
              lowestPriceLast30DaysCents: 4900,
              currency: 'PLN',
            },
          },
        }),
      ),
    );
    renderWithProviders(<CheckoutPage productId="course-1" />);

    await userEvent.type(await screen.findByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    expect(await screen.findByText(pl.checkout.couponForever)).toBeInTheDocument();
  });

  it('shows a specific inline reason for an expired code', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({
          ok: true,
          data: { stripeConfigured: false, simulatedPaymentsEnabled: true },
        }),
      ),
      http.post('/api/public/checkout/coupon', () =>
        HttpResponse.json(
          {
            ok: false,
            error: { code: 'validation', message: 'This coupon has expired' },
          },
          { status: 400 },
        ),
      ),
    );
    renderWithProviders(<CheckoutPage productId="course-1" />);

    await userEvent.click(await screen.findByTestId('checkout-coupon-reveal'));
    await userEvent.type(screen.getByLabelText(pl.checkout.couponLabel), 'OLD20');
    await userEvent.click(screen.getByTestId('checkout-coupon-apply'));
    expect(await screen.findByText(pl.checkout.couponExpired)).toBeInTheDocument();
    expect(screen.getByTestId('checkout-coupon-error')).toBeInTheDocument();
  });

  it('requires accepting configured documents and sends the consent with the purchase', async () => {
    const requests: unknown[] = [];
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            ...offerBody,
            tenant: {
              ...offerBody.tenant,
              legal: {
                termsUrl: 'https://acme.test/regulamin',
                privacyUrl: 'https://acme.test/prywatnosc',
              },
            },
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
            subscriptionId: null,
            orderId: 'order-1',
            magicLink: null,
          },
        });
      }),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toBeRequired();
    expect(screen.getByRole('link', { name: pl.consent.terms })).toHaveAttribute(
      'href',
      'https://acme.test/regulamin',
    );
    expect(screen.getByRole('link', { name: pl.consent.privacy })).toHaveAttribute(
      'href',
      'https://acme.test/prywatnosc',
    );

    await userEvent.type(screen.getByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: /^Zapłać/ }));

    expect(await screen.findByRole('heading', { name: pl.checkout.accessGrantedTitle })).toBeInTheDocument();
    expect(requests).toEqual([{
      email: 'buyer@together.dev',
      productId: 'course-1',
      language: 'pl',
      termsAccepted: true,
    }]);
  });

  it('shows no consent checkbox when the tenant has no configured documents', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: true } }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders attached marketing consent unchecked and submits it only after an explicit tick', async () => {
    const requests: unknown[] = [];
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            ...offerBody,
            products: [{
              ...offerBody.products[0],
              marketingConsents: [{
                definitionId: 'consent-news',
                label: 'Chcę otrzymywać wiadomości o nowych kursach.',
                doubleOptIn: true,
                documentUrl: 'https://acme.test/marketing',
              }],
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
            subscriptionId: null,
            orderId: 'order-1',
            magicLink: null,
          },
        });
      }),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    const checkbox = await screen.findByRole('checkbox', {
      name: /Chcę otrzymywać wiadomości o nowych kursach/,
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toBeRequired();
    expect(screen.getByRole('link', { name: pl.checkout.marketingConsentDocument }))
      .toHaveAttribute('href', 'https://acme.test/marketing');

    await userEvent.type(screen.getByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: /^Zapłać/ }));

    expect(await screen.findByRole('heading', { name: pl.checkout.accessGrantedTitle })).toBeInTheDocument();
    expect(requests).toEqual([{
      email: 'buyer@together.dev',
      productId: 'course-1',
      language: 'pl',
      marketingConsentDefinitionIds: ['consent-news'],
    }]);
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
    await userEvent.click(screen.getByRole('button', { name: /^Zapłać/ }));

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

    expect(await screen.findByRole('button', { name: /^Zapłać/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Symuluj płatność/ })).toBeInTheDocument();
    expect(screen.getByText(pl.checkout.simulatedPaymentDevNote)).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: /^Zapłać/ }));

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
    expect(screen.getByRole('button', { name: /^Zapłać/ })).toBeInTheDocument();
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
