import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBrowserHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from '@mui/material';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/en.js';
import { formatPrice } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { createThemeForMode } from '../../theme.js';
import { anonymousMe, server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const pln = (cents: number) => formatPrice(cents, 'PLN', 'en');
const lockerOption = new RegExp(`^Parcel locker — ${pln(1499).replace('.', '\\.')}`, 'u');
const formPath = '/checkout/accessory';
const shop = { name: 'KRA010', location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } };
const station = { name: 'WAW01M', location_description: 'Train station', address: { line1: 'Station Square 2', line2: '00-001 Warsaw' } };

const serve = (input: { token?: string | null; onSession?: (body: unknown) => void } = {}) => {
  server.use(
    anonymousMe(),
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: {
      tenant: { slug: 'acme', name: 'Acme School' },
      contentVersion: 1,
      products: [{
        id: 'accessory', type: 'physical', deliveryMethod: 'shipping', slug: 'accessory', title: 'Printed accessory', description: 'A small part.',
        coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [],
      }],
    } })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: true, simulatedPaymentsEnabled: false, inpostGeowidgetWithheld: false, canTest: false, testConfigured: false, testEnabled: false,
      inpostGeowidgetToken: input.token === undefined ? 'public-map-token' : input.token,
      shippingRates: [
        { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker' },
        { id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'other', pickupPoint: 'none' },
      ],
    } })),
    http.post('/api/public/checkout/session', async ({ request }) => {
      input.onSession?.(await request.json());
      return HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Stop before redirect' } }, { status: 400 });
    }),
  );
};

const histories: ReturnType<typeof createBrowserHistory>[] = [];
const renderCheckout = async (options: { from?: string; themed?: boolean } = {}) => {
  window.history.replaceState(null, '', options.from ?? formPath);
  const location = window.location;
  const assign = vi.fn();
  const reload = vi.fn();
  vi.spyOn(window, 'location', 'get').mockImplementation(() => ({ ...location, assign, reload }));
  const history = createBrowserHistory();
  histories.push(history);
  if (options.from !== undefined) {
    history.push(formPath);
    history.flush();
  }
  const root = createRootRoute({ component: Outlet });
  const checkout = createRoute({ getParentRoute: () => root, path: '/checkout/$ref', component: () => <CheckoutPage productRef="accessory" /> });
  const member = createRoute({ getParentRoute: () => root, path: '/my', component: () => <p>Member view</p> });
  const router = createRouter({ routeTree: root.addChildren([checkout, member]), history });
  const app = <RouterProvider router={router} />;
  renderWithProviders(options.themed === true ? <ThemeProvider theme={createThemeForMode('shadcn', undefined, 'light', 'member')}>{app}</ThemeProvider> : app);
  await userEvent.click(await screen.findByRole('radio', { name: lockerOption }));
  return { router, assign, reload };
};

const chooseButton = () => screen.getByRole('button', { name: en.shipping.lockerChoose });
const changeButton = () => screen.getByRole('button', { name: en.shipping.lockerChangeLabel });
const picker = () => screen.findByRole('dialog', { name: en.shipping.lockerChoose });
const onPhone = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true, media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }));
};
const announcement = () => screen.getByTestId('checkout-locker-announcement');
const widget = () => {
  const element = document.querySelector('inpost-geowidget');
  if (element === null) throw new Error('Missing parcel locker map');
  return element;
};
const pickOnMap = (point: typeof shop) => {
  act(() => { document.dispatchEvent(new CustomEvent(widget().getAttribute('onpoint') ?? '', { detail: point })); });
};
const mapReady = (api: unknown) => {
  act(() => { widget().dispatchEvent(new CustomEvent('inpost.geowidget.init', { bubbles: true, detail: { api } })); });
};
const pickerClosed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
const chooseShop = async () => {
  await userEvent.click(chooseButton());
  await picker();
  pickOnMap(shop);
  await pickerClosed();
};
const entryIndex = (router: { history: { location: { state: { __TSR_index: number } } } }) => router.history.location.state.__TSR_index;

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => {
  histories.splice(0).forEach((history) => history.destroy());
  document.getElementById('inpost-geowidget-script')?.remove();
  document.getElementById('inpost-geowidget-style')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parcel locker picker', () => {
  it('renders no map until the buyer opens the picker, then mounts it inside a named dialog', async () => {
    serve();
    await renderCheckout();
    expect(chooseButton()).toBeVisible();
    expect(document.querySelector('inpost-geowidget')).toBeNull();
    expect(screen.queryByTestId('checkout-inpost-geowidget')).not.toBeInTheDocument();
    expect(document.getElementById('inpost-geowidget-script')).toBeNull();
    expect(document.getElementById('inpost-geowidget-style')).toBeNull();

    await userEvent.click(chooseButton());
    const dialog = await picker();
    expect(within(dialog).getByTestId('checkout-inpost-geowidget').firstElementChild).toBe(widget());
    expect(widget()).toHaveAttribute('token', 'public-map-token');
    expect(widget()).toHaveAttribute('language', 'en');
    expect(widget()).toHaveAttribute('config', 'parcelCollect');
    expect(document.getElementById('inpost-geowidget-script')).toHaveAttribute('src', 'https://geowidget.inpost.pl/inpost-geowidget.js');
    expect(document.getElementById('inpost-geowidget-style')).toHaveAttribute('href', 'https://geowidget.inpost.pl/inpost-geowidget.css');
  });

  it('moves focus to the picker heading, tells the buyer to use the map card\'s own Select button and offers no second button of its own', async () => {
    serve();
    await renderCheckout();
    await userEvent.click(chooseButton());
    const dialog = await picker();
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: en.shipping.lockerChoose })).toHaveFocus());
    expect(dialog).toHaveAccessibleDescription(en.shipping.lockerPickerPrompt);
    const status = within(dialog).getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(en.shipping.lockerPickerPrompt);
    expect(within(dialog).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([en.shipping.lockerKnowCode, en.common.close]);
    expect(screen.queryByTestId('checkout-locker-confirm')).not.toBeInTheDocument();
  });

  it('commits the point the map reports at once, closes the picker, returns focus to Change and announces the chosen locker', async () => {
    const bodies: unknown[] = [];
    serve({ onSession: (body) => bodies.push(body) });
    const { router } = await renderCheckout();
    const formIndex = entryIndex(router);
    await userEvent.click(chooseButton());
    await picker();
    expect(announcement()).toBeEmptyDOMElement();

    pickOnMap(shop);
    await pickerClosed();
    const chosen = screen.getByTestId('checkout-pickup-point-selected');
    expect(chosen).toHaveTextContent(en.shipping.lockerSelected);
    expect(chosen).toHaveTextContent('KRA010 · Next to the shop');
    expect(chosen).toHaveTextContent('Main Street 1, 30-001 Cracow');
    await waitFor(() => expect(changeButton()).toHaveFocus());
    expect(changeButton()).toHaveAccessibleDescription(/KRA010 · Next to the shop/u);
    expect(announcement()).toHaveAttribute('role', 'status');
    expect(announcement()).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(announcement()).toHaveTextContent(en.shipping.lockerChosenAnnouncement({ code: 'KRA010', address: 'Main Street 1, 30-001 Cracow' })));
    expect(document.querySelector('inpost-geowidget')).toBeNull();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex));
    expect(router.state.location.pathname).toBe(formPath);

    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, 30-001 Cracow' } } });
  });

  it('keeps the first point when another one arrives while the picker is closing', async () => {
    serve();
    await renderCheckout();
    await userEvent.click(chooseButton());
    await picker();
    const eventName = widget().getAttribute('onpoint') ?? '';
    pickOnMap(shop);
    act(() => { document.dispatchEvent(new CustomEvent(eventName, { detail: station })); });
    await pickerClosed();
    expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010 · Next to the shop');
  });

  it.each([
    { way: 'the close button', close: async () => { await userEvent.click(screen.getByRole('button', { name: en.common.close })); } },
    { way: 'Escape', close: async () => { await userEvent.keyboard('{Escape}'); } },
    { way: 'Escape inside the map', close: async () => { act(() => { widget().dispatchEvent(new Event('inpost.geowidget.escape', { bubbles: true })); }); } },
    { way: 'Escape the map reports without bubbling', close: async () => { act(() => { widget().dispatchEvent(new Event('inpost.geowidget.escape')); }); } },
    { way: 'Escape the map reports on the document', close: async () => { act(() => { document.dispatchEvent(new Event('inpost.geowidget.escape')); }); } },
    { way: 'the back gesture', close: async () => { act(() => { window.history.back(); }); } },
  ])('closes on $way, keeps the previous choice and returns focus to Change', async ({ close }) => {
    serve();
    const { router } = await renderCheckout();
    const formIndex = entryIndex(router);
    await chooseShop();
    await userEvent.click(changeButton());
    const dialog = await picker();
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: en.shipping.lockerChoose })).toHaveFocus());
    expect(within(dialog).getByRole('status')).toHaveTextContent(en.shipping.lockerPickerPrompt);
    await close();
    await pickerClosed();
    expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010 · Next to the shop');
    await waitFor(() => expect(changeButton()).toHaveFocus());
    expect(announcement()).toBeEmptyDOMElement();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex));
    expect(router.state.location.pathname).toBe(formPath);
    expect(screen.getByRole('radio', { name: lockerOption })).toBeChecked();
  });

  it('adds one history entry for the open picker and removes it on close and on a commit, without leaving the page', async () => {
    serve();
    const { router, assign, reload } = await renderCheckout();
    const formIndex = entryIndex(router);
    await userEvent.click(chooseButton());
    await picker();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex + 1));
    const lengthWhileOpen = window.history.length;
    expect(router.history.location.pathname).toBe(formPath);
    await userEvent.click(screen.getByRole('button', { name: en.common.close }));
    await pickerClosed();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex));

    await userEvent.click(chooseButton());
    await picker();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex + 1));
    pickOnMap(shop);
    await pickerClosed();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex));
    expect(window.history.length).toBe(lengthWhileOpen);
    expect(router.state.location.pathname).toBe(formPath);
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010');
  });

  it('shows the chosen locker on the map when the picker reopens, and asks the map for nothing on a first choice', async () => {
    serve();
    await renderCheckout();
    await userEvent.click(chooseButton());
    await picker();
    const first = vi.fn();
    mapReady({ showPoint: first });
    await act(async () => { await Promise.resolve(); });
    expect(first).not.toHaveBeenCalled();
    pickOnMap(shop);
    await pickerClosed();

    await userEvent.click(changeButton());
    await picker();
    const showPoint = vi.fn();
    mapReady({ showPoint });
    await waitFor(() => expect(showPoint).toHaveBeenCalledExactlyOnceWith('KRA010'));
  });

  it.each([
    { api: 'no handle', handle: undefined },
    { api: 'a handle without showPoint', handle: {} },
    { api: 'a showPoint that throws', handle: { showPoint: () => { throw new Error('destroyed connection'); } } },
    { api: 'a showPoint that rejects', handle: { showPoint: () => Promise.reject(new Error('destroyed connection')) } },
  ])('keeps the picker working when the map offers $api', async ({ handle }) => {
    serve();
    await renderCheckout();
    await chooseShop();
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.error); };
    window.addEventListener('error', onError);
    try {
      await userEvent.click(changeButton());
      await picker();
      mapReady(handle);
      await act(async () => { await Promise.resolve(); });
      expect(errors).toEqual([]);
      pickOnMap(station);
      await pickerClosed();
      expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('WAW01M · Train station');
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  it('closes only the picker on the back gesture after the map loaded, and still leaves the checkout by a document navigation on the next back', async () => {
    serve();
    const { router, assign, reload } = await renderCheckout({ from: '/my' });
    await chooseShop();
    await userEvent.click(changeButton());
    await picker();
    act(() => { window.history.back(); });
    await pickerClosed();
    expect(reload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe(formPath);
    expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010');

    act(() => { window.history.back(); });
    await waitFor(() => expect(reload).toHaveBeenCalledExactlyOnceWith());
    expect(screen.queryByText('Member view')).not.toBeInTheDocument();
  });

  it('keeps one navigation guard however often the picker is opened after the map loaded', async () => {
    serve();
    const { router } = await renderCheckout();
    const guards = new Set<unknown>();
    const block = router.history.block;
    vi.spyOn(router.history, 'block').mockImplementation((blocker) => {
      const unblock = block(blocker);
      guards.add(blocker);
      return () => {
        guards.delete(blocker);
        unblock();
      };
    });
    await chooseShop();
    for (let round = 0; round < 3; round += 1) {
      await userEvent.click(changeButton());
      await picker();
      await userEvent.click(screen.getByRole('button', { name: en.common.close }));
      await pickerClosed();
    }
    expect(guards.size).toBe(1);
  });

  it('tries the map script again when it failed to load while the picker was closed', async () => {
    serve();
    await renderCheckout();
    await userEvent.click(chooseButton());
    await picker();
    const first = document.getElementById('inpost-geowidget-script');
    await userEvent.click(screen.getByRole('button', { name: en.common.close }));
    await pickerClosed();
    act(() => { first?.dispatchEvent(new Event('error')); });
    expect(document.getElementById('inpost-geowidget-script')).toBeNull();

    await userEvent.click(chooseButton());
    const dialog = await picker();
    const retried = document.getElementById('inpost-geowidget-script');
    expect(retried).toHaveAttribute('src', 'https://geowidget.inpost.pl/inpost-geowidget.js');
    expect(retried).not.toBe(first);
    act(() => { retried?.dispatchEvent(new Event('error')); });
    expect(within(dialog).getByRole('status')).toHaveTextContent(en.shipping.lockerPickerMapFailed);
  });

  it('keeps focus inside the picker and hides the checkout behind it from assistive technology', async () => {
    serve();
    await renderCheckout();
    await userEvent.click(chooseButton());
    const dialog = await picker();
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: en.shipping.lockerChoose })).toHaveFocus());
    for (let step = 0; step < 4; step += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    expect(screen.getByTestId('checkout-delivery').closest('[aria-hidden="true"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: en.common.close }));
    await pickerClosed();
    expect(screen.getByTestId('checkout-delivery').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('locks the page scroll while the picker is open and releases it on close', async () => {
    serve();
    await renderCheckout();
    expect(document.body.style.overflow).toBe('');
    await userEvent.click(chooseButton());
    await picker();
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.click(screen.getByRole('button', { name: en.common.close }));
    await pickerClosed();
    expect(document.body.style.overflow).toBe('');
  });

  it('fills the whole screen on a phone with a flat paper, without the dialog corners and border', async () => {
    onPhone();
    serve();
    await renderCheckout({ themed: true });
    await userEvent.click(chooseButton());
    const paper = await picker();
    expect(paper).toHaveClass('MuiDialog-paperFullScreen');
    expect(getComputedStyle(paper).borderRadius).toBe('0px');
    expect(getComputedStyle(paper).borderTopWidth).toBe('0px');
  });

  it('explains a map that fails to load inside the picker and then offers the typed code directly', async () => {
    const bodies: unknown[] = [];
    serve({ onSession: (body) => bodies.push(body) });
    await renderCheckout();
    await userEvent.click(chooseButton());
    const dialog = await picker();
    act(() => { document.getElementById('inpost-geowidget-script')?.dispatchEvent(new Event('error')); });
    expect(within(dialog).getByRole('status')).toHaveTextContent(en.shipping.lockerPickerMapFailed);
    const reason = within(dialog).getByTestId('checkout-locker-map-failed-reason');
    expect(reason).toHaveTextContent(en.shipping.lockerPickerMapFailed);
    expect(reason).toHaveAttribute('aria-hidden', 'true');
    expect(within(dialog).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([en.common.close, en.common.retry, en.shipping.lockerTypeCode]);
    expect(document.querySelector('inpost-geowidget')).toBeNull();
    expect(document.getElementById('inpost-geowidget-script')).toBeNull();

    await userEvent.click(within(dialog).getByRole('button', { name: en.shipping.lockerTypeCode }));
    await pickerClosed();
    expect(screen.getByTestId('checkout-locker-map-failed')).toHaveTextContent(en.shipping.lockerMapFailed);
    expect(screen.queryByRole('button', { name: en.shipping.lockerChoose })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.shipping.lockerKnowCode })).not.toBeInTheDocument();
    const code = screen.getByLabelText(en.shipping.lockerCodeLabel);
    await waitFor(() => expect(code).toHaveFocus());
    await userEvent.type(code, 'waw01m');
    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
  });

  it('mounts the map again with a fresh script when the buyer tries again after a failure inside the picker', async () => {
    serve();
    await renderCheckout();
    await userEvent.click(chooseButton());
    const dialog = await picker();
    const failedScript = document.getElementById('inpost-geowidget-script');
    act(() => { failedScript?.dispatchEvent(new Event('error')); });
    expect(within(dialog).getByRole('status')).toHaveTextContent(en.shipping.lockerPickerMapFailed);
    expect(within(dialog).queryByRole('button', { name: en.shipping.lockerKnowCode })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: en.common.retry }));
    expect(within(dialog).getByRole('status')).toHaveTextContent(en.shipping.lockerPickerPrompt);
    expect(within(dialog).queryByTestId('checkout-locker-map-failed-reason')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([en.shipping.lockerKnowCode, en.common.close]);
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: en.shipping.lockerChoose })).toHaveFocus());
    const retried = document.getElementById('inpost-geowidget-script');
    expect(retried).toHaveAttribute('src', 'https://geowidget.inpost.pl/inpost-geowidget.js');
    expect(retried).not.toBe(failedScript);
    expect(within(dialog).getByTestId('checkout-inpost-geowidget').firstElementChild).toBe(widget());

    pickOnMap(shop);
    await pickerClosed();
    expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010 · Next to the shop');
    expect(screen.queryByTestId('checkout-locker-map-failed')).not.toBeInTheDocument();
  });

  it('shows the typed code directly, without a picker or a reason, when the workspace has no map token', async () => {
    serve({ token: null });
    await renderCheckout();
    expect(await screen.findByLabelText(en.shipping.lockerCodeLabel)).toHaveAccessibleDescription(en.shipping.lockerCodeHint);
    expect(screen.queryByRole('button', { name: en.shipping.lockerChoose })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.shipping.lockerKnowCode })).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-locker-map-failed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-locker-dialog')).not.toBeInTheDocument();
  });

  it('keeps the typed code behind "I know the code" as the second way to choose a locker', async () => {
    const bodies: unknown[] = [];
    serve({ onSession: (body) => bodies.push(body) });
    await renderCheckout();
    const toggle = screen.getByRole('button', { name: en.shipping.lockerKnowCode });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel).not.toBeVisible();
    expect(screen.queryByLabelText(en.shipping.lockerCodeLabel)).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const code = screen.getByLabelText(en.shipping.lockerCodeLabel);
    expect(panel).toBeVisible();
    expect(panel).toContainElement(code);
    expect(code).toHaveAccessibleDescription(en.shipping.lockerCodeHint);
    await userEvent.type(code, 'waw01m');
    expect(chooseButton()).toBeVisible();
    await userEvent.type(screen.getByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
    expect(bodies[0]).not.toHaveProperty('shipping.pickupPoint.name');
    expect(document.getElementById('inpost-geowidget-script')).toBeNull();
  });

  it('offers "I know the code" inside the picker, which closes it, opens the typed-code field on the page and focuses it', async () => {
    serve();
    const { router } = await renderCheckout();
    const formIndex = entryIndex(router);
    await userEvent.click(chooseButton());
    const dialog = await picker();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex + 1));

    await userEvent.click(within(dialog).getByRole('button', { name: en.shipping.lockerKnowCode }));
    await pickerClosed();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex));
    expect(router.state.location.pathname).toBe(formPath);
    expect(screen.getByRole('button', { name: en.shipping.lockerKnowCode })).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByLabelText(en.shipping.lockerCodeLabel)).toHaveFocus());
    expect(chooseButton()).toBeVisible();
  });

  it('leaves "Type the code" in the failed cover as the only code exit of the full-screen picker, and focuses the typed code', async () => {
    onPhone();
    serve();
    await renderCheckout();
    await userEvent.click(chooseButton());
    const dialog = await picker();
    act(() => { document.getElementById('inpost-geowidget-script')?.dispatchEvent(new Event('error')); });
    expect(within(dialog).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([en.shipping.lockerPickerBack, en.common.retry, en.shipping.lockerTypeCode]);
    expect(within(dialog).getByTestId('checkout-locker-map-failed-reason')).toHaveTextContent(en.shipping.lockerPickerMapFailed);
    await userEvent.click(within(dialog).getByRole('button', { name: en.shipping.lockerTypeCode }));
    await pickerClosed();
    expect(screen.getByTestId('checkout-locker-map-failed')).toHaveTextContent(en.shipping.lockerMapFailed);
    await waitFor(() => expect(screen.getByLabelText(en.shipping.lockerCodeLabel)).toHaveFocus());
  });

  it('gives the full-screen picker a labelled Back control instead of a bare close icon, which closes it and keeps the choice', async () => {
    onPhone();
    serve();
    const { router } = await renderCheckout();
    const formIndex = entryIndex(router);
    await chooseShop();
    await userEvent.click(changeButton());
    const dialog = await picker();
    expect(within(dialog).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([en.shipping.lockerPickerBack, en.shipping.lockerKnowCode]);
    expect(within(dialog).queryByRole('button', { name: en.common.close })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: en.shipping.lockerPickerBack }));
    await pickerClosed();
    await waitFor(() => expect(entryIndex(router)).toBe(formIndex));
    expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010 · Next to the shop');
    await waitFor(() => expect(changeButton()).toHaveFocus());
  });

  it('gives Choose a map pin and the filled look, the chosen locker a check, and "I know the code" a chevron', async () => {
    serve();
    await renderCheckout();
    expect(chooseButton()).toHaveClass('MuiButton-contained');
    expect(chooseButton().querySelector('.MuiButton-startIcon svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: en.shipping.lockerKnowCode }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    await chooseShop();
    const caption = within(screen.getByTestId('checkout-pickup-point-selected')).getByText(en.shipping.lockerSelected);
    expect(caption.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(caption.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes the typed-code field when the buyer then chooses a locker on the map', async () => {
    serve();
    await renderCheckout();
    const toggle = screen.getByRole('button', { name: en.shipping.lockerKnowCode });
    await userEvent.click(toggle);
    expect(screen.getByLabelText(en.shipping.lockerCodeLabel)).toBeVisible();

    await chooseShop();
    expect(screen.getByTestId('checkout-pickup-point-selected')).toHaveTextContent('KRA010 · Next to the shop');
    expect(screen.getByRole('button', { name: en.shipping.lockerKnowCode })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(en.shipping.lockerCodeLabel)).not.toBeInTheDocument();
  });

  it('shows the chosen code in the typed field, and a typed edit replaces the chosen locker', async () => {
    serve();
    await renderCheckout();
    await chooseShop();
    await userEvent.click(screen.getByRole('button', { name: en.shipping.lockerKnowCode }));
    const code = screen.getByLabelText(en.shipping.lockerCodeLabel);
    expect(code).toHaveValue('KRA010');
    await userEvent.type(code, '1');
    expect(screen.queryByTestId('checkout-pickup-point-selected')).not.toBeInTheDocument();
    expect(chooseButton()).toBeVisible();
  });
});
