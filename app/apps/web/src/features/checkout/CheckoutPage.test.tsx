import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { stylesAt } from '../../lib/stylesheet.js';
import { formatPrice } from '../../lib/format.js';
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

const pln = (cents: number) => formatPrice(cents, 'PLN', 'en');

const textPattern = (value: string) =>
  new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')}$`, 'u');

const renderCheckout = (productRef: string) => {
  const root = createRootRoute({ component: () => <CheckoutPage productRef={productRef} /> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({
      initialEntries: [`${window.location.pathname}${window.location.search}`],
    }),
  });
  return renderWithProviders(<RouterProvider router={router} />);
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

    renderCheckout('course-1');

    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
    const cover = screen.getByTestId('checkout-product-cover');
    expect(cover).toHaveAttribute('src', 'https://cdn.test/intro.jpg');
    expect(stylesAt(cover, 1440)).toMatchObject({
      'aspect-ratio': '16/9',
      'object-fit': 'cover',
      width: '100%',
    });
    expect(stylesAt(cover, 1440)['max-height']).toBeUndefined();
    expect(screen.getByText(textPattern(pln(4900)))).toBeInTheDocument();
    expect(screen.getByText(en.checkout.checkoutEyebrow)).toBeInTheDocument();
    expect(screen.getByText(en.checkout.simulatedPaymentNote)).toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) }));

    const link = await screen.findByRole('link', { name: en.checkout.openCourse });
    expect(link).toHaveAttribute('href', 'https://acme.test/magic');
    expect(screen.getByRole('heading', { name: en.checkout.accessGrantedTitle })).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.alreadyOwnedTitle)).not.toBeInTheDocument();
    expect(screen.getByText(en.checkout.productionNote)).toBeInTheDocument();
  });

  it('leaves out the cover block entirely for a product without a cover', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: true } }),
      ),
    );

    renderCheckout('course-1');

    expect(await screen.findByText(en.checkout.checkoutEyebrow)).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-product-cover-fallback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-product-cover')).not.toBeInTheDocument();
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

    renderCheckout('course-1');

    const submit = await screen.findByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) });
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

    renderCheckout('course-1');

    expect(await screen.findByRole('button', { name: textPattern(en.checkout.freeIdle({ price: pln(0) })) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) })).not.toBeInTheDocument();
    expect(screen.getByText(en.common.free)).toBeInTheDocument();
  });

  it('resolves the checkout product from its slug and purchases by product id', async () => {
    window.history.replaceState(null, '', '/checkout/intro-course');
    const requests: unknown[] = [];
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
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

    renderCheckout('intro-course');

    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) }));

    expect(await screen.findByRole('heading', { name: en.checkout.accessGrantedTitle })).toBeInTheDocument();
    expect(requests).toEqual([{
      email: 'buyer@together.dev',
      productId: 'course-1',
      language: 'en',
    }]);
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
    renderCheckout('course-1');

    expect(await screen.findByLabelText(en.checkout.couponLabel)).toHaveValue('partner20');
    expect(screen.getByTestId('checkout-coupon-input')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-coupon-apply')).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@together.dev');
    expect(await screen.findByText(textPattern(en.checkout.couponFinal({ price: pln(3920) })))).toBeInTheDocument();
    expect(screen.getByTestId('checkout-coupon-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-coupon-final')).toHaveTextContent(
      textPattern(en.checkout.couponFinal({ price: pln(3920) })),
    );
    expect(screen.getByText(textPattern(en.checkout.omnibusLowest({ price: pln(4500) })))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(3920) })) }));
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
    renderCheckout('course-1');

    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@together.dev');
    expect(await screen.findByText(en.checkout.couponForever)).toBeInTheDocument();
  });

  it('shows a uniform inline reason for a rejected code', async () => {
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
            error: { code: 'validation', message: 'Coupon cannot be applied' },
          },
          { status: 400 },
        ),
      ),
    );
    renderCheckout('course-1');

    await userEvent.click(await screen.findByTestId('checkout-coupon-reveal'));
    await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'OLD20');
    await userEvent.click(screen.getByTestId('checkout-coupon-apply'));
    expect(await screen.findByText(en.checkout.couponUnavailable)).toBeInTheDocument();
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
                termsUrl: 'https://acme.test/terms',
                privacyUrl: 'https://acme.test/privacy',
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

    renderCheckout('course-1');

    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toBeRequired();
    expect(screen.getByRole('link', { name: en.consent.terms })).toHaveAttribute(
      'href',
      'https://acme.test/terms',
    );
    expect(screen.getByRole('link', { name: en.consent.privacy })).toHaveAttribute(
      'href',
      'https://acme.test/privacy',
    );

    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) }));

    expect(await screen.findByRole('heading', { name: en.checkout.accessGrantedTitle })).toBeInTheDocument();
    expect(requests).toEqual([{
      email: 'buyer@together.dev',
      productId: 'course-1',
      language: 'en',
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

    renderCheckout('course-1');

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
                label: 'I want to receive updates about new courses.',
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

    renderCheckout('course-1');

    const checkbox = await screen.findByRole('checkbox', {
      name: /I want to receive updates about new courses/,
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toBeRequired();
    expect(screen.getByRole('link', { name: en.checkout.marketingConsentDocument }))
      .toHaveAttribute('href', 'https://acme.test/marketing');

    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) }));

    expect(await screen.findByRole('heading', { name: en.checkout.accessGrantedTitle })).toBeInTheDocument();
    expect(requests).toEqual([{
      email: 'buyer@together.dev',
      productId: 'course-1',
      language: 'en',
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

    renderCheckout('course-1');

    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) }));

    expect(await screen.findByRole('heading', { name: en.checkout.alreadyOwnedTitle })).toBeInTheDocument();
    expect(screen.getByText(en.checkout.alreadyOwnedNote)).toBeInTheDocument();
  });

  it('shows the Stripe primary action when the tenant is configured', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: true } }),
      ),
    );

    renderCheckout('course-1');

    expect(await screen.findByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) })).toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: textPattern(en.checkout.submitIdle({ price: pln(4900) })) })).toBeInTheDocument();
    expect(screen.getByText(en.checkout.simulatedPaymentNote)).toBeInTheDocument();
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

    renderCheckout('course-1');

    expect(await screen.findByRole('radio', { name: textPattern(en.checkout.buyPrice({ price: pln(39900) })) })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: textPattern(en.checkout.subscribeMonthlyPrice({ price: pln(3900) })) }));
    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(3900) })) }));

    expect(requests).toEqual([{
      email: 'buyer@together.dev',
      productId: 'course-1',
      priceId: 'price-monthly',
      language: 'en',
    }]);
    expect(await screen.findByRole('heading', { name: en.checkout.subscriptionSuccessTitle })).toBeInTheDocument();
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

    renderCheckout('course-1');

    expect(await screen.findByText(textPattern(pln(4900)))).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: textPattern(en.checkout.payIdle({ price: pln(4900) })) })).toBeInTheDocument();
  });

  it('renders webhook-driven success guidance without fulfilling from the page', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?status=success&session_id=cs_1');
    renderCheckout('course-1');

    expect(await screen.findByRole('heading', { name: en.checkout.successTitle })).toBeInTheDocument();
    expect(screen.getByText(en.checkout.successBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.checkout.goToLogin })).toHaveAttribute('href', '/login');
  });

  it('renders subscription-specific webhook success guidance', async () => {
    window.history.replaceState(
      null,
      '',
      '/checkout/course-1?status=success&purchase_kind=subscription&session_id=cs_1',
    );
    renderCheckout('course-1');

    expect(await screen.findByRole('heading', { name: en.checkout.subscriptionSuccessTitle })).toBeInTheDocument();
    expect(screen.getByText(en.checkout.subscriptionSuccessBody)).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.successBody)).not.toBeInTheDocument();
  });

  it('renders an unavailable offer as a not-found state with an escape action', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: true } }),
      ),
    );

    renderCheckout('missing-product');

    const heading = await screen.findByRole('heading', { name: en.checkout.unavailableTitle });
    expect(heading.closest('[data-state]')).toHaveAttribute('data-state', 'not-found');
    expect(screen.getByRole('link', { name: en.checkout.goToLogin })).toHaveAttribute('href', '/login');
  });

  it('renders cancellation guidance and returns to retry', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?status=cancelled');
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.get('/api/public/payment-config', () =>
        HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: true } }),
      ),
    );
    renderCheckout('course-1');

    expect(await screen.findByRole('heading', { name: en.checkout.cancelledTitle })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.checkout.retry }));
    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
  });
});


it('loads a direct unlisted checkout and enables a free purchase without a payment provider', async () => {
  server.use(
    http.get('/api/public/offer', ({ request }) => {
      const direct = new URL(request.url).searchParams.get('productRef') === 'course-1';
      return HttpResponse.json({ ok: true, data: {
        ...offerBody, products: direct ? [{ ...offerBody.products[0], priceCents: 0 }] : [],
      } });
    }),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: false, simulatedPaymentsEnabled: false,
    } })),
  );
  renderCheckout('course-1');
  expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
  expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
  expect(screen.queryByText(en.checkout.paymentUnavailable)).not.toBeInTheDocument();
});
