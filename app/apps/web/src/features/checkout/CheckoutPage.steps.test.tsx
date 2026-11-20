import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { en } from '../../i18n/en.js';
import { formatPrice } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, memberMe, server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const pln = (cents: number) => formatPrice(cents, 'PLN', 'en');
const exact = (value: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')}$`, 'u');
const legal = { termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' };

const product = (change: Record<string, unknown> = {}) => ({
  id: 'course-1', type: 'course', deliveryMethod: 'pickup', slug: 'intro-course', title: 'Intro Course', description: 'Start here.',
  coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [], ...change,
});

const shippingRates = [
  { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker' },
  { id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'other', pickupPoint: 'none' },
];

const couponBody = z.object({ email: z.string().optional() }).passthrough();
type CouponBody = z.infer<typeof couponBody>;

const serve = (input: {
  product?: Record<string, unknown>;
  tenantLegal?: { termsUrl: string | null; privacyUrl: string | null } | null;
  payment?: Record<string, unknown>;
  coupon?: (body: CouponBody) => Response;
  sessions?: unknown[];
}) => {
  server.use(
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: {
      tenant: { slug: 'acme', name: 'Acme School', ...(input.tenantLegal === null ? {} : { legal: input.tenantLegal ?? legal }) },
      contentVersion: 1,
      products: [product(input.product)],
    } })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: true, simulatedPaymentsEnabled: false, ...input.payment,
    } })),
    http.post('/api/public/checkout/coupon', async ({ request }) => {
      const body = couponBody.parse(await request.json());
      return input.coupon?.(body) ?? HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Coupon cannot be applied' } }, { status: 400 });
    }),
    http.post('/api/public/checkout/session', async ({ request }) => {
      input.sessions?.push(await request.json());
      return HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Stop before redirect' } }, { status: 400 });
    }),
  );
};

const renderCheckout = () => {
  const root = createRootRoute({ component: () => <CheckoutPage productRef="course-1" /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [`${window.location.pathname}${window.location.search}`] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

const breakdown = (finalCents: number) => ({
  ok: true,
  data: {
    recurringDuration: 'first_invoice',
    breakdown: { couponId: 'coupon-1', code: 'SAVE', originalCents: 4900, discountCents: 4900 - finalCents, finalCents, lowestPriceLast30DaysCents: 4500, currency: 'PLN' },
  },
});

const perPersonCoupon = (couponBodies: CouponBody[]) => (body: CouponBody) => {
  couponBodies.push(body);
  return body.email === undefined
    ? HttpResponse.json({ ok: false, error: { code: 'validation', message: 'An email is required to validate this coupon' } }, { status: 400 })
    : HttpResponse.json(breakdown(3920));
};

const following = (first: Element, second: Element) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('checkout step one', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/course-1');
    server.use(anonymousMe());
  });

  it('leaves the email and the terms to Stripe and names the total and the next step', async () => {
    const sessions: unknown[] = [];
    serve({ sessions });
    renderCheckout();

    const pay = await screen.findByTestId('checkout-pay-cta');
    expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(4900) })));
    expect(screen.queryByLabelText(en.checkout.emailLabel)).not.toBeInTheDocument();
    expect(screen.queryByTestId('terms-consent')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-next-step')).toHaveTextContent(exact(en.checkout.nextStep({ email: true, address: false, terms: true })));
    expect(pay).toHaveAccessibleDescription(en.checkout.nextStep({ email: true, address: false, terms: true }));
    const steps = screen.getByRole('list', { name: en.checkout.stepsLabel });
    expect(within(steps).getAllByRole('listitem').map((item) => item.textContent)).toEqual([`1${en.checkout.stepOrder}`, `2${en.checkout.stepDetailsAndPayment}`]);
    expect(within(steps).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');

    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ productId: 'course-1', language: 'en' });
    expect(sessions[0]).not.toHaveProperty('email');
    expect(sessions[0]).not.toHaveProperty('termsAccepted');
  });

  it('keeps the email and the terms on the page for a workspace without both legal documents', async () => {
    const sessions: unknown[] = [];
    serve({ sessions, tenantLegal: { termsUrl: 'https://acme.test/terms', privacyUrl: null } });
    renderCheckout();

    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(within(screen.getByTestId('terms-consent')).getByRole('checkbox'));
    expect(screen.getByTestId('checkout-next-step')).toHaveTextContent(exact(en.checkout.nextStep({ email: false, address: false, terms: false })));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ email: 'buyer@example.org', termsAccepted: true });
  });

  it('asks for the email and the terms on the page for an order with nothing to pay', async () => {
    const sessions: unknown[] = [];
    serve({ sessions, product: { priceCents: 0 } });
    renderCheckout();

    const pay = await screen.findByTestId('checkout-pay-cta');
    expect(pay).toHaveTextContent(exact(en.checkout.freeOrderIdle));
    expect(screen.queryByRole('list', { name: en.checkout.stepsLabel })).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-next-step')).not.toBeInTheDocument();
    const email = screen.getByLabelText(en.checkout.emailLabel);
    expect(email).toBeRequired();
    expect(email).toHaveAccessibleDescription(en.checkout.emailHint);
    const terms = within(screen.getByTestId('terms-consent')).getByRole('checkbox');
    expect(terms).toBeRequired();
    await userEvent.type(email, 'buyer@example.org');
    await userEvent.click(terms);
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ email: 'buyer@example.org', termsAccepted: true });
  });

  it('asks a signed-in buyer of a free order only for the terms and sends the account email', async () => {
    server.use(memberMe());
    const sessions: unknown[] = [];
    serve({ sessions, product: { priceCents: 0 } });
    renderCheckout();

    await userEvent.click(within(await screen.findByTestId('terms-consent')).getByRole('checkbox'));
    expect(screen.queryByLabelText(en.checkout.emailLabel)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ email: 'member@example.com', termsAccepted: true });
  });

  it('passes the account email of a signed-in buyer to Stripe without showing an email field', async () => {
    server.use(memberMe());
    const sessions: unknown[] = [];
    serve({ sessions });
    renderCheckout();

    const pay = await screen.findByTestId('checkout-pay-cta');
    expect(screen.queryByLabelText(en.checkout.emailLabel)).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-next-step')).toHaveTextContent(exact(en.checkout.nextStep({ email: false, address: false, terms: true })));
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ email: 'member@example.com' });
    expect(sessions[0]).not.toHaveProperty('termsAccepted');
  });

  it('asks for the email inside the code row only when the coupon has a per-person limit', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?code=SAVE');
    const couponBodies: CouponBody[] = [];
    const sessions: unknown[] = [];
    serve({
      sessions,
      coupon: (body) => {
        couponBodies.push(body);
        return body.email === undefined
          ? HttpResponse.json({ ok: false, error: { code: 'validation', message: 'An email is required to validate this coupon' } }, { status: 400 })
          : HttpResponse.json(breakdown(3920));
      },
    });
    renderCheckout();

    const email = await screen.findByLabelText(en.checkout.emailLabel);
    expect(couponBodies).toEqual([{ productId: 'course-1', couponCode: 'SAVE' }]);
    expect(email).not.toBeRequired();
    expect(email).toHaveAccessibleDescription(en.checkout.couponEmailHint);
    expect(screen.getByTestId('checkout-coupon-error')).toHaveTextContent(en.checkout.couponEmailRequiredFullPrice);
    const codeRow = screen.getByTestId('checkout-coupon-reveal').parentElement;
    if (codeRow === null) throw new Error('Missing code row');
    expect(within(codeRow).getByLabelText(en.checkout.emailLabel)).toBe(email);

    await userEvent.type(email, 'buyer@example.org');
    expect(await screen.findByTestId('checkout-coupon-final')).toHaveTextContent(exact(en.checkout.couponAfterDiscount({ price: pln(3920) })));
    expect(couponBodies.at(-1)).toEqual({ productId: 'course-1', couponCode: 'SAVE', email: 'buyer@example.org' });
    const pay = screen.getByTestId('checkout-pay-cta');
    await waitFor(() => expect(pay).toBeEnabled());
    expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(3920) })));
    expect(screen.getByTestId('checkout-next-step')).toHaveTextContent(exact(en.checkout.nextStep({ email: false, address: false, terms: true })));
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ email: 'buyer@example.org', couponCode: 'SAVE' });
  });

  it('drops the discount of a link code once its address in the code row is cleared and validates it again when the address is back', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?code=SAVE');
    const couponBodies: CouponBody[] = [];
    const sessions: unknown[] = [];
    serve({ sessions, coupon: perPersonCoupon(couponBodies) });
    renderCheckout();

    const email = await screen.findByLabelText(en.checkout.emailLabel);
    await userEvent.type(email, 'buyer@example.org');
    await screen.findByTestId('checkout-coupon-final');
    const pay = screen.getByTestId('checkout-pay-cta');
    await waitFor(() => expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(3920) }))));

    await userEvent.clear(email);
    await waitFor(() => expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(4900) }))));
    expect(screen.getByTestId('checkout-coupon-reveal')).toHaveTextContent(exact(en.checkout.couponReveal));
    expect(screen.getByTestId('checkout-summary-total')).toHaveTextContent(exact(pln(4900)));
    expect(pay).toBeEnabled();
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).not.toHaveProperty('couponCode');
    expect(sessions[0]).not.toHaveProperty('email');

    await userEvent.type(email, 'buyer@example.org');
    await waitFor(() => expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(3920) }))));
    expect(couponBodies.at(-1)).toEqual({ productId: 'course-1', couponCode: 'SAVE', email: 'buyer@example.org' });
    await waitFor(() => expect(pay).toBeEnabled());
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(2));
    expect(sessions[1]).toMatchObject({ couponCode: 'SAVE', email: 'buyer@example.org' });
  });

  it('validates the link code again when the price choice returns to the price it was validated for', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?code=SAVE');
    const couponBodies: CouponBody[] = [];
    const sessions: unknown[] = [];
    serve({
      sessions,
      product: { prices: [
        { id: 'price-once', kind: 'one_time', interval: null, amountCents: 4900, currency: 'PLN' },
        { id: 'price-yearly', kind: 'recurring', interval: 'year', amountCents: 9900, currency: 'PLN' },
      ] },
      coupon: (body) => { couponBodies.push(body); return HttpResponse.json(breakdown(3920)); },
    });
    renderCheckout();

    await screen.findByTestId('checkout-coupon-final');
    const pay = screen.getByTestId('checkout-pay-cta');
    expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(3920) })));
    await userEvent.click(within(screen.getByTestId('checkout-price-price-yearly')).getByRole('radio'));
    await userEvent.click(within(screen.getByTestId('checkout-price-price-once')).getByRole('radio'));
    await waitFor(() => expect(pay).toBeEnabled());
    await waitFor(() => expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(3920) }))));
    expect(couponBodies.at(-1)).toMatchObject({ couponCode: 'SAVE', priceId: 'price-once' });
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ couponCode: 'SAVE', priceId: 'price-once' });
  });

  const applyTypedCodeUntilEmailIsAsked = async () => {
    await userEvent.click(await screen.findByRole('button', { name: en.checkout.couponReveal }));
    await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'SAVE');
    await userEvent.click(screen.getByTestId('checkout-coupon-apply'));
    expect(await screen.findByTestId('checkout-coupon-error')).toHaveTextContent(en.checkout.couponEmailRequiredFullPrice);
    return screen.getByLabelText(en.checkout.emailLabel);
  };

  it('applies a typed code again with the email on Enter in the email field of the code row, without submitting the checkout', async () => {
    const couponBodies: CouponBody[] = [];
    const sessions: unknown[] = [];
    serve({ sessions, coupon: perPersonCoupon(couponBodies) });
    renderCheckout();

    const email = await applyTypedCodeUntilEmailIsAsked();
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
    await userEvent.type(email, 'buyer@example.org{Enter}');

    await waitFor(() => expect(couponBodies).toHaveLength(2));
    expect(couponBodies.at(-1)).toEqual({ productId: 'course-1', couponCode: 'SAVE', email: 'buyer@example.org' });
    const remove = await screen.findByRole('button', { name: en.checkout.couponRemoveLabel({ code: 'SAVE' }) });
    await waitFor(() => expect(remove).toHaveFocus());
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(3920) })));
    expect(sessions).toHaveLength(0);
  });

  it('sends one more coupon request and no checkout request on Enter in an empty or partial email field of the code row', async () => {
    const couponBodies: CouponBody[] = [];
    const sessions: unknown[] = [];
    serve({ sessions, coupon: perPersonCoupon(couponBodies) });
    renderCheckout();

    const email = await applyTypedCodeUntilEmailIsAsked();
    await userEvent.type(email, '{Enter}');
    await waitFor(() => expect(couponBodies).toHaveLength(2));
    await userEvent.type(email, 'buyer@{Enter}');
    await waitFor(() => expect(couponBodies).toHaveLength(3));
    await new Promise((resolve) => { window.setTimeout(resolve, 100); });
    expect(sessions).toHaveLength(0);
    expect(couponBodies).toHaveLength(3);
    expect(couponBodies.every((body) => body.email === undefined)).toBe(true);
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(4900) })));
  });

  it('says a per-person code is not applied without the email, shows no discount and pays the full price without the code', async () => {
    const couponBodies: CouponBody[] = [];
    const sessions: unknown[] = [];
    serve({ sessions, coupon: perPersonCoupon(couponBodies) });
    renderCheckout();

    await applyTypedCodeUntilEmailIsAsked();
    expect(screen.getByTestId('checkout-coupon-error')).toHaveTextContent(exact(en.checkout.couponEmailRequiredFullPrice));
    expect(en.checkout.couponEmailRequiredFullPrice).toMatch(/full price/u);
    expect(screen.queryByTestId('checkout-coupon-breakdown')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-coupon-reveal')).toHaveTextContent(exact(en.checkout.couponReveal));
    expect(screen.getByTestId('checkout-summary-total')).toHaveTextContent(exact(pln(4900)));
    const pay = screen.getByTestId('checkout-pay-cta');
    expect(pay).toBeEnabled();
    expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(4900) })));
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).not.toHaveProperty('couponCode');
    expect(sessions[0]).not.toHaveProperty('email');
  });

  it('keeps Enter in the email field of the details placement a submit of the checkout', async () => {
    const sessions: unknown[] = [];
    serve({ sessions, tenantLegal: { termsUrl: 'https://acme.test/terms', privacyUrl: null } });
    renderCheckout();

    await userEvent.click(within(await screen.findByTestId('terms-consent')).getByRole('checkbox'));
    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org{Enter}');
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ email: 'buyer@example.org', termsAccepted: true });
  });

  it('applies a coupon without a per-person limit without asking for the email', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?code=SAVE');
    const couponBodies: unknown[] = [];
    const sessions: unknown[] = [];
    serve({ sessions, coupon: (body) => { couponBodies.push(body); return HttpResponse.json(breakdown(3920)); } });
    renderCheckout();

    expect(await screen.findByTestId('checkout-coupon-final')).toHaveTextContent(exact(en.checkout.couponAfterDiscount({ price: pln(3920) })));
    expect(screen.getByText(exact(en.checkout.omnibusLowest({ price: pln(4500) })))).toBeVisible();
    expect(screen.queryByLabelText(en.checkout.emailLabel)).not.toBeInTheDocument();
    expect(couponBodies).toEqual([{ productId: 'course-1', couponCode: 'SAVE' }]);
    expect(screen.getByTestId('checkout-summary-total')).toHaveTextContent(exact(pln(3920)));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ couponCode: 'SAVE' });
    expect(sessions[0]).not.toHaveProperty('email');
  });

  it('turns a coupon that covers the whole price into a free order with the email and the terms on the page', async () => {
    window.history.replaceState(null, '', '/checkout/course-1?code=SAVE');
    const couponBodies: CouponBody[] = [];
    const sessions: unknown[] = [];
    serve({ sessions, coupon: (body) => { couponBodies.push(body); return HttpResponse.json(breakdown(0)); } });
    renderCheckout();

    const pay = await screen.findByTestId('checkout-pay-cta');
    await waitFor(() => expect(pay).toHaveTextContent(exact(en.checkout.freeOrderIdle)));
    const email = screen.getByLabelText(en.checkout.emailLabel);
    expect(email).toBeRequired();
    await userEvent.type(email, 'buyer@example.org');
    expect(screen.getByLabelText(en.checkout.emailLabel)).toBe(email);
    expect(email).toHaveFocus();
    expect(screen.getByTestId('checkout-coupon-final')).toHaveTextContent(exact(en.checkout.couponAfterDiscount({ price: pln(0) })));
    await userEvent.click(within(screen.getByTestId('terms-consent')).getByRole('checkbox'));
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ email: 'buyer@example.org', termsAccepted: true, couponCode: 'SAVE' });
    expect(couponBodies).toEqual([{ productId: 'course-1', couponCode: 'SAVE' }]);
  });

  it('opens the invoice and the code rows as buttons that control their panels', async () => {
    serve({});
    renderCheckout();

    const invoice = await screen.findByRole('button', { name: en.checkout.invoiceReveal });
    expect(invoice).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(invoice.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeVisible();
    expect(screen.queryByLabelText(en.checkout.companyNameLabel)).not.toBeInTheDocument();
    await userEvent.click(invoice);
    expect(invoice).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(screen.getByLabelText(en.checkout.companyNameLabel)).toBeVisible();

    const code = screen.getByRole('button', { name: en.checkout.couponReveal });
    expect(code).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(code);
    expect(code).toHaveAttribute('aria-expanded', 'true');
    expect(within(document.getElementById(code.getAttribute('aria-controls') ?? '') ?? document.body).getByLabelText(en.checkout.couponLabel)).toBeVisible();
  });

  it('shows the order total in the summary row and the per-line details behind it', async () => {
    serve({ product: { vatRate: 23, vatExemptionBasis: null } });
    renderCheckout();

    const summary = await screen.findByTestId('checkout-summary');
    expect(within(summary).getByTestId('checkout-summary-total')).toHaveTextContent(exact(pln(4900)));
    expect(within(summary).getByTestId('checkout-summary-total')).toBeVisible();
    expect(summary).toHaveTextContent(en.checkout.itemCount({ count: 1 }));
    const toggle = within(summary).getByRole('button', { name: en.checkout.summaryDetails });
    expect(screen.getByText('Start here.')).not.toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Start here.')).toBeVisible();
    expect(screen.getByText(`${en.salesLinks.vatRate}: 23%`)).toBeVisible();
  });

  it('offers no details toggle when the product has nothing behind it', async () => {
    serve({ product: { description: '' } });
    renderCheckout();

    const summary = await screen.findByTestId('checkout-summary');
    expect(within(summary).getByText(exact(pln(4900)))).toBeVisible();
    expect(within(summary).queryByRole('button')).not.toBeInTheDocument();
  });

  it('places delivery with the locker picker under its option before the invoice and code rows and names the step after it', async () => {
    const sessions: unknown[] = [];
    serve({ sessions, product: { type: 'physical', deliveryMethod: 'shipping' }, payment: { shippingRates } });
    renderCheckout();

    const delivery = await screen.findByTestId('checkout-delivery');
    expect(following(delivery, screen.getByRole('button', { name: en.checkout.invoiceReveal }))).toBe(true);
    expect(following(delivery, screen.getByRole('button', { name: en.checkout.couponReveal }))).toBe(true);
    expect(following(screen.getByTestId('checkout-summary'), delivery)).toBe(true);
    const steps = screen.getByRole('list', { name: en.checkout.stepsLabel });
    expect(within(steps).getAllByRole('listitem')[0]).toHaveTextContent(en.checkout.stepDelivery);

    const pay = screen.getByTestId('checkout-pay-cta');
    expect(pay).toBeDisabled();
    expect(screen.getByTestId('checkout-pay-reason')).toHaveTextContent(exact(en.checkout.payBlockedDelivery));
    const locker = screen.getByRole('radio', { name: new RegExp(`^Parcel locker — ${pln(1499).replace('.', '\\.')}`, 'u') });
    await userEvent.click(locker);
    expect(screen.getByTestId('checkout-pay-reason')).toHaveTextContent(exact(en.checkout.payBlockedLocker));
    const code = screen.getByLabelText(en.shipping.lockerCodeLabel);
    expect(locker.closest('.MuiPaper-root')?.nextElementSibling?.contains(code)).toBe(true);
    expect(following(code, screen.getByRole('radio', { name: new RegExp(`^Courier — ${pln(1999).replace('.', '\\.')}`, 'u') }))).toBe(true);
    await userEvent.type(code, 'waw01m');
    expect(pay).toBeEnabled();
    expect(screen.getByTestId('checkout-pay-reason')).toBeEmptyDOMElement();
    expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(6399) })));
    expect(screen.getByTestId('checkout-next-step')).toHaveTextContent(exact(en.checkout.nextStep({ email: true, address: true, terms: true })));
    await userEvent.click(pay);
    await waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
  });
});

describe('sales-link checkout step one', () => {
  const offer = {
    salesLink: { slug: 'bundle', heading: 'Stand bundle', description: '', validFrom: null, validTo: null },
    descriptionHtml: 'Everything for the desk.', currency: 'PLN', totalCents: 6150, marketingConsents: [],
    lines: [
      { productId: 'stand', name: 'Printed stand', type: 'physical', deliveryMethod: 'pickup', grossCents: 4920, netCents: 4000, vatCents: 920, vatRate: 23, vatExemptionBasis: null, variants: [] },
      { productId: 'guide', name: 'Assembly guide', type: 'digital_download', deliveryMethod: 'pickup', grossCents: 1230, netCents: 1000, vatCents: 230, vatRate: 23, vatExemptionBasis: null, variants: [] },
    ],
    tenant: { slug: 'acme', name: 'Acme School', defaultLanguage: 'en', signInNotice: { enabled: false, text: '' }, branding: {}, socialLinks: [], legal, support: { url: null }, timezone: 'Europe/Warsaw' },
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/offer/bundle?checkout=together');
    server.use(
      anonymousMe(),
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Acme School' }, contentVersion: 1, products: [] } })),
      http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: offer })),
      http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false } })),
    );
  });

  it('summarises the bundle in one row and keeps the per-line VAT behind it', async () => {
    const root = createRootRoute({ component: () => <CheckoutPage productRef="" salesLinkSlug="bundle" /> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/offer/bundle'] }) });
    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Stand bundle' })).toBeVisible();
    const summary = screen.getByTestId('checkout-summary');
    expect(within(summary).getByText(en.checkout.itemCount({ count: 2 }), { exact: false })).toHaveTextContent(exact(`${en.checkout.itemCount({ count: 2 })} · ${pln(6150)}`));
    const lines = within(summary).getByTestId('offer-lines');
    expect(lines).not.toBeVisible();
    await userEvent.click(within(summary).getByRole('button', { name: en.checkout.summaryDetails }));
    expect(lines).toBeVisible();
    expect(within(lines).getByText('Printed stand')).toBeVisible();
    expect(within(lines).getAllByText(en.salesLinks.net)).toHaveLength(2);
    expect(within(lines).getByText(exact(pln(920)))).toBeVisible();
    expect(screen.getByText('Everything for the desk.')).toBeVisible();
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(6150) })));
  });
});
