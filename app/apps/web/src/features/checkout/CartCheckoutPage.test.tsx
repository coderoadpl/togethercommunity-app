import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBrowserHistory, createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useParams } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CART_CURRENCY_MISMATCH_MESSAGE, HOSTED_CART_PATH } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { formatPrice } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CartCheckoutPage } from './CartCheckoutPage.js';
import { CheckoutPage } from './CheckoutPage.js';

const analytics = vi.hoisted(() => ({ loadGoogleTag: vi.fn(), loadMetaPixel: vi.fn(), trackCheckoutPurchase: vi.fn() }));
vi.mock('./analytics.js', () => analytics);

const poster = '00000000-0000-4000-8000-0000000000a1';
const ebook = '00000000-0000-4000-8000-0000000000a2';
const organizer = '00000000-0000-4000-8000-0000000000a3';
const journal = '00000000-0000-4000-8000-0000000000a4';
const bag = '00000000-0000-4000-8000-0000000000a5';
const mug = '00000000-0000-4000-8000-0000000000a6';
const pln = (cents: number) => formatPrice(cents, 'PLN', 'en');
const eur = (cents: number) => formatPrice(cents, 'EUR', 'en');
const exact = (value: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')}$`, 'u');
const lockerOption = new RegExp(`^Parcel locker — ${pln(1499).replace('.', '\\.')}`, 'u');
const analyticsConfig = { cookieScope: 'host' as const, metaPixelId: '12345678', tagId: 'G-ABC1234', consentCookieName: 'consent', consentCookieValue: null, loadWithoutConsent: true };

const products = {
  [poster]: {
    id: poster, type: 'physical', deliveryMethod: 'shipping', slug: 'poster', title: 'Poster', description: '', coverUrl: null,
    priceCents: 3500, currency: 'PLN', maxQuantity: 10, prices: [{ id: 'price-poster', kind: 'one_time', interval: null, amountCents: 3500, currency: 'PLN' }],
    marketingConsents: [{ definitionId: 'news', label: 'Send me news', doubleOptIn: false, documentUrl: null }],
    compliance: { manufacturerName: 'Print House', manufacturerAddress: 'Main Street 1', manufacturerEmail: 'safety@example.org', modelIdentifier: 'P-1', batchIdentifier: null, safetyWarningsHtml: '', instructionsUrl: null },
  },
  [ebook]: {
    id: ebook, type: 'digital_download', deliveryMethod: 'pickup', slug: 'ebook', title: 'E-book', description: '', coverUrl: null,
    priceCents: 2500, currency: 'PLN', prices: [{ id: 'price-ebook', kind: 'one_time', interval: null, amountCents: 2500, currency: 'PLN' }],
    marketingConsents: [{ definitionId: 'news', label: 'Send me news', doubleOptIn: false, documentUrl: null }],
  },
  [organizer]: {
    id: organizer, type: 'digital_download', deliveryMethod: 'pickup', slug: 'cart', title: 'Cart Organizer', description: '', coverUrl: null,
    priceCents: 1500, currency: 'PLN', prices: [{ id: 'price-organizer', kind: 'one_time', interval: null, amountCents: 1500, currency: 'PLN' }],
  },
  [journal]: {
    id: journal, type: 'digital_download', deliveryMethod: 'pickup', slug: 'journal', title: 'Journal', description: '', coverUrl: null,
    priceCents: 4000, currency: 'PLN', marketingConsents: [], prices: [
      { id: 'price-journal-monthly', kind: 'recurring', interval: 'month', amountCents: 900, currency: 'PLN' },
      { id: 'price-journal', kind: 'one_time', interval: null, amountCents: 4000, currency: 'PLN' },
    ],
  },
  [bag]: {
    id: bag, type: 'physical', deliveryMethod: 'pickup', slug: 'bag', title: 'Bag', description: '', coverUrl: null,
    priceCents: 1000, currency: 'PLN', maxQuantity: 10, marketingConsents: [], prices: [
      { id: 'price-bag-small', kind: 'one_time', interval: null, amountCents: 1000, currency: 'PLN' },
      { id: 'price-bag-large', kind: 'one_time', interval: null, amountCents: 1200, currency: 'PLN' },
    ],
  },
  [mug]: {
    id: mug, type: 'physical', deliveryMethod: 'shipping', slug: 'mug', title: 'Mug', description: '', coverUrl: null,
    priceCents: 1200, currency: 'EUR', maxQuantity: 10, marketingConsents: [], prices: [{ id: 'price-mug', kind: 'one_time', interval: null, amountCents: 1200, currency: 'EUR' }],
  },
};

const lowStock = (available: number) => ({ stock: { tracked: true, soldOut: false, low: true, available }, maxQuantity: available });
const soldOutStock = { stock: { tracked: true, soldOut: true, low: true, available: 0 }, maxQuantity: 0 };

const shippingRates = [
  { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker' },
  { id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'other', pickupPoint: 'none' },
];

const serve = (input: {
  token?: string | null;
  canTest?: boolean;
  testEnabled?: boolean;
  missing?: readonly string[];
  overrides?: Readonly<Record<string, Record<string, unknown>>>;
  requests?: string[];
  sessionError?: string;
  sessionRefusal?: { status: number; error: Record<string, unknown> };
  onSession?: (body: unknown) => void;
  onCoupon?: (body: unknown) => void;
} = {}) => {
  const record = (request: Request) => input.requests?.push(`${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`);
  server.use(
    http.get('/api/public/offer', ({ request }) => {
      record(request);
      const ref = new URL(request.url).searchParams.get('productRef') ?? '';
      const product = Object.entries(products).find(([id, entry]) => (id === ref || entry.slug === ref) && !(input.missing ?? []).includes(id))?.[1];
      return product === undefined
        ? HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'No product' } }, { status: 404 })
        : HttpResponse.json({ ok: true, data: {
          tenant: { slug: 'acme', name: 'Acme School', legal: { termsUrl: 'https://acme.example/terms', privacyUrl: null } },
          contentVersion: 1, products: [{ ...product, ...input.overrides?.[product.id] }],
        } });
    }),
    http.get('/api/public/payment-config', ({ request }) => {
      record(request);
      return HttpResponse.json({ ok: true, data: {
        stripeConfigured: true, simulatedPaymentsEnabled: false, shippingRates, analytics: analyticsConfig,
        inpostGeowidgetToken: input.token ?? null, canTest: input.canTest ?? false,
        testConfigured: input.canTest === true || input.testEnabled === true, testEnabled: input.testEnabled ?? false,
      } });
    }),
    http.post('/api/public/checkout/session', async ({ request }) => {
      record(request);
      input.onSession?.(await request.json());
      return input.sessionRefusal === undefined
        ? HttpResponse.json({ ok: false, error: { code: 'validation', message: input.sessionError ?? 'Stop before redirect' } }, { status: 400 })
        : HttpResponse.json({ ok: false, error: input.sessionRefusal.error }, { status: input.sessionRefusal.status });
    }),
    http.post('/api/public/checkout/coupon', async ({ request }) => {
      record(request);
      input.onCoupon?.(await request.json());
      return HttpResponse.json({ ok: true, data: {
        breakdown: { couponId: 'coupon', code: 'CART', originalCents: 9500, discountCents: 950, finalCents: 8550, lowestPriceLast30DaysCents: 9500, currency: 'PLN' },
        recurringDuration: 'first_invoice',
      } });
    }),
  );
};

const renderCart = (path: string) => {
  window.history.replaceState(null, '', path);
  const root = createRootRoute({ component: CartCheckoutPage });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [path] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

const line = (productId: string) => within(screen.getByTestId(`cart-line-${productId}`));
const summaryAmount = (row: 'products' | 'discount' | 'delivery' | 'total') => within(screen.getByTestId(`cart-summary-${row}`)).getByRole('definition');
const summaryRows = () => within(screen.getByTestId('cart-summary')).getAllByRole('term').map((term) => `${term.textContent ?? ''} ${term.nextElementSibling?.textContent ?? ''}`);

const SingleProductCheckout = () => <CheckoutPage productRef={useParams({ strict: false }).productRef ?? ''} />;

const renderCheckoutRoutes = (path: string) => {
  window.history.replaceState(null, '', path);
  const root = createRootRoute({ component: Outlet });
  const cart = createRoute({ getParentRoute: () => root, path: HOSTED_CART_PATH, component: CartCheckoutPage });
  const single = createRoute({ getParentRoute: () => root, path: '/checkout/$productRef', component: SingleProductCheckout });
  const router = createRouter({ routeTree: root.addChildren([cart, single]), history: createMemoryHistory({ initialEntries: [path] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('hosted cart checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analytics.loadGoogleTag.mockReturnValue(true);
    analytics.loadMetaPixel.mockReturnValue(true);
  });
  afterEach(() => {
    document.getElementById('inpost-geowidget-script')?.remove();
    document.getElementById('inpost-geowidget-style')?.remove();
  });

  it('renders the lines of the query string and posts the cart payload through the client', async () => {
    const bodies: unknown[] = [];
    serve({ onSession: (body) => bodies.push(body) });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.2~${ebook}.1&utm_source=meta`);

    expect(await screen.findByRole('heading', { name: en.checkout.cartTitle })).toBeInTheDocument();
    expect(line(poster).getByRole('heading', { name: 'Poster' })).toBeInTheDocument();
    expect(line(poster).getByText(exact(en.checkout.cartUnitPrice({ price: pln(3500) })))).toBeInTheDocument();
    expect(line(poster).getByTestId(`cart-quantity-${poster}`)).toHaveTextContent('2');
    expect(line(poster).getByTestId(`cart-line-total-${poster}`)).toHaveTextContent(exact(pln(7000)));
    expect(line(ebook).getByRole('heading', { name: 'E-book' })).toBeInTheDocument();
    expect(line(ebook).queryByTestId(`cart-quantity-${ebook}`)).not.toBeInTheDocument();
    expect(summaryAmount('products')).toHaveTextContent(exact(pln(9500)));
    expect(screen.getByText(en.productSafety.offerHeadingFor({ title: 'Poster' }))).toBeInTheDocument();
    expect(screen.getAllByText('Send me news')).toHaveLength(1);

    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('button', { name: en.checkout.invoiceReveal }));
    await userEvent.type(screen.getByLabelText(en.checkout.companyNameLabel), 'Buyer Ltd');
    await userEvent.type(screen.getByLabelText(en.checkout.addressLabel), 'Main Street 2');
    await userEvent.type(screen.getByLabelText(en.checkout.postalCodeLabel), '00-001');
    await userEvent.type(screen.getByLabelText(en.checkout.cityLabel), 'Warsaw');
    await userEvent.click(screen.getByRole('checkbox', { name: /Send me news/u }));
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled();
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    expect(summaryAmount('delivery')).toHaveTextContent(exact(pln(1999)));
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.payIdle({ price: pln(11499) })));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      lines: [{ productId: poster, quantity: 2 }, { productId: ebook, quantity: 1 }],
      attribution: { utmSource: 'meta' },
      email: 'buyer@example.org',
      language: 'en',
      marketingConsentDefinitionIds: ['news'],
      termsAccepted: true,
      billing: { nip: null, companyName: 'Buyer Ltd', address: 'Main Street 2', postalCode: '00-001', city: 'Warsaw', country: 'PL' },
      shipping: { rateId: 'courier' },
    });
  });

  it('keeps each stepper within the line limits and posts the changed quantities', async () => {
    const bodies: unknown[] = [];
    serve({ onSession: (body) => bodies.push(body) });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.9~${ebook}.1`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });

    const increasePoster = line(poster).getByRole('button', { name: en.checkout.cartIncrease({ title: 'Poster' }) });
    await userEvent.click(increasePoster);
    expect(line(poster).getByTestId(`cart-quantity-${poster}`)).toHaveTextContent('10');
    expect(increasePoster).toBeDisabled();
    expect(line(poster).getByText(en.checkout.cartQuantityLimit({ max: 10 }))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: en.checkout.cartRemove({ title: 'E-book' }) }));
    expect(screen.queryByTestId(`cart-line-${ebook}`)).not.toBeInTheDocument();
    for (let step = 0; step < 9; step += 1) {
      await userEvent.click(line(poster).getByRole('button', { name: en.checkout.cartDecrease({ title: 'Poster' }) }));
    }
    expect(line(poster).getByTestId(`cart-quantity-${poster}`)).toHaveTextContent('1');
    expect(line(poster).getByRole('button', { name: en.checkout.cartDecrease({ title: 'Poster' }) })).toBeDisabled();
    await userEvent.click(line(poster).getByRole('button', { name: en.checkout.cartIncrease({ title: 'Poster' }) }));

    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ lines: [{ productId: poster, quantity: 2 }] });
  });

  it('finds the products of upper-case IDs and posts the lower-case IDs the platform issues', async () => {
    const bodies: unknown[] = [];
    const requests: string[] = [];
    serve({ requests, onSession: (body) => bodies.push(body) });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster.toUpperCase()}.1~${ebook.toUpperCase()}.1`);
    expect(await screen.findByRole('heading', { name: en.checkout.cartTitle })).toBeInTheDocument();
    expect(line(poster).getByRole('heading', { name: 'Poster' })).toBeInTheDocument();
    expect(line(ebook).getByRole('heading', { name: 'E-book' })).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.cartProductMissing)).not.toBeInTheDocument();
    expect(requests).toContain(`GET /api/public/offer?productRef=${poster}`);

    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ lines: [{ productId: poster, quantity: 1 }, { productId: ebook, quantity: 1 }] });
  });

  it('caps a quantity above the line limit at the limit', async () => {
    serve();
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.25~${ebook}.3`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(line(poster).getByTestId(`cart-quantity-${poster}`)).toHaveTextContent('10');
    expect(line(ebook).queryByTestId(`cart-quantity-${ebook}`)).not.toBeInTheDocument();
    expect(summaryAmount('products')).toHaveTextContent(exact(pln(37500)));
  });

  it('sums the cart in one summary right above the pay button, the total last', async () => {
    serve();
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.2~${ebook}.1`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(summaryRows()).toEqual([
      `${en.checkout.breakdownProducts} ${pln(9500)}`,
      `${en.checkout.breakdownDelivery} ${en.checkout.cartDeliveryNotChosen}`,
      `${en.checkout.breakdownTotal} ${pln(9500)}`,
    ]);
    expect(screen.getByTestId('cart-summary').nextElementSibling).toBe(screen.getByTestId('checkout-pay-cta'));
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    expect(summaryRows()).toEqual([
      `${en.checkout.breakdownProducts} ${pln(9500)}`,
      `${en.checkout.breakdownDelivery} ${pln(1999)}`,
      `${en.checkout.breakdownTotal} ${pln(11499)}`,
    ]);
    expect(summaryAmount('total')).toHaveTextContent(exact(pln(11499)));
  });

  it('shows no delivery row for a cart that ships nothing', async () => {
    serve();
    renderCart(`${HOSTED_CART_PATH}?lines=${ebook}.1`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(summaryRows()).toEqual([
      `${en.checkout.breakdownProducts} ${pln(2500)}`,
      `${en.checkout.breakdownTotal} ${pln(2500)}`,
    ]);
  });

  it('caps a stepper at the pieces left, says the quantity was lowered, and drops that once the buyer changes it', async () => {
    serve({ overrides: { [poster]: lowStock(2) } });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.5`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(line(poster).getByTestId(`cart-quantity-${poster}`)).toHaveTextContent('2');
    expect(line(poster).getByRole('button', { name: en.checkout.cartIncrease({ title: 'Poster' }) })).toBeDisabled();
    expect(line(poster).getByText(exact(en.checkout.cartStockLowered({ count: 2 })))).toBeInTheDocument();
    expect(line(poster).queryByText(en.checkout.cartQuantityLimit({ max: 10 }))).not.toBeInTheDocument();
    await userEvent.click(line(poster).getByRole('button', { name: en.checkout.cartDecrease({ title: 'Poster' }) }));
    expect(line(poster).getByTestId(`cart-quantity-${poster}`)).toHaveTextContent('1');
    expect(line(poster).getByRole('button', { name: en.checkout.cartIncrease({ title: 'Poster' }) })).toBeEnabled();
    expect(line(poster).getByText(exact(en.checkout.cartStockLimit({ count: 2 })))).toBeInTheDocument();
    expect(line(poster).queryByText(en.checkout.cartStockLowered({ count: 2 }))).not.toBeInTheDocument();
  });

  it('says how many are left without a lowered quantity when the link asks for no more than the stock', async () => {
    serve({ overrides: { [poster]: lowStock(2) } });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.2`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(line(poster).getByText(exact(en.checkout.cartStockLimit({ count: 2 })))).toBeInTheDocument();
  });

  it.each([
    ['one piece asked', 1, en.checkout.cartStockLimit({ count: 1 })],
    ['three pieces asked', 3, en.checkout.cartStockLowered({ count: 1 })],
  ])('keeps the stock note on a line with one piece left and %s, with no stepper', async (_case, asked, note) => {
    serve({ overrides: { [poster]: lowStock(1) } });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.${String(asked)}`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(line(poster).queryByRole('button', { name: en.checkout.cartIncrease({ title: 'Poster' }) })).not.toBeInTheDocument();
    expect(line(poster).getByText(exact(note))).toBeInTheDocument();
    expect(line(poster).getByTestId(`cart-line-total-${poster}`)).toHaveTextContent(exact(pln(3500)));
    expect(line(poster).getByRole('button', { name: en.checkout.cartRemove({ title: 'Poster' }) })).toBeEnabled();
  });

  it('keeps the order limit note while the stock is not the cap', async () => {
    serve({ overrides: { [poster]: { ...lowStock(12), maxQuantity: 10 } } });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(line(poster).getByText(exact(en.checkout.cartQuantityLimit({ max: 10 })))).toBeInTheDocument();
    expect(line(poster).queryByText(en.checkout.cartStockLimit({ count: 12 }))).not.toBeInTheDocument();
  });

  it('shows no stepper and no limit note for a product type sold one per order, only Remove', async () => {
    serve();
    renderCart(`${HOSTED_CART_PATH}?lines=${ebook}.1`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(line(ebook).queryByRole('button', { name: en.checkout.cartIncrease({ title: 'E-book' }) })).not.toBeInTheDocument();
    expect(line(ebook).queryByRole('button', { name: en.checkout.cartDecrease({ title: 'E-book' }) })).not.toBeInTheDocument();
    expect(line(ebook).queryByText(en.checkout.cartQuantityLimit({ max: 1 }))).not.toBeInTheDocument();
    expect(line(ebook).queryByText(en.checkout.cartStockLimit({ count: 1 }))).not.toBeInTheDocument();
    expect(line(ebook).getByRole('button', { name: en.checkout.cartRemove({ title: 'E-book' }) })).toBeEnabled();
  });

  it('turns a sold-out line into an alert with Remove and keeps the amount on the disabled pay button with its reason', async () => {
    const bodies: unknown[] = [];
    serve({ overrides: { [poster]: soldOutStock }, onSession: (body) => bodies.push(body) });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.2~${ebook}.1`);
    const soldOutLine = await screen.findByTestId(`cart-line-${poster}`);
    expect(soldOutLine).toHaveAttribute('role', 'alert');
    expect(soldOutLine).toHaveTextContent(`Poster: ${en.checkout.cartLineSoldOut}`);
    expect(within(soldOutLine).queryByRole('button', { name: en.checkout.cartIncrease({ title: 'Poster' }) })).not.toBeInTheDocument();
    const pay = screen.getByTestId('checkout-pay-cta');
    expect(pay).toBeDisabled();
    expect(pay).toHaveTextContent(exact(en.checkout.payIdle({ price: pln(2500) })));
    expect(pay).toHaveAccessibleDescription(en.checkout.cartPayBlockedLines);

    await userEvent.click(within(soldOutLine).getByRole('button', { name: en.checkout.cartRemove({ title: 'Poster' }) }));
    expect(screen.queryByTestId(`cart-line-${poster}`)).not.toBeInTheDocument();
    expect(screen.queryByText(en.checkout.cartPayBlockedLines)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ lines: [{ productId: ebook, quantity: 1 }] });
  });

  it('refetches the offers on a sold-out refusal and names the product from the refusal', async () => {
    const requests: string[] = [];
    serve({
      requests,
      sessionRefusal: { status: 409, error: { code: 'sold_out', message: '"Poster" is sold out', details: { productId: poster } } },
    });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.2~${ebook}.1`);
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    const offerReads = (productId: string) => requests.filter((request) => request === `GET /api/public/offer?productRef=${productId}`).length;
    expect(offerReads(poster)).toBe(1);
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));

    expect(await screen.findByText(en.checkout.cartStockRefusal({ title: 'Poster' }))).toBeInTheDocument();
    await waitFor(() => expect(offerReads(poster)).toBe(2));
    expect(offerReads(ebook)).toBe(2);
    expect(screen.queryByText(en.errors.messageSoldOut)).not.toBeInTheDocument();
  });

  it('drops a hand-typed discount once a stock reload changes the lines it was checked for', async () => {
    const overrides: Record<string, Record<string, unknown>> = { [poster]: lowStock(3) };
    serve({
      overrides,
      onSession: () => { overrides[poster] = lowStock(1); },
      sessionRefusal: { status: 409, error: { code: 'sold_out', message: '"Poster" is sold out', details: { productId: poster } } },
    });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.2~${ebook}.1`);
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    await userEvent.click(screen.getByTestId('checkout-coupon-reveal'));
    await userEvent.type(screen.getByTestId('checkout-coupon-input'), 'CART');
    await userEvent.click(screen.getByTestId('checkout-coupon-apply'));
    expect(await screen.findByTestId('cart-summary-discount')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.payIdle({ price: pln(10549) })));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));

    expect(await screen.findByText(en.checkout.cartStockRefusal({ title: 'Poster' }))).toBeInTheDocument();
    await waitFor(() => expect(line(poster).getByTestId(`cart-line-total-${poster}`)).toHaveTextContent(exact(pln(3500))));
    expect(screen.queryByTestId('cart-summary-discount')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-coupon-breakdown')).not.toBeInTheDocument();
    expect(summaryAmount('products')).toHaveTextContent(exact(pln(6000)));
    expect(summaryAmount('total')).toHaveTextContent(exact(pln(7999)));
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.payIdle({ price: pln(7999) })));
  });

  it.each([
    ['no lines parameter', HOSTED_CART_PATH],
    ['an empty lines parameter', `${HOSTED_CART_PATH}?lines=`],
    ['a product reference that is not a UUID', `${HOSTED_CART_PATH}?lines=poster.1`],
    ['a zero quantity', `${HOSTED_CART_PATH}?lines=${poster}.0`],
    ['a duplicate product', `${HOSTED_CART_PATH}?lines=${poster}.1~${poster}.2`],
    ['a duplicate product that differs only in case', `${HOSTED_CART_PATH}?lines=${poster}.1~${poster.toUpperCase()}.2`],
  ])('shows an error and sends no request for %s', async (_case, path) => {
    const requests: string[] = [];
    serve({ requests });
    renderCart(path);
    expect(await screen.findByRole('heading', { level: 1, name: en.checkout.cartInvalidTitle })).toBeInTheDocument();
    expect(screen.getByText(en.checkout.cartInvalidBody)).toBeInTheDocument();
    expect(screen.getByText(en.checkout.cartInvalidBody).closest('.MuiPaper-elevation1')).toBeNull();
    await act(() => new Promise((resolve) => { setTimeout(resolve, 50); }));
    expect(requests.filter((request) => request !== 'GET /api/public/offer')).toEqual([]);
  });

  it('shows the empty cart as the page heading on the card, with no card inside it', async () => {
    serve();
    renderCart(`${HOSTED_CART_PATH}?lines=${ebook}.1`);
    await userEvent.click(await screen.findByRole('button', { name: en.checkout.cartRemove({ title: 'E-book' }) }));
    expect(screen.getByRole('heading', { level: 1, name: en.checkout.cartEmptyTitle })).toBeInTheDocument();
    expect(screen.getByText(en.checkout.cartEmptyBody).closest('.MuiPaper-elevation1')).toBeNull();
  });

  it('asks to remove a product that is no longer available before paying', async () => {
    serve({ missing: [ebook] });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1~${ebook}.1`);
    expect(await screen.findByText(en.checkout.cartProductMissing)).toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled();
    await userEvent.click(within(screen.getByTestId(`cart-line-${ebook}`)).getByRole('button', { name: en.checkout.cartRemoveLine }));
    expect(screen.queryByText(en.checkout.cartProductMissing)).not.toBeInTheDocument();
    expect(summaryAmount('products')).toHaveTextContent(exact(pln(3500)));
  });

  it('takes the single one-time price of a product that also has a recurring price, as the server does', async () => {
    const bodies: unknown[] = [];
    serve({ onSession: (body) => bodies.push(body) });
    renderCart(`${HOSTED_CART_PATH}?lines=${journal}.1~${ebook}.1`);
    expect(await screen.findByRole('heading', { name: en.checkout.cartTitle })).toBeInTheDocument();
    expect(line(journal).getByText(exact(en.checkout.cartUnitPrice({ price: pln(4000) })))).toBeInTheDocument();
    expect(screen.queryByText(`Journal: ${en.checkout.cartLineUnavailable}`)).not.toBeInTheDocument();
    expect(summaryAmount('products')).toHaveTextContent(exact(pln(6500)));

    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ lines: [{ productId: journal, quantity: 1 }, { productId: ebook, quantity: 1 }] });
  });

  it('refuses a product with two one-time prices, as the server does', async () => {
    serve();
    renderCart(`${HOSTED_CART_PATH}?lines=${bag}.1~${ebook}.1`);
    expect(await screen.findByText(`Bag: ${en.checkout.cartLineUnavailable}`)).toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled();
    expect(line(bag).getByRole('button', { name: en.checkout.cartRemove({ title: 'Bag' }) })).toBeEnabled();
  });

  it('refuses a cart in two currencies as the server does, with no total, payment or coupon check', async () => {
    const requests: string[] = [];
    serve({ requests });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1~${mug}.2&code=CART`);
    expect(await screen.findByTestId('cart-currency-refusal')).toHaveTextContent(exact(en.checkout.cartCurrencyMismatch));
    expect(line(mug).getByTestId(`cart-line-total-${mug}`)).toHaveTextContent(exact(eur(2400)));
    expect(screen.queryByTestId('cart-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-coupon-reveal')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled();
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.cartPay));

    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    await act(() => new Promise((resolve) => { setTimeout(resolve, 400); }));
    expect(requests.filter((request) => request.startsWith('POST'))).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: en.checkout.cartRemove({ title: 'Mug' }) }));
    expect(screen.queryByTestId('cart-currency-refusal')).not.toBeInTheDocument();
    expect(summaryAmount('products')).toHaveTextContent(exact(pln(3500)));
    await waitFor(() => expect(requests).toContain('POST /api/public/checkout/coupon'));
  });

  it('prices a cart in the currency of its products', async () => {
    serve();
    renderCart(`${HOSTED_CART_PATH}?lines=${mug}.1`);
    expect(await screen.findByTestId('cart-summary-products')).toHaveTextContent(exact(`${en.checkout.breakdownProducts}${eur(1200)}`));
    expect(screen.getByLabelText(exact(`Courier — ${eur(1999)}`))).toBeInTheDocument();
  });

  it('shows no amount while no line has a price', async () => {
    serve({ missing: [poster] });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1`);
    expect(await screen.findByText(en.checkout.cartProductMissing)).toBeInTheDocument();
    expect(screen.queryByTestId('cart-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.cartPay));
    expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled();
  });

  it('shows the server\'s currency refusal in the buyer\'s language', async () => {
    serve({ sessionError: CART_CURRENCY_MISMATCH_MESSAGE });
    renderCart(`${HOSTED_CART_PATH}?lines=${ebook}.1`);
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    expect(await screen.findByText(en.checkout.cartCurrencyMismatch)).toBeInTheDocument();
  });

  it('checks a coupon with the lines, the email and the code only', async () => {
    const coupons: unknown[] = [];
    const bodies: unknown[] = [];
    serve({ onCoupon: (body) => coupons.push(body), onSession: (body) => bodies.push(body) });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.2~${ebook}.1`);
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByTestId('checkout-coupon-reveal'));
    await userEvent.type(screen.getByTestId('checkout-coupon-input'), 'CART');
    await userEvent.click(screen.getByTestId('checkout-coupon-apply'));
    const panel = within(await screen.findByTestId('checkout-coupon-breakdown'));
    expect(panel.getByText(exact(en.checkout.couponDiscount({ price: pln(950) })))).toBeInTheDocument();
    expect(panel.getByText(exact(en.checkout.omnibusLowest({ price: pln(9500) })))).toBeInTheDocument();
    expect(panel.queryByText(en.checkout.couponOriginal({ price: pln(9500) }))).not.toBeInTheDocument();
    expect(panel.queryByTestId('checkout-coupon-final')).not.toBeInTheDocument();
    expect(coupons).toEqual([{ lines: [{ productId: poster, quantity: 2 }, { productId: ebook, quantity: 1 }], email: 'buyer@example.org', couponCode: 'CART' }]);

    await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    expect(screen.getByTestId('checkout-pay-cta')).toHaveTextContent(exact(en.checkout.payIdle({ price: pln(10549) })));
    expect(summaryRows()).toEqual([
      `${en.checkout.breakdownProducts} ${pln(9500)}`,
      `${en.checkout.breakdownDiscount} −${pln(950)}`,
      `${en.checkout.breakdownDelivery} ${pln(1999)}`,
      `${en.checkout.breakdownTotal} ${pln(10549)}`,
    ]);
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ couponCode: 'CART' });

    await userEvent.click(line(poster).getByRole('button', { name: en.checkout.cartIncrease({ title: 'Poster' }) }));
    expect(screen.queryByTestId('checkout-coupon-breakdown')).not.toBeInTheDocument();
  });

  it('loads no analytics vendor on the cart form even when the workspace configured analytics', async () => {
    serve({ token: 'public-map-token' });
    renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1`);
    await screen.findByRole('heading', { name: en.checkout.cartTitle });
    expect(analytics.loadGoogleTag).not.toHaveBeenCalled();
    expect(analytics.loadMetaPixel).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="googletagmanager"], script[src*="facebook"]')).toBeNull();
  });

  it('shows the shared success document on the cart success return', async () => {
    serve();
    server.use(http.get('/api/public/checkout/session-status', () => HttpResponse.json({ ok: true, data: { status: 'pending' } })));
    renderCart(`${HOSTED_CART_PATH}?status=success&purchase_kind=one_time&session_id=cs_live_one`);
    expect(await screen.findByRole('heading', { name: en.checkout.successPendingTitle })).toBeInTheDocument();
    await waitFor(() => expect(analytics.loadGoogleTag).toHaveBeenCalledExactlyOnceWith(analyticsConfig));
  });

  it('offers the same cart again after a cancelled payment', async () => {
    serve();
    renderCart(`${HOSTED_CART_PATH}?status=cancelled&lines=${poster}.2~${ebook}.1&code=CART&utm_source=meta`);
    expect(await screen.findByRole('heading', { name: en.checkout.cancelledTitle })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.checkout.retry }));
    expect(await screen.findByRole('heading', { name: en.checkout.cartTitle })).toBeInTheDocument();
    expect(line(poster).getByTestId(`cart-quantity-${poster}`)).toHaveTextContent('2');
    expect(window.location.search).toBe(`?lines=${poster}.2~${ebook}.1&utm_source=meta&code=CART`);
    expect(screen.getByTestId('checkout-coupon-input')).toHaveValue('CART');
    expect(analytics.loadGoogleTag).not.toHaveBeenCalled();
  });

  describe('address', () => {
    it.each(['/checkout/cart', `/checkout/cart?lines=${poster}.1`])('keeps %s an ordinary single-product checkout for the product whose slug is "cart"', async (path) => {
      const requests: string[] = [];
      serve({ requests });
      renderCheckoutRoutes(path);
      expect(await screen.findByText('Cart Organizer')).toBeInTheDocument();
      expect(requests).toContain('GET /api/public/offer?productRef=cart');
      expect(screen.queryByRole('heading', { name: en.checkout.cartTitle })).not.toBeInTheDocument();
      expect(screen.queryByTestId(`cart-line-${poster}`)).not.toBeInTheDocument();
    });

    it('serves the hosted cart only at an address no single product reference can take', async () => {
      expect(HOSTED_CART_PATH.split('/').filter((segment) => segment !== '')).toHaveLength(3);
      serve();
      renderCheckoutRoutes(`${HOSTED_CART_PATH}?lines=${poster}.1~${ebook}.1`);
      expect(await screen.findByRole('heading', { name: en.checkout.cartTitle })).toBeInTheDocument();
      expect(await screen.findByTestId(`cart-line-${poster}`)).toBeInTheDocument();
    });
  });

  describe('parcel locker map', () => {
    it('loads the map only with a token, after the locker option is chosen and the picker is opened, in live mode, for a buyer', async () => {
      serve({ token: 'public-map-token' });
      renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1`);
      await userEvent.click(await screen.findByLabelText(exact(`Courier — ${pln(1999)}`)));
      expect(document.getElementById('inpost-geowidget-script')).toBeNull();
      await userEvent.click(screen.getByRole('radio', { name: lockerOption }));
      expect(document.getElementById('inpost-geowidget-script')).toBeNull();
      expect(document.querySelector('inpost-geowidget')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: en.shipping.lockerChoose }));
      expect(await screen.findByTestId('checkout-inpost-geowidget')).toBeInTheDocument();
      expect(document.getElementById('inpost-geowidget-script')).toHaveAttribute('src', 'https://geowidget.inpost.pl/inpost-geowidget.js');
      expect(document.getElementById('inpost-geowidget-style')).toHaveAttribute('href', 'https://geowidget.inpost.pl/inpost-geowidget.css');
    });

    it('leaves the cart by a document navigation once the map was loaded', async () => {
      serve({ token: 'public-map-token' });
      window.history.replaceState(null, '', `${HOSTED_CART_PATH}?lines=${poster}.1`);
      const location = window.location;
      const assign = vi.fn();
      vi.spyOn(window, 'location', 'get').mockImplementation(() => ({ ...location, assign }));
      vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
      const history = createBrowserHistory();
      const root = createRootRoute({ component: Outlet });
      const cart = createRoute({ getParentRoute: () => root, path: HOSTED_CART_PATH, component: CartCheckoutPage });
      const login = createRoute({ getParentRoute: () => root, path: '/login', component: () => <p>Sign-in view</p> });
      const router = createRouter({ routeTree: root.addChildren([cart, login]), history });
      try {
        renderWithProviders(<RouterProvider router={router} />);
        await userEvent.click(await screen.findByRole('radio', { name: lockerOption }));
        await userEvent.click(screen.getByRole('button', { name: en.shipping.lockerChoose }));
        await screen.findByTestId('checkout-inpost-geowidget');
        act(() => { void router.navigate({ to: '/login' }); });
        await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith('/login'));
        expect(router.state.location.pathname).toBe(HOSTED_CART_PATH);
        expect(screen.queryByText('Sign-in view')).not.toBeInTheDocument();
      } finally {
        history.destroy();
        vi.restoreAllMocks();
      }
    });

    it('places the locker block right after the locker option, before the next option, also once a locker is chosen', async () => {
      serve({ token: 'public-map-token' });
      renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1`);
      await userEvent.click(await screen.findByRole('radio', { name: lockerOption }));
      const option = screen.getByTestId('checkout-delivery-option-locker');
      const block = screen.getByTestId('checkout-locker-picker');
      expect(option.nextElementSibling).toBe(block);
      expect(block.nextElementSibling).toBe(screen.getByTestId('checkout-delivery-option-courier'));
      expect(within(block).getByRole('button', { name: en.shipping.lockerChoose })).toBeVisible();
      expect(within(block).getByRole('button', { name: en.shipping.lockerKnowCode })).toBeVisible();

      await userEvent.click(within(block).getByRole('button', { name: en.shipping.lockerChoose }));
      const dialog = await screen.findByRole('dialog', { name: en.shipping.lockerChoose });
      const widget = dialog.querySelector('inpost-geowidget');
      act(() => {
        document.dispatchEvent(new CustomEvent(widget?.getAttribute('onpoint') ?? '', { detail: { name: 'KRA010', location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } } }));
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      const chosen = screen.getByTestId('checkout-locker-picker');
      expect(option.nextElementSibling).toBe(chosen);
      expect(within(chosen).getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010 · Next to the shop');
      expect(within(chosen).getByRole('button', { name: en.shipping.lockerKnowCode })).toBeVisible();

      await userEvent.click(screen.getByRole('radio', { name: exact(`Courier — ${pln(1999)}`) }));
      expect(screen.queryByTestId('checkout-locker-picker')).not.toBeInTheDocument();
    });

    it('chooses a locker in the same full-screen picker and sends its name and address', async () => {
      const bodies: unknown[] = [];
      serve({ token: 'public-map-token', onSession: (body) => bodies.push(body) });
      renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1`);
      await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
      await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
      await userEvent.click(screen.getByRole('radio', { name: lockerOption }));
      await userEvent.click(screen.getByRole('button', { name: en.shipping.lockerChoose }));
      const dialog = await screen.findByRole('dialog', { name: en.shipping.lockerChoose });
      const widget = dialog.querySelector('inpost-geowidget');
      act(() => {
        document.dispatchEvent(new CustomEvent(widget?.getAttribute('onpoint') ?? '', { detail: { name: 'KRA010', location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } } }));
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010 · Next to the shop');
      await userEvent.click(screen.getByTestId('checkout-pay-cta'));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, 30-001 Cracow' } } });
    });

    it.each([
      { viewer: 'without a workspace token', token: null, canTest: false, testEnabled: false },
      { viewer: 'for a staff session in live mode', token: 'public-map-token', canTest: true, testEnabled: false },
      { viewer: 'for a staff session in test mode', token: 'public-map-token', canTest: true, testEnabled: true },
      { viewer: 'in test mode without a staff session', token: 'public-map-token', canTest: false, testEnabled: true },
    ])('never loads the map $viewer and takes the typed locker code', async ({ token, canTest, testEnabled }) => {
      const bodies: unknown[] = [];
      serve({ token, canTest, testEnabled, onSession: (body) => bodies.push(body) });
      renderCart(`${HOSTED_CART_PATH}?lines=${poster}.1`);
      await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
      await userEvent.click(screen.getByRole('checkbox', { name: /terms/iu }));
      await userEvent.click(screen.getByRole('radio', { name: lockerOption }));
      expect(await screen.findByLabelText(en.shipping.lockerCodeLabel)).toBeInTheDocument();
      expect(screen.queryByTestId('checkout-inpost-geowidget')).not.toBeInTheDocument();
      expect(document.querySelector('inpost-geowidget')).toBeNull();
      expect(document.getElementById('inpost-geowidget-script')).toBeNull();
      expect(document.getElementById('inpost-geowidget-style')).toBeNull();
      await userEvent.type(screen.getByLabelText(en.shipping.lockerCodeLabel), 'waw01m');
      await userEvent.click(screen.getByTestId('checkout-pay-cta'));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
    });
  });
});
