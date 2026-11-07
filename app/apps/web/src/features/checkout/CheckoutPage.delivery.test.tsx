import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBrowserHistory, createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FREE_ORDER_DELIVERY_UNAVAILABLE } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { formatPrice } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const pln = (cents: number) => formatPrice(cents, 'PLN', 'en');
const lockerOption = new RegExp(`^Parcel locker — ${pln(1499).replace('.', '\\.')}`, 'u');
const exact = (value: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')}$`, 'u');

const offer = (deliveryMethod: 'pickup' | 'shipping') => ({
  tenant: { slug: 'acme', name: 'Acme School' },
  contentVersion: 1,
  products: [{
    id: 'accessory', type: 'physical', deliveryMethod, slug: 'accessory', title: 'Printed accessory', description: 'A small part.',
    coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [],
  }],
});

const shippingRates = [
  { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker', deliveryEstimateDays: { min: 1, max: 2 } },
  { id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'other', pickupPoint: 'none' },
];

const serve = (input: {
  deliveryMethod?: 'pickup' | 'shipping';
  token?: string | null;
  canTest?: boolean;
  testEnabled?: boolean;
  onSession?: (body: unknown) => void;
  sessionError?: string;
}) => {
  server.use(
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offer(input.deliveryMethod ?? 'shipping') })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: true, simulatedPaymentsEnabled: false, shippingRates, inpostGeowidgetToken: input.token ?? null,
      canTest: input.canTest ?? false, testConfigured: input.canTest === true || input.testEnabled === true, testEnabled: input.testEnabled ?? false,
    } })),
    http.post('/api/public/checkout/session', async ({ request }) => {
      input.onSession?.(await request.json());
      return HttpResponse.json({ ok: false, error: { code: 'validation', message: input.sessionError ?? 'Stop before redirect' } }, { status: 400 });
    }),
  );
};

const renderCheckout = () => {
  const root = createRootRoute({ component: () => <CheckoutPage productRef="accessory" /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/checkout/accessory'] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('checkout delivery step', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/accessory');
  });
  afterEach(() => {
    document.getElementById('inpost-geowidget-script')?.remove();
    document.getElementById('inpost-geowidget-style')?.remove();
  });

  it('keeps the pay button disabled until a rate and a valid locker code are chosen, then sends the delivery selection', async () => {
    const bodies: unknown[] = [];
    serve({ onSession: (body) => bodies.push(body) });
    renderCheckout();

    expect(await screen.findByText(en.shipping.deliveryHeading)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    const payButton = () => screen.getByTestId('checkout-pay-cta');
    expect(payButton()).toBeDisabled();
    expect(screen.getByText(en.shipping.deliveryEstimate({ min: 1, max: 2 }))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^Parcel locker — ${pln(1499).replace('.', '\\.')}`, 'u') }));
    expect(payButton()).toBeDisabled();
    const code = screen.getByLabelText(en.shipping.lockerCodeLabel);
    await userEvent.type(code, 'waw-1');
    expect(code).toHaveValue('WAW-1');
    expect(screen.getByText(en.shipping.lockerCodeInvalid)).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
    await userEvent.clear(code);
    await userEvent.type(code, 'waw01m');
    expect(payButton()).toBeEnabled();
    expect(payButton()).toHaveTextContent(exact(en.checkout.payIdle({ price: pln(6399) })));
    expect(screen.queryByTestId('checkout-inpost-geowidget')).not.toBeInTheDocument();

    await userEvent.click(payButton());
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ productId: 'accessory', shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
  });

  it('hides the locker input for a courier rate and sends only the rate', async () => {
    const bodies: unknown[] = [];
    serve({ onSession: (body) => bodies.push(body) });
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    expect(screen.queryByLabelText(en.shipping.lockerCodeLabel)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ shipping: { rateId: 'courier' } });
    expect(bodies[0]).not.toHaveProperty('shipping.pickupPoint');
  });

  it('loads the parcel locker map on demand and fills the code from the chosen point', async () => {
    serve({ token: 'public-map-token' });
    renderCheckout();
    await userEvent.click(await screen.findByRole('radio', { name: new RegExp(`^Parcel locker — ${pln(1499).replace('.', '\\.')}`, 'u') }));
    const host = await screen.findByTestId('checkout-inpost-geowidget');
    const widget = host.querySelector('inpost-geowidget');
    expect(widget).toHaveAttribute('token', 'public-map-token');
    expect(widget).toHaveAttribute('language', 'en');
    expect(widget).toHaveAttribute('config', 'parcelCollect');
    const eventName = widget?.getAttribute('onpoint') ?? '';
    expect(document.getElementById('inpost-geowidget-script')).toHaveAttribute('src', 'https://geowidget.inpost.pl/inpost-geowidget.js');
    expect(document.getElementById('inpost-geowidget-style')).toHaveAttribute('href', 'https://geowidget.inpost.pl/inpost-geowidget.css');

    document.dispatchEvent(new CustomEvent(eventName, { detail: { name: 'KRA010', location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } } }));
    expect(await screen.findByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010 · Next to the shop · Main Street 1, 30-001 Cracow');
    expect(screen.getByLabelText(en.shipping.lockerCodeLabel)).toHaveValue('KRA010');
  });

  it('loads the parcel locker map for a buyer only after the locker option is chosen', async () => {
    serve({ token: 'public-map-token' });
    renderCheckout();
    await userEvent.click(await screen.findByLabelText(exact(`Courier — ${pln(1999)}`)));
    expect(screen.queryByTestId('checkout-inpost-geowidget')).not.toBeInTheDocument();
    expect(document.getElementById('inpost-geowidget-script')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: lockerOption }));
    expect(await screen.findByTestId('checkout-inpost-geowidget')).toBeInTheDocument();
    expect(document.getElementById('inpost-geowidget-script')).toHaveAttribute('src', 'https://geowidget.inpost.pl/inpost-geowidget.js');
    expect(screen.queryByTestId('checkout-locker-map-staff-hint')).not.toBeInTheDocument();
  });

  it.each([
    { viewer: 'a staff session in live mode', canTest: true, testEnabled: false },
    { viewer: 'a staff session in test mode', canTest: true, testEnabled: true },
    { viewer: 'test mode without a staff session', canTest: false, testEnabled: true },
  ])('never loads the parcel locker map for $viewer and asks for the locker code', async ({ canTest, testEnabled }) => {
    const bodies: unknown[] = [];
    serve({ token: 'public-map-token', canTest, testEnabled, onSession: (body) => bodies.push(body) });
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('radio', { name: lockerOption }));
    expect(await screen.findByTestId('checkout-locker-map-staff-hint')).toHaveTextContent(exact(en.shipping.lockerMapStaffHint));
    expect(screen.queryByTestId('checkout-inpost-geowidget')).not.toBeInTheDocument();
    expect(document.querySelector('inpost-geowidget')).toBeNull();
    expect(document.getElementById('inpost-geowidget-script')).toBeNull();
    expect(document.getElementById('inpost-geowidget-style')).toBeNull();
    await userEvent.type(screen.getByLabelText(en.shipping.lockerCodeLabel), 'waw01m');
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
  });

  it('never loads the parcel locker map without a workspace token', async () => {
    serve({ token: null });
    renderCheckout();
    await userEvent.click(await screen.findByRole('radio', { name: lockerOption }));
    expect(await screen.findByLabelText(en.shipping.lockerCodeLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-inpost-geowidget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-locker-map-staff-hint')).not.toBeInTheDocument();
    expect(document.getElementById('inpost-geowidget-script')).toBeNull();
    expect(document.getElementById('inpost-geowidget-style')).toBeNull();
  });

  it('leaves the form by a document navigation once the parcel locker map was loaded', async () => {
    serve({ token: 'public-map-token' });
    const location = window.location;
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockImplementation(() => ({ ...location, assign }));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const history = createBrowserHistory();
    const root = createRootRoute({ component: Outlet });
    const checkout = createRoute({ getParentRoute: () => root, path: '/checkout/$ref', component: () => <CheckoutPage productRef="accessory" /> });
    const login = createRoute({ getParentRoute: () => root, path: '/login', component: () => <p>Sign-in view</p> });
    const router = createRouter({ routeTree: root.addChildren([checkout, login]), history });
    try {
      renderWithProviders(<RouterProvider router={router} />);
      await userEvent.click(await screen.findByRole('radio', { name: new RegExp(`^Parcel locker — ${pln(1499).replace('.', '\\.')}`, 'u') }));
      await screen.findByTestId('checkout-inpost-geowidget');
      await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
      expect(screen.queryByTestId('checkout-inpost-geowidget')).not.toBeInTheDocument();
      act(() => { void router.navigate({ to: '/login' }); });
      await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith('/login'));
      expect(router.state.location.pathname).toBe('/checkout/accessory');
      expect(screen.queryByText('Sign-in view')).not.toBeInTheDocument();
    } finally {
      history.destroy();
      vi.restoreAllMocks();
    }
  });

  it('explains that a free order cannot be delivered when the server refuses it', async () => {
    serve({ sessionError: FREE_ORDER_DELIVERY_UNAVAILABLE });
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByLabelText(exact(`Courier — ${pln(1999)}`)));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    expect(await screen.findByText(en.shipping.freeOrderUnavailable)).toBeInTheDocument();
    expect(en.shipping.freeOrderUnavailable).toBe('Delivery is not available for free orders');
    expect(screen.queryByText(en.errors.messageValidation)).not.toBeInTheDocument();
  });

  it('shows no delivery step for products collected in person', async () => {
    serve({ deliveryMethod: 'pickup' });
    renderCheckout();
    expect(await screen.findByRole('heading', { name: 'Printed accessory' })).toBeInTheDocument();
    expect(screen.queryByText(en.shipping.deliveryHeading)).not.toBeInTheDocument();
  });
});
