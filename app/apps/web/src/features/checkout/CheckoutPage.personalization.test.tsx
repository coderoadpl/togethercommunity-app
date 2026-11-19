import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const condition = 'I understand a personalised item is made to my order.';
const engraving = { label: 'Add an engraving', description: 'Engraved by hand.', inputLabel: 'Engraving text', maxLength: 40, condition };

const monthly = { id: 'price-monthly', kind: 'recurring', interval: 'month', amountCents: 4900, currency: 'PLN' };

const offer = (personalization: typeof engraving | null, prices: unknown[] = []) => ({
  tenant: { slug: 'acme', name: 'Acme School' },
  contentVersion: 1,
  products: [{
    id: 'stand', type: 'physical', deliveryMethod: 'pickup', slug: 'stand', title: 'Printed stand', description: 'A small stand.',
    coverUrl: null, priceCents: 4900, currency: 'PLN', prices, personalization,
  }],
});

const bundle = {
  salesLink: { slug: 'stand-offer', heading: 'Stand bundle', description: '', validFrom: null, validTo: null },
  descriptionHtml: '', currency: 'PLN', totalCents: 2460, marketingConsents: [],
  lines: [
    { productId: 'stand-white', baseProductId: 'stand', name: 'Printed stand', type: 'physical', grossCents: 1230, netCents: 1000, vatCents: 230, vatRate: 23, vatExemptionBasis: null, variants: [], personalization: { ...engraving, condition: null } },
    { productId: 'guide', name: 'Guide', type: 'digital_download', grossCents: 1230, netCents: 1000, vatCents: 230, vatRate: 23, vatExemptionBasis: null, variants: [], personalization: null },
  ],
  tenant: { slug: 'acme', name: 'Acme School', defaultLanguage: 'en', signInNotice: { enabled: false, text: '' }, branding: {}, socialLinks: [], legal: { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' }, support: { url: null }, timezone: 'Europe/Warsaw' },
};

const serve = (personalization: typeof engraving | null, bodies: unknown[], prices: unknown[] = []) => {
  server.use(
    anonymousMe(),
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offer(personalization, prices) })),
    http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: bundle })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false } })),
    http.post('/api/public/checkout/session', async ({ request }) => {
      bodies.push(await request.text());
      return HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Stop before redirect' } }, { status: 400 });
    }),
  );
};

const renderCheckout = (salesLinkSlug?: string) => {
  const root = createRootRoute({ component: () => salesLinkSlug === undefined ? <CheckoutPage productRef="stand" /> : <CheckoutPage productRef="" salesLinkSlug={salesLinkSlug} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/checkout/stand'] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

const payButton = () => screen.getByTestId('checkout-pay-cta');

describe('checkout personalisation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/stand?utm_source=newsletter');
  });

  it('sends exactly the request of an offer without a personalisation while the option stays unticked', async () => {
    const plain: unknown[] = [];
    serve(null, plain);
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    expect(screen.queryByTestId('checkout-personalization')).not.toBeInTheDocument();
    await userEvent.click(payButton());
    await waitFor(() => expect(plain).toHaveLength(1));
    cleanup();

    const offered: unknown[] = [];
    serve(engraving, offered);
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    expect(screen.getByRole('checkbox', { name: /Add an engraving/u })).not.toBeChecked();
    await userEvent.click(payButton());
    await waitFor(() => expect(offered).toHaveLength(1));
    expect(offered[0]).toBe(plain[0]);
    expect(offered[0]).not.toContain('personalizations');
  });

  it('blocks payment until the ticked option has text and the accepted condition, then sends it', async () => {
    const bodies: unknown[] = [];
    serve(engraving, bodies);
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    expect(payButton()).toBeEnabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Add an engraving/u }));
    expect(payButton()).toBeDisabled();
    expect(screen.getByText(en.personalization.textRequired)).toBeVisible();
    await userEvent.type(screen.getByLabelText('Engraving text'), '  For Alex ');
    expect(payButton()).toBeDisabled();
    expect(screen.getByText(en.personalization.conditionRequired)).toBeVisible();
    await userEvent.click(screen.getByRole('checkbox', { name: condition }));
    expect(payButton()).toBeEnabled();
    await userEvent.click(payButton());
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(String(bodies[0]))).toMatchObject({
      productId: 'stand',
      personalizations: [{ productId: 'stand', text: 'For Alex', conditionAccepted: true }],
    });
  });

  it('sends the chosen variant of a sales-link line as the personalised product', async () => {
    window.history.replaceState(null, '', '/offer/stand-offer?checkout=together');
    const bodies: unknown[] = [];
    serve(null, bodies);
    renderCheckout('stand-offer');
    expect(await screen.findByText(en.personalization.forLine({ name: 'Printed stand' }))).toBeVisible();
    expect(screen.queryByLabelText(en.checkout.emailLabel)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Add an engraving/u }));
    expect(screen.getByTestId('checkout-pay-reason')).toHaveTextContent(en.checkout.payBlockedPersonalization);
    await userEvent.type(screen.getByLabelText('Engraving text'), 'For Sam');
    expect(screen.queryByRole('checkbox', { name: /terms/iu })).not.toBeInTheDocument();
    await userEvent.click(payButton());
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(String(bodies[0]))).toMatchObject({
      salesLinkSlug: 'stand-offer',
      variantSelections: [{ productId: 'stand', variantProductId: 'stand-white' }],
      personalizations: [{ productId: 'stand-white', text: 'For Sam', conditionAccepted: false }],
    });
  });

  it('does not offer the option while a subscription price is selected', async () => {
    const bodies: unknown[] = [];
    serve(engraving, bodies, [monthly]);
    renderCheckout();
    await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.org');
    expect(screen.queryByRole('checkbox', { name: /Add an engraving/u })).not.toBeInTheDocument();
    await userEvent.click(payButton());
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toContain('personalizations');
  });
});
