import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { en } from '../../i18n/en.js';
import { LanguageProvider } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const pln = (cents: number) => formatPrice(cents, 'PLN', 'en');
const rateName = (label: string, cents: number) => new RegExp(`^${label} — ${pln(cents).replace('.', '\\.')}`, 'u');
const body = z.record(z.string(), z.unknown());

const condition = 'I understand a personalised item is made to my order.';
const manufacturer = 'Example Workshop';
const product = {
  id: 'stand', type: 'physical', deliveryMethod: 'shipping', slug: 'stand', title: 'Printed stand',
  description: '<p>A sturdy stand. <a href="https://acme.test/care">Care guide</a></p>',
  coverUrl: null, priceCents: 4900, currency: 'PLN',
  prices: [
    { id: 'price-a', kind: 'one_time', interval: null, amountCents: 4900, currency: 'PLN' },
    { id: 'price-b', kind: 'one_time', interval: null, amountCents: 5900, currency: 'PLN' },
  ],
  variants: [
    { productId: 'stand', slug: 'stand', label: 'Oak', soldOut: false },
    { productId: 'stand-walnut', slug: 'stand-walnut', label: 'Walnut', soldOut: false },
  ],
  personalization: { label: 'Add an engraving', description: 'Engraved by hand.', inputLabel: 'Engraving text', maxLength: 40, condition },
  marketingConsents: [{ definitionId: 'news', label: 'Send me news', doubleOptIn: false, documentUrl: null }],
  compliance: {
    manufacturerName: manufacturer, manufacturerAddress: 'Example Street 1, Warsaw', manufacturerEmail: 'safety@example.com',
    modelIdentifier: 'STAND-1', batchIdentifier: null, safetyWarnings: 'Keep dry.', safetyWarningsHtml: '<p>Keep dry.</p>',
    instructionsUrl: 'https://acme.test/manual.pdf',
  },
};
const shippingRates = [
  { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker' },
  { id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'other', pickupPoint: 'none' },
];
const couponAnswer = (originalCents: number) => ({
  ok: true,
  data: {
    recurringDuration: 'first_invoice',
    breakdown: { couponId: 'coupon-1', code: 'SAVE', originalCents, discountCents: originalCents - 3920, finalCents: 3920, lowestPriceLast30DaysCents: 4500, currency: 'PLN' },
  },
});

type Calls = { sessions: Record<string, unknown>[]; coupons: Record<string, unknown>[] };

const serve = (input: { pageTerms?: boolean; map?: boolean } = {}): Calls => {
  const calls: Calls = { sessions: [], coupons: [] };
  server.use(
    anonymousMe(),
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: {
      tenant: { slug: 'acme', name: 'Acme School', legal: { termsUrl: 'https://acme.test/terms', privacyUrl: input.pageTerms === true ? null : 'https://acme.test/privacy' } },
      contentVersion: 1,
      products: [product],
    } })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: true, simulatedPaymentsEnabled: false, shippingRates,
      inpostGeowidgetToken: input.map === true ? 'public-map-token' : null, inpostGeowidgetWithheld: false,
    } })),
    http.post('/api/public/checkout/coupon', async ({ request }) => {
      const sent = body.parse(await request.json());
      calls.coupons.push(sent);
      return HttpResponse.json(couponAnswer(sent['priceId'] === 'price-b' ? 5900 : 4900));
    }),
    http.post('/api/public/checkout/session', async ({ request }) => {
      calls.sessions.push(body.parse(await request.json()));
      return HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Stop before redirect' } }, { status: 400 });
    }),
  );
  return calls;
};

const renderCheckout = (wrap: (page: React.JSX.Element) => React.JSX.Element = (page) => page) => {
  const root = createRootRoute({ component: () => wrap(<CheckoutPage productRef="stand" />) });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [`${window.location.pathname}${window.location.search}`] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

const pay = () => screen.getByTestId('checkout-pay-cta');
const settle = () => new Promise((resolve) => { window.setTimeout(resolve, 100); });
const chooseCourier = async () => {
  await userEvent.click(await screen.findByRole('radio', { name: rateName('Courier', 1999) }));
  await waitFor(() => expect(pay()).toBeEnabled());
};
const openRow = async (name: string) => {
  const header = await screen.findByRole('button', { name });
  await userEvent.click(header);
  return header;
};
const fillInvoice = async () => {
  await openRow(en.checkout.invoiceReveal);
  await userEvent.type(screen.getByLabelText(en.checkout.nipLabel), '1234567890');
  await userEvent.type(screen.getByLabelText(en.checkout.companyNameLabel), 'Buyer Ltd');
  await userEvent.type(screen.getByLabelText(en.checkout.addressLabel), 'Main Street 2');
  await userEvent.type(screen.getByLabelText(en.checkout.postalCodeLabel), '00-001');
  await userEvent.type(screen.getByLabelText(en.checkout.cityLabel), 'Warsaw');
};
const tickEngraving = async () => {
  await userEvent.click(screen.getByRole('checkbox', { name: /Add an engraving/u }));
  await userEvent.type(screen.getByLabelText('Engraving text'), 'For Alex');
  await userEvent.click(screen.getByRole('checkbox', { name: condition }));
};
const geowidget = async () => {
  const host = await screen.findByTestId('checkout-inpost-geowidget');
  const widget = host.querySelector('inpost-geowidget');
  if (widget === null) throw new Error('Missing parcel locker map');
  return widget;
};
const pickLockerOnMap = async () => {
  await userEvent.click(await screen.findByRole('radio', { name: rateName('Parcel locker', 1499) }));
  const widget = await geowidget();
  document.dispatchEvent(new CustomEvent(widget.getAttribute('onpoint') ?? '', { detail: { name: 'KRA010', location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } } }));
  await screen.findByTestId('checkout-pickup-point-selected');
};
const submitted = (calls: Calls) => waitFor(() => expect(calls.sessions).toHaveLength(1));
const notSubmitted = async (calls: Calls) => {
  await settle();
  expect(calls.sessions).toHaveLength(0);
};

type EnterCase = {
  control: string;
  state: string;
  setup?: { pageTerms?: boolean; map?: boolean; url?: string };
  arrange: () => Promise<HTMLElement>;
  outcome: 'submits' | 'does not submit';
  after?: (calls: Calls, element: HTMLElement) => Promise<void> | void;
};

const invoiceFields = [
  en.checkout.nipLabel, en.checkout.companyNameLabel, en.checkout.addressLabel, en.checkout.postalCodeLabel, en.checkout.cityLabel, en.checkout.countryLabel,
];

const enterCases: EnterCase[] = [
  {
    control: 'delivery option', state: 'courier chosen, pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); return screen.getByRole('radio', { name: rateName('Courier', 1999) }); },
    after: (_calls, element) => { expect(element).toBeChecked(); },
  },
  {
    control: 'delivery option', state: 'locker chosen without a code, pay disabled', outcome: 'does not submit',
    arrange: async () => {
      const locker = await screen.findByRole('radio', { name: rateName('Parcel locker', 1499) });
      await userEvent.click(locker);
      expect(pay()).toBeDisabled();
      return locker;
    },
  },
  {
    control: 'locker code field', state: 'valid code, pay enabled', outcome: 'does not submit',
    arrange: async () => {
      await userEvent.click(await screen.findByRole('radio', { name: rateName('Parcel locker', 1499) }));
      const code = screen.getByLabelText(en.shipping.lockerCodeLabel);
      await userEvent.type(code, 'WAW01M');
      expect(pay()).toBeEnabled();
      return code;
    },
  },
  {
    control: 'locker picker (an input of the map)', state: 'locker picked on the map, pay enabled', setup: { map: true }, outcome: 'does not submit',
    arrange: async () => {
      await pickLockerOnMap();
      expect(pay()).toBeEnabled();
      const search = document.createElement('input');
      search.setAttribute('aria-label', 'Map search');
      (await geowidget()).append(search);
      return search;
    },
  },
  ...invoiceFields.map((label): EnterCase => ({
    control: `invoice field "${label}"`, state: 'invoice filled, pay enabled', outcome: 'submits',
    arrange: async () => { await chooseCourier(); await fillInvoice(); return screen.getByLabelText(label); },
    after: (calls) => { expect(calls.sessions[0]).toMatchObject({ billing: { companyName: 'Buyer Ltd', city: 'Warsaw' } }); },
  })),
  {
    control: `invoice field "${en.checkout.companyNameLabel}"`, state: 'invoice filled, no delivery, pay disabled', outcome: 'does not submit',
    arrange: async () => { await fillInvoice(); expect(pay()).toBeDisabled(); return screen.getByLabelText(en.checkout.companyNameLabel); },
  },
  {
    control: 'discount code field', state: 'code typed, pay enabled', outcome: 'does not submit',
    arrange: async () => {
      await chooseCourier();
      await openRow(en.checkout.couponReveal);
      await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'SAVE');
      return screen.getByLabelText(en.checkout.couponLabel);
    },
    after: async (calls) => {
      await waitFor(() => expect(calls.coupons).toHaveLength(1));
      expect(await screen.findByRole('button', { name: en.checkout.couponRemoveLabel({ code: 'SAVE' }) })).toBeVisible();
    },
  },
  {
    control: 'Apply button', state: 'code typed, pay enabled', outcome: 'does not submit',
    arrange: async () => {
      await chooseCourier();
      await openRow(en.checkout.couponReveal);
      await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'SAVE');
      return screen.getByTestId('checkout-coupon-apply');
    },
    after: async (calls) => { await waitFor(() => expect(calls.coupons).toHaveLength(1)); },
  },
  {
    control: 'Remove button', state: 'link code applied, pay enabled', setup: { url: '/checkout/stand?code=SAVE' }, outcome: 'does not submit',
    arrange: async () => {
      await chooseCourier();
      return screen.findByRole('button', { name: en.checkout.couponRemoveLabel({ code: 'SAVE' }) });
    },
    after: async () => { expect(await screen.findByLabelText(en.checkout.couponLabel)).toHaveValue(''); },
  },
  {
    control: 'price choice', state: 'pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); return within(screen.getByTestId('checkout-price-price-a')).getByRole('radio'); },
    after: (_calls, element) => { expect(element).toBeChecked(); },
  },
  {
    control: 'personalisation checkbox', state: 'unticked, pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); return screen.getByRole('checkbox', { name: /Add an engraving/u }); },
    after: (_calls, element) => { expect(element).not.toBeChecked(); },
  },
  {
    control: 'personalisation text', state: 'ticked and complete, pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); await tickEngraving(); expect(pay()).toBeEnabled(); return screen.getByLabelText('Engraving text'); },
    after: (_calls, element) => { expect(element).toHaveValue('For Alex\n'); },
  },
  {
    control: 'personalisation condition', state: 'ticked, pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); await tickEngraving(); return screen.getByRole('checkbox', { name: condition }); },
    after: (_calls, element) => { expect(element).toBeChecked(); },
  },
  {
    control: 'workspace consent checkbox', state: 'pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); return screen.getByRole('checkbox', { name: /Send me news/u }); },
    after: (_calls, element) => { expect(element).not.toBeChecked(); },
  },
  {
    control: 'terms-fallback email field (details placement)', state: 'terms ticked, pay enabled', setup: { pageTerms: true }, outcome: 'submits',
    arrange: async () => {
      await chooseCourier();
      await userEvent.click(within(screen.getByTestId('terms-consent')).getByRole('checkbox'));
      await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
      return screen.getByLabelText(en.checkout.emailLabel);
    },
    after: (calls) => { expect(calls.sessions[0]).toMatchObject({ email: 'buyer@example.org', termsAccepted: true }); },
  },
  {
    control: 'terms-fallback email field (details placement)', state: 'no delivery, pay disabled', setup: { pageTerms: true }, outcome: 'does not submit',
    arrange: async () => {
      await userEvent.click(within(await screen.findByTestId('terms-consent')).getByRole('checkbox'));
      await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
      expect(pay()).toBeDisabled();
      return screen.getByLabelText(en.checkout.emailLabel);
    },
  },
  {
    control: 'terms checkbox', state: 'ticked, email typed, pay enabled', setup: { pageTerms: true }, outcome: 'does not submit',
    arrange: async () => {
      await chooseCourier();
      await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
      const terms = within(screen.getByTestId('terms-consent')).getByRole('checkbox');
      await userEvent.click(terms);
      return terms;
    },
    after: (_calls, element) => { expect(element).toBeChecked(); },
  },
  {
    control: '"Details and VAT" toggle', state: 'closed, pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); return screen.getByRole('button', { name: en.checkout.summaryDetails }); },
    after: (_calls, element) => { expect(element).toHaveAttribute('aria-expanded', 'true'); },
  },
  {
    control: 'safety Details toggle', state: 'closed, pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); return screen.getByRole('button', { name: en.productSafety.detailsFor({ name: manufacturer }) }); },
    after: (_calls, element) => { expect(element).toHaveAttribute('aria-expanded', 'true'); },
  },
  {
    control: 'invoice row header', state: 'closed, pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); return screen.getByRole('button', { name: en.checkout.invoiceReveal }); },
    after: (_calls, element) => { expect(element).toHaveAttribute('aria-expanded', 'true'); },
  },
  {
    control: 'discount row header', state: 'closed, pay enabled', outcome: 'does not submit',
    arrange: async () => { await chooseCourier(); return screen.getByRole('button', { name: en.checkout.couponReveal }); },
    after: (_calls, element) => { expect(element).toHaveAttribute('aria-expanded', 'true'); },
  },
  {
    control: 'pay button', state: 'enabled', outcome: 'submits',
    arrange: async () => { await chooseCourier(); return pay(); },
  },
];

describe('Enter and Escape on the checkout page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/stand');
  });
  afterEach(() => {
    window.localStorage.clear();
    document.getElementById('inpost-geowidget-script')?.remove();
    document.getElementById('inpost-geowidget-style')?.remove();
  });

  it.each(enterCases)('Enter on $control ($state) $outcome', async ({ setup, arrange, outcome, after }) => {
    if (setup?.url !== undefined) window.history.replaceState(null, '', setup.url);
    const calls = serve(setup ?? {});
    renderCheckout();
    const element = await arrange();
    element.focus();
    await userEvent.keyboard('{Enter}');
    if (outcome === 'submits') await submitted(calls);
    else await notSubmitted(calls);
    await after?.(calls, element);
  });

  it('leaves Enter on the variant chips, the document links and the language switch to the browser', async () => {
    serve({ pageTerms: true });
    renderCheckout((page) => <LanguageProvider>{page}</LanguageProvider>);
    await chooseCourier();
    await userEvent.click(screen.getByRole('button', { name: en.productSafety.detailsFor({ name: manufacturer }) }));
    const natives = [
      screen.getByTestId('product-variant-stand-walnut'),
      within(screen.getByTestId('terms-consent').closest('label') ?? document.body).getByRole('link', { name: en.consent.terms }),
      screen.getByRole('link', { name: en.productSafety.instructions }),
      screen.getByRole('link', { name: 'safety@example.com' }),
    ];
    for (const element of natives) {
      expect(element).toHaveAttribute('href');
      expect(fireEvent.keyDown(element, { key: 'Enter' })).toBe(true);
    }
    const polish = screen.getByRole('button', { name: 'pl' });
    polish.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'pl', pressed: true })).toHaveFocus();
  });

  it('closes the open discount row on Escape from a field inside it and returns focus to its header', async () => {
    serve();
    renderCheckout();
    const header = await openRow(en.checkout.couponReveal);
    const code = screen.getByLabelText(en.checkout.couponLabel);
    await userEvent.type(code, 'SAVE');
    await userEvent.keyboard('{Escape}');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveFocus();
    await userEvent.click(header);
    expect(screen.getByLabelText(en.checkout.couponLabel)).toHaveValue('SAVE');
  });

  it('closes the open order details on Escape from a link inside them and returns focus to the toggle', async () => {
    serve();
    renderCheckout();
    const toggle = await openRow(en.checkout.summaryDetails);
    const link = screen.getByRole('link', { name: 'Care guide' });
    link.focus();
    await userEvent.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('closes the open safety details on Escape from a link inside them and returns focus to the toggle', async () => {
    serve();
    renderCheckout();
    const toggle = await openRow(en.productSafety.detailsFor({ name: manufacturer }));
    screen.getByRole('link', { name: en.productSafety.instructions }).focus();
    await userEvent.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('keeps the invoice row open on Escape, because closing it withdraws the invoice request', async () => {
    const calls = serve();
    renderCheckout();
    await chooseCourier();
    await fillInvoice();
    const header = screen.getByRole('button', { name: en.checkout.invoiceReveal });
    const city = screen.getByLabelText(en.checkout.cityLabel);
    expect(fireEvent.keyDown(city, { key: 'Escape' })).toBe(true);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(city).toHaveValue('Warsaw');
    await userEvent.click(pay());
    await submitted(calls);
    expect(calls.sessions[0]).toMatchObject({ billing: { companyName: 'Buyer Ltd', city: 'Warsaw' } });
  });

  it('leaves Escape alone outside a collapsible row', async () => {
    serve();
    renderCheckout();
    await userEvent.click(await screen.findByRole('radio', { name: rateName('Parcel locker', 1499) }));
    expect(fireEvent.keyDown(screen.getByLabelText(en.shipping.lockerCodeLabel), { key: 'Escape' })).toBe(true);
  });
});
