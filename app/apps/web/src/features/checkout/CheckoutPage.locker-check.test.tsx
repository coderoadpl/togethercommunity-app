import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PICKUP_POINT_REJECTION_MESSAGES } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';
import { SUBMIT_LOCKER_CHECK_WAIT_MS } from './use-locker-check.js';

const offer = {
  tenant: { slug: 'acme', name: 'Acme School' },
  contentVersion: 1,
  products: [{
    id: 'accessory', type: 'physical', deliveryMethod: 'shipping', slug: 'accessory', title: 'Printed accessory', description: 'A small part.',
    coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [],
  }],
};

const lockerRate = { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker' };
const courierRate = { id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'inpost', pickupPoint: 'none' };

const lockers: Record<string, unknown> = {
  WAW01M: { status: 'found', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw', usable: true, reason: null },
  MISSING1: { status: 'not_found' },
  CLOSED01: { status: 'found', code: 'CLOSED01', name: null, address: null, usable: false, reason: 'not_operating' },
  SENDONLY1: { status: 'found', code: 'SENDONLY1', name: null, address: null, usable: false, reason: 'not_usable' },
  OUTAGE01: { status: 'unavailable' },
};

const serve = (input: {
  token?: string | null; canTest?: boolean; testEnabled?: boolean; sessionError?: { message: string; details?: unknown };
  rates?: unknown[]; simulated?: boolean;
} = {}) => {
  const lookups: string[] = [];
  const sessions: unknown[] = [];
  const simulations: unknown[] = [];
  server.use(
    anonymousMe(),
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offer })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: input.simulated !== true, simulatedPaymentsEnabled: input.simulated === true, shippingRates: input.rates ?? [lockerRate],
      inpostGeowidgetToken: input.token ?? null, inpostGeowidgetWithheld: false,
      canTest: input.canTest ?? false, testConfigured: input.canTest === true, testEnabled: input.testEnabled ?? false,
    } })),
    http.get('/api/public/parcel-lockers/:code', ({ params }) => {
      const code = String(params.code);
      lookups.push(code);
      return HttpResponse.json({ ok: true, data: lockers[code] ?? { status: 'not_found' } });
    }),
    http.post('/api/public/checkout/session', async ({ request }) => {
      sessions.push(await request.json());
      const error = input.sessionError ?? { message: 'Stop before redirect' };
      return HttpResponse.json({ ok: false, error: { code: 'validation', ...error } }, { status: 400 });
    }),
    http.post('/api/dev/simulate-purchase', async ({ request }) => {
      simulations.push(await request.json());
      const error = input.sessionError ?? { message: 'Stop before the order' };
      return HttpResponse.json({ ok: false, error: { code: 'validation', ...error } }, { status: 400 });
    }),
  );
  return { lookups, sessions, simulations };
};

const holdLookups = (lookups: string[]) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  server.use(http.get('/api/public/parcel-lockers/:code', async ({ params }) => {
    const code = String(params.code);
    lookups.push(code);
    await gate;
    return HttpResponse.json({ ok: true, data: lockers[code] ?? { status: 'not_found' } });
  }));
  return () => release?.();
};

const pickOnMap = async (name: string) => {
  const widget = (await screen.findByTestId('checkout-inpost-geowidget')).querySelector('inpost-geowidget');
  const eventName = widget?.getAttribute('onpoint') ?? '';
  act(() => { document.dispatchEvent(new CustomEvent(eventName, { detail: { name, location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } } })); });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
};

const renderCheckout = () => {
  const root = createRootRoute({ component: () => <CheckoutPage productRef="accessory" /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/checkout/accessory'] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

const typeCode = async (code: string) => {
  await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
  await userEvent.click(screen.getByRole('radio', { name: /^Parcel locker/u }));
  const field = screen.getByLabelText(en.shipping.lockerCodeLabel);
  await userEvent.type(field, code);
  return field;
};

describe('typed parcel locker code check', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/accessory');
  });
  afterEach(() => {
    document.getElementById('inpost-geowidget-script')?.remove();
    document.getElementById('inpost-geowidget-style')?.remove();
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it('shows the locker name and address in a polite live region after the buyer leaves the field', async () => {
    const h = serve();
    renderCheckout();
    const field = await typeCode('waw01m');
    const status = screen.getByTestId('checkout-pickup-point-check');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    await userEvent.tab();
    await waitFor(() => expect(status).toHaveTextContent(en.shipping.lockerCheckFound));
    expect(status).toHaveTextContent('WAW01M · Next to the main entrance');
    expect(status).toHaveTextContent('Main Street 1, 00-001 Warsaw');
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(`${en.shipping.lockerCheckFound} WAW01M · Next to the main entrance Main Street 1, 00-001 Warsaw`);
    expect(screen.queryByText(en.shipping.lockerCodeHint)).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
    expect(h.lookups).toEqual(['WAW01M']);
  });

  it('shows a neutral line while the carrier is asked', async () => {
    serve();
    server.use(http.get('/api/public/parcel-lockers/:code', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return HttpResponse.json({ ok: true, data: lockers.WAW01M });
    }));
    renderCheckout();
    await typeCode('waw01m');
    await userEvent.tab();
    expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerChecking);
    expect(screen.queryByText(en.shipping.lockerCodeHint)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerCheckFound));
  });

  it.each([
    ['MISSING1', en.shipping.lockerRejected.not_found],
    ['CLOSED01', en.shipping.lockerRejected.not_operating],
    ['SENDONLY1', en.shipping.lockerRejected.not_usable],
  ])('refuses %s under the field, keeps payment disabled and names the reason under the button', async (code, message) => {
    const h = serve();
    renderCheckout();
    const field = await typeCode(code);
    await userEvent.tab();
    await waitFor(() => expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(message));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(message);
    expect(screen.getByTestId('checkout-pickup-point-check').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText(en.shipping.lockerCodeHint)).not.toBeInTheDocument();
    expect(screen.getByText(en.shipping.lockerCodeLabel)).toHaveClass('Mui-error');
    expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled();
    expect(screen.getByTestId('checkout-pay-reason')).toHaveTextContent(en.checkout.payBlockedLockerRejected);
    await userEvent.clear(field);
    await userEvent.type(field, 'waw01m');
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
    expect(h.sessions).toEqual([]);
  });

  it('shows no error and lets the buyer pay when the carrier cannot be asked', async () => {
    const h = serve();
    renderCheckout();
    const field = await typeCode('outage01');
    await userEvent.tab();
    await waitFor(() => expect(h.lookups).toEqual(['OUTAGE01']));
    expect(screen.getByTestId('checkout-pickup-point-check')).toBeEmptyDOMElement();
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(en.shipping.lockerCodeHint);
    expect(screen.getByText(en.shipping.lockerCodeHint)).not.toHaveClass('Mui-error');
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(h.sessions).toHaveLength(1));
    expect(h.sessions[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'OUTAGE01' } } });
  });

  it('treats a refused lookup request as the carrier being unavailable', async () => {
    serve();
    server.use(http.get('/api/public/parcel-lockers/:code', () =>
      HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Too many requests' } }, { status: 429 })));
    renderCheckout();
    const field = await typeCode('waw01m');
    await userEvent.tab();
    await waitFor(() => expect(screen.getByTestId('checkout-pickup-point-check')).toBeEmptyDOMElement());
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
  });

  it('turns the example hint into the format error for a malformed code and keeps the hint neutral otherwise', async () => {
    serve();
    renderCheckout();
    const field = await typeCode('waw');
    await userEvent.tab();
    expect(field).toHaveAccessibleDescription(en.shipping.lockerCodeInvalid);
    expect(screen.getByText(en.shipping.lockerCodeInvalid)).toHaveClass('Mui-error');
    expect(screen.queryByText(en.shipping.lockerCodeHint)).not.toBeInTheDocument();
    await userEvent.clear(field);
    expect(field).toHaveAccessibleDescription(en.shipping.lockerCodeHint);
  });

  it('checks a code that was never left before starting the payment on submit', async () => {
    const h = serve();
    renderCheckout();
    const field = await typeCode('missing1');
    if (!(field instanceof HTMLInputElement) || field.form === null) throw new Error('Expected the code field inside the checkout form');
    fireEvent.submit(field.form);
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(h.lookups).toEqual(['MISSING1']);
    expect(h.sessions).toEqual([]);
  });

  it('starts the payment after the submit-time check finds the locker', async () => {
    const h = serve();
    renderCheckout();
    const field = await typeCode('waw01m');
    if (!(field instanceof HTMLInputElement) || field.form === null) throw new Error('Expected the code field inside the checkout form');
    fireEvent.submit(field.form);
    await waitFor(() => expect(h.sessions).toHaveLength(1));
    expect(h.lookups).toEqual(['WAW01M']);
    expect(h.sessions[0]).toMatchObject({ shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
  });

  it('marks the field when the server refuses the locker the buyer pays for', async () => {
    const h = serve({ sessionError: { message: PICKUP_POINT_REJECTION_MESSAGES.not_operating, details: { pickupPointReason: 'not_operating' } } });
    renderCheckout();
    const field = await typeCode('waw01m');
    await userEvent.tab();
    await waitFor(() => expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerCheckFound));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(h.sessions).toHaveLength(1));
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerRejected.not_operating);
    expect(screen.getByTestId('checkout-pay-reason')).toHaveTextContent(en.checkout.payBlockedLockerRejected);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText(en.shipping.lockerRejected.not_operating)).toHaveLength(1);
  });

  it('does not ask the carrier about a locker chosen on the map', async () => {
    const h = serve({ token: 'public-map-token' });
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('radio', { name: /^Parcel locker/u }));
    await userEvent.click(screen.getByRole('button', { name: en.shipping.lockerChoose }));
    const widget = (await screen.findByTestId('checkout-inpost-geowidget')).querySelector('inpost-geowidget');
    const eventName = widget?.getAttribute('onpoint') ?? '';
    act(() => { document.dispatchEvent(new CustomEvent(eventName, { detail: { name: 'KRA010', location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } } })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: en.shipping.lockerKnowCode }));
    screen.getByLabelText(en.shipping.lockerCodeLabel).focus();
    await userEvent.tab();
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(h.sessions).toHaveLength(1));
    expect(h.lookups).toEqual([]);
  });

  it.each([
    { viewer: 'a staff session', canTest: true, testEnabled: false },
    { viewer: 'a test-mode purchase', canTest: true, testEnabled: true },
  ])('checks the typed code for $viewer, which never loads the map', async ({ canTest, testEnabled }) => {
    const h = serve({ token: 'public-map-token', canTest, testEnabled });
    renderCheckout();
    await userEvent.click(await screen.findByRole('radio', { name: /^Parcel locker/u }));
    await userEvent.type(screen.getByLabelText(en.shipping.lockerCodeLabel), 'missing1');
    await userEvent.tab();
    await waitFor(() => expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerRejected.not_found));
    expect(h.lookups).toEqual(['MISSING1']);
    expect(document.getElementById('inpost-geowidget-script')).toBeNull();
  });

  it('locks the form while the submit-time check runs, then starts the payment from the unchanged form', async () => {
    const h = serve();
    const release = holdLookups(h.lookups);
    renderCheckout();
    const field = await typeCode('waw01m');
    const pay = screen.getByTestId('checkout-pay-cta');
    await userEvent.click(pay);
    await waitFor(() => expect(pay).toBeDisabled());
    expect(pay).toHaveTextContent(en.checkout.payPending);
    expect(field).toBeDisabled();
    expect(screen.getByLabelText(en.checkout.emailLabel)).toBeDisabled();
    expect(screen.getByRole('radio', { name: /^Parcel locker/u })).toBeDisabled();
    if (!(field instanceof HTMLInputElement) || field.form === null) throw new Error('Expected the code field inside the checkout form');
    fireEvent.submit(field.form);
    release();
    await waitFor(() => expect(h.sessions).toHaveLength(1));
    await waitFor(() => expect(pay).not.toHaveTextContent(en.checkout.payPending));
    expect(h.sessions).toHaveLength(1);
    expect(h.lookups).toEqual(['WAW01M']);
    expect(h.sessions[0]).toMatchObject({ email: 'buyer@example.org', shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
  });

  it('asks the carrier on submit while the browser reports being offline instead of pausing the check', async () => {
    const h = serve();
    renderCheckout();
    const field = await typeCode('waw01m');
    onlineManager.setOnline(false);
    if (!(field instanceof HTMLInputElement) || field.form === null) throw new Error('Expected the code field inside the checkout form');
    fireEvent.submit(field.form);
    await waitFor(() => expect(h.lookups).toEqual(['WAW01M']));
    await waitFor(() => expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerCheckFound));
    onlineManager.setOnline(true);
    await waitFor(() => expect(h.sessions).toHaveLength(1));
    expect(h.lookups).toEqual(['WAW01M']);
  });

  it('stops waiting for a slow submit-time check, lets the server decide and never starts the payment again when the answer comes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h = serve();
    const release = holdLookups(h.lookups);
    renderCheckout();
    const field = await typeCode('waw01m');
    const pay = screen.getByTestId('checkout-pay-cta');
    if (!(field instanceof HTMLInputElement) || field.form === null) throw new Error('Expected the code field inside the checkout form');
    fireEvent.submit(field.form);
    await waitFor(() => expect(pay).toHaveTextContent(en.checkout.payPending));
    act(() => { vi.advanceTimersByTime(SUBMIT_LOCKER_CHECK_WAIT_MS); });
    await waitFor(() => expect(h.sessions).toHaveLength(1));
    await waitFor(() => expect(pay).not.toHaveTextContent(en.checkout.payPending));
    expect(field).toBeEnabled();
    release();
    await waitFor(() => expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerCheckFound));
    expect(h.sessions).toHaveLength(1);
    expect(h.lookups).toEqual(['WAW01M']);
  });

  it.each([
    ['the locker code', () => fireEvent.change(screen.getByLabelText(en.shipping.lockerCodeLabel), { target: { value: 'KRA010' } })],
    ['the e-mail address', () => fireEvent.change(screen.getByLabelText(en.checkout.emailLabel), { target: { value: 'other@example.org' } })],
  ])('does not start the payment with old values when %s changes during the check', async (_change, change) => {
    const h = serve();
    const release = holdLookups(h.lookups);
    renderCheckout();
    await typeCode('waw01m');
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled());
    change();
    release();
    await waitFor(() => expect(screen.getByTestId('checkout-pay-cta')).not.toHaveTextContent(en.checkout.payPending));
    expect(h.sessions).toEqual([]);
  });

  it('submits a courier order on the first click while a check of an abandoned locker code is still running', async () => {
    const h = serve({ rates: [lockerRate, courierRate] });
    const release = holdLookups(h.lookups);
    renderCheckout();
    await typeCode('missing1');
    await userEvent.tab();
    expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerChecking);
    await userEvent.click(screen.getByRole('radio', { name: /^Courier/u }));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(h.sessions).toHaveLength(1));
    expect(h.sessions[0]).toMatchObject({ shipping: { rateId: 'courier' } });
    expect(h.sessions[0]).not.toHaveProperty('shipping.pickupPoint');
    release();
  });

  it('keeps payment disabled after the server refuses a locker chosen on the map, until another point is chosen', async () => {
    const h = serve({ token: 'public-map-token', sessionError: { message: PICKUP_POINT_REJECTION_MESSAGES.not_operating, details: { pickupPointReason: 'not_operating' } } });
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    await userEvent.click(screen.getByRole('radio', { name: /^Parcel locker/u }));
    await userEvent.click(screen.getByRole('button', { name: en.shipping.lockerChoose }));
    await pickOnMap('KRA010');
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(screen.getByTestId('checkout-pickup-point-selected-rejected')).toHaveTextContent(en.shipping.lockerRejected.not_operating));
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('checkout-pickup-point-selected-rejected'));
    expect(screen.getByTestId('checkout-pickup-point-selected-rejected').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByText(en.shipping.lockerRejected.not_operating)).toHaveLength(1);
    expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled();
    expect(screen.getByTestId('checkout-pay-reason')).toHaveTextContent(en.checkout.payBlockedLockerRejected);
    expect(screen.getByTestId('checkout-locker-change')).toHaveAccessibleDescription(expect.stringContaining(en.shipping.lockerRejected.not_operating));
    await userEvent.click(screen.getByTestId('checkout-locker-change'));
    await pickOnMap('KRA011');
    expect(screen.queryByTestId('checkout-pickup-point-selected-rejected')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-pay-cta')).toBeEnabled();
    expect(h.lookups).toEqual([]);
  });

  it('marks the field with the localized reason when a simulated purchase refuses the locker', async () => {
    const h = serve({ simulated: true, sessionError: { message: PICKUP_POINT_REJECTION_MESSAGES.not_found, details: { pickupPointReason: 'not_found' } } });
    renderCheckout();
    const field = await typeCode('outage01');
    await userEvent.tab();
    await waitFor(() => expect(h.lookups).toEqual(['OUTAGE01']));
    await userEvent.click(screen.getByTestId('checkout-pay-cta'));
    await waitFor(() => expect(h.simulations).toHaveLength(1));
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByTestId('checkout-pickup-point-check')).toHaveTextContent(en.shipping.lockerRejected.not_found);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText(en.shipping.lockerRejected.not_found)).toHaveLength(1);
    expect(screen.getByTestId('checkout-pay-cta')).toBeDisabled();
  });

  it('has the locker check copy in both languages', () => {
    for (const messages of [en, pl]) {
      for (const text of [messages.shipping.lockerChecking, messages.shipping.lockerCheckFound, messages.checkout.payBlockedLockerRejected,
        ...Object.values(messages.shipping.lockerRejected)]) {
        expect(text.trim()).not.toBe('');
      }
    }
    expect(pl.shipping.lockerRejected.not_found).not.toBe(en.shipping.lockerRejected.not_found);
  });
});
