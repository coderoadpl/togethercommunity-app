import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { stripeTermsUrlMissing } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { formatPrice } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const exact = (value: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')}$`, 'u');
const sessionBody = z.record(z.string(), z.unknown());
const pln = (cents: number) => formatPrice(cents, 'PLN', 'en');
const courier = () => screen.findByRole('radio', { name: new RegExp(`^Courier — ${pln(1999).replace('.', '\\.')}`, 'u') });
const legal = { termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' };
const shippingRates = [{ id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'other', pickupPoint: 'none' }];
const coupon = {
  recurringDuration: 'first_invoice',
  breakdown: { couponId: 'coupon-1', code: 'SAVE', originalCents: 4900, discountCents: 1000, finalCents: 3900, lowestPriceLast30DaysCents: 4500, currency: 'PLN' },
};

const stopBeforeRedirect = () => HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Stop before redirect' } }, { status: 400 });

const serve = (sessions: unknown[], answers: (() => Response)[]) => {
  server.use(
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: {
      tenant: { slug: 'acme', name: 'Acme School', legal },
      contentVersion: 1,
      products: [{
        id: 'course-1', type: 'physical', deliveryMethod: 'shipping', slug: 'intro-course', title: 'Intro Course', description: 'Start here.',
        coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [],
      }],
    } })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: true, simulatedPaymentsEnabled: false, shippingRates,
    } })),
    http.post('/api/public/checkout/coupon', () => HttpResponse.json({ ok: true, data: coupon })),
    http.post('/api/public/checkout/session', async ({ request }) => {
      sessions.push(await request.json());
      return (answers.shift() ?? stopBeforeRedirect)();
    }),
  );
};

const refuseStripeTerms = () => HttpResponse.json({ ok: false, error: stripeTermsUrlMissing() }, { status: 412 });

const renderCheckout = () => {
  const root = createRootRoute({ component: () => <CheckoutPage productRef="course-1" /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [`${window.location.pathname}${window.location.search}`] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('checkout terms when Stripe cannot collect them', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/course-1?code=SAVE');
    server.use(anonymousMe());
  });

  it('switches to the page terms after a Stripe refusal, keeps every choice and asks the server for the page-terms path', async () => {
    const sessions: unknown[] = [];
    serve(sessions, [refuseStripeTerms]);
    renderCheckout();

    await screen.findByTestId('checkout-coupon-final');
    await userEvent.click(await courier());
    await userEvent.click(screen.getByRole('button', { name: en.checkout.invoiceReveal }));
    await userEvent.type(screen.getByLabelText(en.checkout.companyNameLabel), 'Buyer Ltd');
    await userEvent.type(screen.getByLabelText(en.checkout.addressLabel), 'Main Street 2');
    await userEvent.type(screen.getByLabelText(en.checkout.postalCodeLabel), '00-001');
    await userEvent.type(screen.getByLabelText(en.checkout.cityLabel), 'Warsaw');
    expect(screen.queryByTestId('terms-consent')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(en.checkout.emailLabel)).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    expect(await screen.findByText(en.checkout.termsOnPageFallback)).toBeVisible();
    expect(sessions[0]).not.toHaveProperty('termsOnPage');
    expect(sessions[0]).not.toHaveProperty('termsAccepted');
    const terms = screen.getByTestId('terms-consent');
    const email = screen.getByLabelText(en.checkout.emailLabel);
    expect(email).toBeRequired();
    expect(screen.getByLabelText(en.checkout.companyNameLabel)).toHaveValue('Buyer Ltd');
    expect(screen.getByTestId('checkout-coupon-final')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(5899) })));

    await userEvent.type(email, 'buyer@example.org');
    await userEvent.click(within(terms).getByRole('checkbox'));
    await waitFor(() => expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled());
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(sessions).toHaveLength(2));
    const { termsOnPage, termsAccepted, email: sentEmail, ...choices } = sessionBody.parse(sessions[1]);
    expect({ termsOnPage, termsAccepted, sentEmail }).toEqual({ termsOnPage: true, termsAccepted: true, sentEmail: 'buyer@example.org' });
    const { email: firstEmail, ...firstChoices } = sessionBody.parse(sessions[0]);
    expect(firstEmail).toBeUndefined();
    expect(choices).toEqual(firstChoices);
    expect(choices).toMatchObject({
      couponCode: 'SAVE', shipping: { rateId: 'courier' },
      billing: { companyName: 'Buyer Ltd', address: 'Main Street 2', postalCode: '00-001', city: 'Warsaw' },
    });
  });

  it('keeps a code applied by hand through the refusal and validates it again with the typed e-mail', async () => {
    window.history.replaceState(null, '', '/checkout/course-1');
    const sessions: unknown[] = [];
    const couponRequests: unknown[] = [];
    serve(sessions, [refuseStripeTerms]);
    server.use(http.post('/api/public/checkout/coupon', async ({ request }) => {
      couponRequests.push(await request.json());
      return HttpResponse.json({ ok: true, data: coupon });
    }));
    renderCheckout();

    await userEvent.click(await courier());
    await userEvent.click(screen.getByRole('button', { name: en.checkout.couponReveal }));
    await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'SAVE');
    await userEvent.click(screen.getByTestId('checkout-coupon-apply'));
    await screen.findByTestId('checkout-coupon-final');
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ couponCode: 'SAVE' });

    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(within(screen.getByTestId('terms-consent')).getByRole('checkbox'));
    await waitFor(() => expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(5899) }))));
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
    expect(couponRequests.at(-1)).toMatchObject({ couponCode: 'SAVE', email: 'buyer@example.org' });
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(sessions).toHaveLength(2));
    expect(sessions[1]).toMatchObject({ couponCode: 'SAVE', email: 'buyer@example.org', termsOnPage: true, termsAccepted: true });
  });

  it('starts in page-terms mode when the sales-link handoff already learned that Stripe cannot collect the terms', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?terms=page');
    const sessions: unknown[] = [];
    serve(sessions, []);
    renderCheckout();

    await userEvent.click(await courier());
    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(within(screen.getByTestId('terms-consent')).getByRole('checkbox'));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ termsOnPage: true, termsAccepted: true, email: 'buyer@example.org' });
  });

  it('keeps the Stripe terms mode and shows the error for any other checkout failure', async () => {
    window.history.replaceState(null, '', '/checkout/course-1');
    const sessions: unknown[] = [];
    serve(sessions, [() => HttpResponse.json({ ok: false, error: { code: 'integration_not_configured', message: 'Stripe is not configured' } }, { status: 412 })]);
    renderCheckout();

    await userEvent.click(await courier());
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(await screen.findByText(en.errors.messageIntegrationNotConfigured)).toBeVisible();
    expect(screen.queryByText(en.checkout.termsOnPageFallback)).not.toBeInTheDocument();
    expect(screen.queryByTestId('terms-consent')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(en.checkout.emailLabel)).not.toBeInTheDocument();
  });
});
