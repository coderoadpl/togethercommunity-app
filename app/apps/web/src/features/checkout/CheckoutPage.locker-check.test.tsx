import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PICKUP_POINT_REJECTION_MESSAGES } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const offer = {
  tenant: { slug: 'acme', name: 'Acme School' },
  contentVersion: 1,
  products: [{
    id: 'accessory', type: 'physical', deliveryMethod: 'shipping', slug: 'accessory', title: 'Printed accessory', description: 'A small part.',
    coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [],
  }],
};

const shippingRates = [
  { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker' },
];

const lockers: Record<string, unknown> = {
  WAW01M: { status: 'found', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw', usable: true, reason: null },
  MISSING1: { status: 'not_found' },
  CLOSED01: { status: 'found', code: 'CLOSED01', name: null, address: null, usable: false, reason: 'not_operating' },
  SENDONLY1: { status: 'found', code: 'SENDONLY1', name: null, address: null, usable: false, reason: 'not_usable' },
  OUTAGE01: { status: 'unavailable' },
};

const serve = (input: { token?: string | null; canTest?: boolean; testEnabled?: boolean; sessionError?: { message: string; details?: unknown } } = {}) => {
  const lookups: string[] = [];
  const sessions: unknown[] = [];
  server.use(
    anonymousMe(),
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offer })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: {
      stripeConfigured: true, simulatedPaymentsEnabled: false, shippingRates, inpostGeowidgetToken: input.token ?? null, inpostGeowidgetWithheld: false,
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
  );
  return { lookups, sessions };
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
    expect(field).toHaveAccessibleDescription(`${en.shipping.lockerCodeHint} ${en.shipping.lockerCheckFound} WAW01M · Next to the main entrance Main Street 1, 00-001 Warsaw`);
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
    expect(field).toHaveAccessibleDescription(`${en.shipping.lockerCodeHint} ${message}`);
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
    expect(screen.getByRole('alert')).toHaveTextContent(en.shipping.lockerRejected.not_operating);
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
