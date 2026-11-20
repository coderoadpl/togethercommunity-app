import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { AppChromeProvider } from '../../components/ui/app-chrome.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { formatPrice } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server } from '../../test/server.js';
import { languagePreference } from '../../theme-mode.js';
import { CheckoutPage } from './CheckoutPage.js';

const pln = (cents: number) => formatPrice(cents, 'PLN', 'en');
const exact = (value: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')}$`, 'u');
const legal = { termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' };
const following = (first: Element, second: Element) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const shippingRates = [
  { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker' },
  { id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'other', pickupPoint: 'none' },
];
const courier = () => screen.getByRole('radio', { name: new RegExp(`^Courier — ${pln(1999).replace('.', '\\.')}`, 'u') });

const product = (change: Record<string, unknown> = {}) => ({
  id: 'stand', type: 'physical', deliveryMethod: 'shipping', slug: 'stand', title: 'Printed stand', description: 'A small stand.',
  coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [], ...change,
});

const coupon = {
  ok: true,
  data: {
    recurringDuration: 'first_invoice',
    breakdown: { couponId: 'coupon-1', code: 'SAVE', originalCents: 4900, discountCents: 980, finalCents: 3920, lowestPriceLast30DaysCents: 4500, currency: 'PLN' },
  },
};

const serve = (input: { product?: Record<string, unknown>; couponValid?: boolean } = {}) => {
  server.use(
    anonymousMe(),
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: {
      tenant: { slug: 'acme', name: 'Acme School', legal }, contentVersion: 1, products: [product(input.product)],
    } })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false, shippingRates } })),
    http.post('/api/public/checkout/coupon', () => input.couponValid === true
      ? HttpResponse.json(coupon)
      : HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Coupon cannot be applied' } }, { status: 400 })),
  );
};

const countCouponAndSessionRequests = () => {
  const calls = { coupon: 0, session: 0 };
  serve({ couponValid: true });
  server.use(
    http.post('/api/public/checkout/coupon', () => {
      calls.coupon += 1;
      return HttpResponse.json(coupon);
    }),
    http.post('/api/public/checkout/session', () => {
      calls.session += 1;
      return HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Stop before redirect' } }, { status: 400 });
    }),
  );
  return calls;
};

const renderCheckout = (page = <CheckoutPage productRef="stand" />) => {
  const root = createRootRoute({ component: () => page });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/checkout/stand'] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

const breakdownRows = (panel: HTMLElement) => within(panel).getAllByRole('term').map((term) => `${term.textContent ?? ''} ${term.nextElementSibling?.textContent ?? ''}`);

describe('checkout content', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/stand');
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('lists products, discount and delivery behind the summary with a total equal to the pay button', async () => {
    window.history.replaceState(null, '', '/checkout/stand?code=SAVE');
    serve({ couponValid: true });
    renderCheckout();

    expect(await screen.findByTestId('checkout-coupon-final')).toHaveTextContent(exact(en.checkout.couponAfterDiscount({ price: pln(3920) })));
    await userEvent.click(courier());
    const pay = screen.getByTestId('checkout-pay-cta');
    expect(pay).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(5919) })));
    const summary = screen.getByTestId('checkout-summary');
    expect(within(summary).getByTestId('checkout-summary-total')).toHaveTextContent(exact(pln(5919)));
    await userEvent.click(within(summary).getByRole('button', { name: en.checkout.summaryDetails }));
    expect(breakdownRows(within(summary).getByTestId('checkout-price-breakdown'))).toEqual([
      `${en.checkout.breakdownProducts} ${pln(4900)}`,
      `${en.checkout.breakdownDiscount} −${pln(980)}`,
      `${en.checkout.breakdownDelivery} ${pln(1999)}`,
      `${en.checkout.breakdownTotal} ${pln(5919)}`,
    ]);
    expect(screen.queryByText(new RegExp(`^${en.checkout.couponFinal({ price: '' })}`, 'u'))).not.toBeInTheDocument();
  });

  it('announces a changed summary total politely', async () => {
    serve();
    renderCheckout();
    expect(await screen.findByTestId('checkout-summary-total')).toHaveAttribute('aria-live', 'polite');
  });

  it('names the delivery options once, without a second group around them', async () => {
    serve();
    renderCheckout();
    const delivery = await screen.findByTestId('checkout-delivery');
    expect(within(delivery).getByRole('radiogroup', { name: en.shipping.deliveryHeading })).toBeInTheDocument();
    expect(within(screen.getByTestId('checkout-delivery').parentElement ?? document.body).queryByRole('group')).not.toBeInTheDocument();
  });

  it('announces the applied code without its amount, labels the closed row with the code and the amount and removes it', async () => {
    window.history.replaceState(null, '', '/checkout/stand?code=SAVE');
    serve({ couponValid: true });
    renderCheckout();

    const applied = await screen.findByTestId('checkout-coupon-applied');
    expect(applied).toHaveTextContent(exact(en.checkout.couponAppliedLine({ code: 'SAVE' })));
    expect(applied).toHaveAttribute('role', 'status');
    expect(applied).not.toHaveTextContent(pln(980));
    expect(screen.queryByLabelText(en.checkout.couponLabel)).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-coupon-apply')).not.toBeInTheDocument();
    const row = screen.getByRole('button', { name: `${en.checkout.couponAppliedRow({ code: 'SAVE' })} −${pln(980)}` });
    const amount = within(row).getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === `−${pln(980)}`);
    expect(amount).toHaveStyle({ whiteSpace: 'nowrap' });
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(row);

    await userEvent.click(screen.getByRole('button', { name: en.checkout.couponRemoveLabel({ code: 'SAVE' }) }));
    expect(screen.getByLabelText(en.checkout.couponLabel)).toHaveValue('');
    expect(screen.getByRole('button', { name: en.checkout.couponReveal })).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-coupon-breakdown')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-summary-total')).toHaveTextContent(exact(pln(4900)));
  });

  it('puts the applied code in its own column with Remove at the column edge, still tall enough to tap', async () => {
    window.history.replaceState(null, '', '/checkout/stand?code=SAVE');
    serve({ couponValid: true });
    renderCheckout();

    const applied = await screen.findByTestId('checkout-coupon-applied');
    const remove = screen.getByTestId('checkout-coupon-remove');
    const line = applied.parentElement;
    expect(line).toBe(remove.parentElement);
    expect(line).toHaveStyle({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto' });
    expect(applied).toHaveStyle({ overflowWrap: 'anywhere' });
    expect(remove).toHaveStyle({ paddingLeft: '0px', paddingRight: '0px', minHeight: '2.75rem' });
  });

  it('moves focus to Remove after a code is applied by hand and back to the code field after Remove', async () => {
    serve({ couponValid: true });
    renderCheckout();
    await userEvent.click(await screen.findByRole('button', { name: en.checkout.couponReveal }));
    await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'SAVE');
    await userEvent.click(screen.getByTestId('checkout-coupon-apply'));

    const remove = await screen.findByRole('button', { name: en.checkout.couponRemoveLabel({ code: 'SAVE' }) });
    await waitFor(() => expect(remove).toHaveFocus());
    await userEvent.click(remove);
    expect(screen.getByLabelText(en.checkout.couponLabel)).toHaveFocus();
  });

  it('leaves focus alone when the code arrives with the link', async () => {
    window.history.replaceState(null, '', '/checkout/stand?code=SAVE');
    serve({ couponValid: true });
    renderCheckout();

    const remove = await screen.findByRole('button', { name: en.checkout.couponRemoveLabel({ code: 'SAVE' }) });
    await screen.findByTestId('checkout-coupon-breakdown');
    expect(remove).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it('applies a typed code on Enter in the code field without submitting the checkout', async () => {
    const calls = countCouponAndSessionRequests();
    renderCheckout();
    await screen.findByTestId('checkout-delivery');
    await userEvent.click(courier());
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: en.checkout.couponReveal }));
    await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'SAVE{Enter}');

    await waitFor(() => expect(calls).toEqual({ coupon: 1, session: 0 }));
    const remove = await screen.findByRole('button', { name: en.checkout.couponRemoveLabel({ code: 'SAVE' }) });
    await waitFor(() => expect(remove).toHaveFocus());
    expect(calls).toEqual({ coupon: 1, session: 0 });
  });

  it('sends nothing on Enter in an empty code field', async () => {
    const calls = countCouponAndSessionRequests();
    renderCheckout();
    await screen.findByTestId('checkout-delivery');
    await userEvent.click(courier());
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: en.checkout.couponReveal }));
    await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), '{Enter}');

    await new Promise((resolve) => { window.setTimeout(resolve, 100); });
    expect(calls).toEqual({ coupon: 0, session: 0 });
    expect(screen.getByLabelText(en.checkout.couponLabel)).toHaveFocus();
  });

  it('gives the empty-field Apply code button a reason next to it', async () => {
    serve();
    renderCheckout();
    await userEvent.click(await screen.findByRole('button', { name: en.checkout.couponReveal }));
    const apply = screen.getByTestId('checkout-coupon-apply');
    expect(apply).toBeDisabled();
    expect(apply).toHaveAccessibleDescription(en.checkout.couponEmpty);
    expect(screen.getByText(en.checkout.couponEmpty)).toBeVisible();
    await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'SAVE');
    expect(apply).toBeEnabled();
    expect(apply).not.toHaveAccessibleDescription();
    expect(screen.queryByText(en.checkout.couponEmpty)).not.toBeInTheDocument();
  });

  it('offers no discount row on a free product without a code and names the free order without an amount', async () => {
    serve({ product: { priceCents: 0, deliveryMethod: 'pickup' } });
    renderCheckout();
    const pay = await screen.findByTestId('checkout-pay-cta');
    expect(pay).toHaveTextContent(exact(en.checkout.freeOrderIdle));
    expect(screen.getByRole('button', { name: en.checkout.invoiceReveal })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.checkout.couponReveal })).not.toBeInTheDocument();
  });

  it('asks for the email and the terms before the optional invoice row when the page collects the buyer', async () => {
    serve({ product: { priceCents: 0, deliveryMethod: 'pickup' } });
    renderCheckout();
    const email = await screen.findByLabelText(en.checkout.emailLabel);
    const invoice = screen.getByRole('button', { name: en.checkout.invoiceReveal });
    expect(following(email, invoice)).toBe(true);
    expect(following(screen.getByTestId('terms-consent'), invoice)).toBe(true);
  });

  it('fills the invoice fields from the browser and puts the postal code and the city in one row', async () => {
    serve({ product: { deliveryMethod: 'pickup' } });
    renderCheckout();
    await userEvent.click(await screen.findByRole('button', { name: en.checkout.invoiceReveal }));
    expect(screen.getByLabelText(en.checkout.companyNameLabel)).toHaveAttribute('autocomplete', 'organization');
    expect(screen.getByLabelText(en.checkout.addressLabel)).toHaveAttribute('autocomplete', 'street-address');
    expect(screen.getByLabelText(en.checkout.postalCodeLabel)).toHaveAttribute('autocomplete', 'postal-code');
    expect(screen.getByLabelText(en.checkout.cityLabel)).toHaveAttribute('autocomplete', 'address-level2');
    expect(screen.getByLabelText(en.checkout.countryLabel)).toHaveAttribute('autocomplete', 'country');
    const locality = screen.getByTestId('checkout-invoice-locality');
    expect(within(locality).getAllByRole('textbox')).toEqual([screen.getByLabelText(en.checkout.postalCodeLabel), screen.getByLabelText(en.checkout.cityLabel)]);
  });

  it('shows a Polish eyebrow that does not name payment above the steps', async () => {
    languagePreference.save('pl');
    serve();
    renderCheckout(<LanguageProvider><CheckoutPage productRef="stand" /></LanguageProvider>);
    expect(await screen.findByText(pl.checkout.orderEyebrow)).toBeInTheDocument();
    expect(screen.queryByText(pl.checkout.checkoutEyebrow)).not.toBeInTheDocument();
  });

  it('names the summary toggle in full while showing a short label', async () => {
    serve();
    renderCheckout();
    const summary = await screen.findByTestId('checkout-summary');
    const toggle = within(summary).getByRole('button', { name: en.checkout.summaryDetails });
    expect(within(toggle).getByText(en.checkout.summaryDetailsShort)).toBeInTheDocument();
    expect(en.checkout.summaryDetailsShort.length).toBeLessThan(en.checkout.summaryDetails.length);
  });

  it('keeps the amount of a free delivery option in its price column', async () => {
    server.use(
      anonymousMe(),
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Acme School', legal }, contentVersion: 1, products: [product()] } })),
      http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false, shippingRates: [{ ...shippingRates[0], amountCents: 0 }] } })),
    );
    renderCheckout();
    expect(await screen.findByTestId('checkout-delivery-price-locker')).toHaveTextContent(exact(pln(0)));
  });

  it('replaces the floating language switcher with one in the card header', async () => {
    serve();
    renderCheckout(<AppChromeProvider><LanguageSwitcher /><CheckoutPage productRef="stand" /></AppChromeProvider>);
    await screen.findByTestId('checkout-pay-cta');
    const switchers = screen.getAllByTestId('language-switcher');
    expect(switchers).toHaveLength(1);
    expect(switchers[0]?.closest('form')).toBe(screen.getByTestId('checkout-pay-cta').closest('form'));
    expect(screen.queryByRole('region', { name: en.common.language })).not.toBeInTheDocument();
  });

  it('reports the locker code as invalid only after the field was left', async () => {
    serve();
    renderCheckout();
    await userEvent.click(await screen.findByRole('radio', { name: new RegExp(`^Parcel locker — ${pln(1499).replace('.', '\\.')}`, 'u') }));
    const code = screen.getByLabelText(en.shipping.lockerCodeLabel);
    await userEvent.type(code, 'waw');
    expect(code).toHaveAccessibleDescription(en.shipping.lockerCodeHint);
    expect(screen.getByTestId('checkout-pay-reason')).toHaveTextContent(exact(en.checkout.payBlockedLocker));
    await userEvent.tab();
    expect(code).toHaveAccessibleDescription(en.shipping.lockerCodeInvalid);
  });
});

describe('sales-link checkout content', () => {
  const offer = {
    salesLink: { slug: 'bundle', heading: 'Stand bundle', description: '', validFrom: null, validTo: null },
    descriptionHtml: 'Everything for the desk.', currency: 'PLN', totalCents: 6150, marketingConsents: [],
    lines: [
      { productId: 'stand', name: 'Printed stand', type: 'physical', deliveryMethod: 'shipping', grossCents: 4920, netCents: 4000, vatCents: 920, vatRate: 23, vatExemptionBasis: null, variants: [] },
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
      http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false, shippingRates } })),
    );
  });

  it('lists the products and the chosen delivery with a total equal to the pay button', async () => {
    renderCheckout(<CheckoutPage productRef="" salesLinkSlug="bundle" />);
    await userEvent.click(await screen.findByRole('radio', { name: new RegExp(`^Courier — ${pln(1999).replace('.', '\\.')}`, 'u') }));
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.goToPayment({ price: pln(8149) })));
    const summary = screen.getByTestId('checkout-summary');
    expect(within(summary).getByTestId('checkout-summary-total')).toHaveTextContent(exact(pln(8149)));
    await userEvent.click(within(summary).getByRole('button', { name: en.checkout.summaryDetails }));
    expect(breakdownRows(within(summary).getByTestId('checkout-price-breakdown'))).toEqual([
      `${en.checkout.breakdownProducts} ${pln(6150)}`,
      `${en.checkout.breakdownDelivery} ${pln(1999)}`,
      `${en.checkout.breakdownTotal} ${pln(8149)}`,
    ]);
    expect(within(summary).queryByText(new RegExp(`^${en.salesLinks.total}:`, 'u'))).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled());
  });
});
