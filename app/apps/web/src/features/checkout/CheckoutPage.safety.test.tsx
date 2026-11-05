import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const compliance = {
  manufacturerName: 'Example Workshop',
  manufacturerAddress: 'Example Street 1, Warsaw',
  manufacturerEmail: 'safety@example.com',
  modelIdentifier: 'STAND-1',
  batchIdentifier: 'B-2026-11',
  safetyWarnings: 'Keep away from **open flame**.',
  safetyWarningsHtml: '<p>Keep away from <strong>open flame</strong>.</p>',
  instructionsUrl: 'https://example.com/manual.pdf',
};

const product = (id: string, change: Record<string, unknown> = {}) => ({
  id, type: 'physical', deliveryMethod: 'pickup', slug: `stand-${id}`, title: `Printed stand ${id}`, description: '<p>A sturdy stand.</p>',
  coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [], compliance: null, variants: [], ...change,
});

const serve = (products: unknown[]) => {
  server.use(
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Acme School' }, contentVersion: 1, products } })),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false } })),
  );
};

const renderCheckout = (productRef: string) => {
  const root = createRootRoute({ component: () => <CheckoutPage productRef={productRef} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [`/checkout/${productRef}`] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('checkout product safety information', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/stand-black?utm_source=newsletter&checkout=together');
  });

  it('shows the safety information of a physical product expanded under the description', async () => {
    serve([product('black', { compliance })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    expect(within(section).getByRole('heading', { name: en.productSafety.offerHeading })).toBeVisible();
    expect(within(section).getByText(/Example Workshop, Example Street 1, Warsaw/)).toBeVisible();
    expect(within(section).getByRole('link', { name: 'safety@example.com' })).toHaveAttribute('href', 'mailto:safety@example.com');
    expect(within(section).getByText('STAND-1')).toBeVisible();
    expect(within(section).getByText('B-2026-11')).toBeVisible();
    expect(within(section).getByText('open flame').tagName).toBe('STRONG');
    expect(within(section).getByRole('link', { name: en.productSafety.instructions })).toHaveAttribute('href', 'https://example.com/manual.pdf');
    expect(screen.getByText('A sturdy stand.').compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses the safety information of other product types until it is opened', async () => {
    serve([product('black', { type: 'digital_download', compliance })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    expect(within(section).queryByText('STAND-1')).not.toBeVisible();
    await userEvent.click(within(section).getByRole('button', { name: en.productSafety.offerHeading }));
    expect(await within(section).findByText('STAND-1')).toBeVisible();
  });

  it('renders no safety section without safety information', async () => {
    serve([product('black')]);
    renderCheckout('stand-black');
    expect(await screen.findByText('A sturdy stand.')).toBeVisible();
    expect(screen.queryByTestId('product-safety-info')).toBeNull();
  });
});

describe('checkout variant chips', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/checkout/stand-black?utm_source=newsletter&checkout=together');
  });

  const variants = [
    { productId: 'black', slug: 'stand-black', label: 'Black · ASA', soldOut: false },
    { productId: 'white', slug: 'stand-white', label: 'White · PLA', soldOut: false },
    { productId: 'red', slug: 'stand-red', label: 'Red · PETG', soldOut: true },
  ];

  it('selects the current variant, links the others with the campaign and disables sold-out variants', async () => {
    serve([product('black', { variants })]);
    renderCheckout('stand-black');
    const chips = await screen.findByRole('navigation', { name: en.productVariants.offerLabel });
    expect(within(chips).getByTestId('product-variant-black')).toHaveAttribute('aria-current', 'page');
    expect(within(chips).getByRole('link', { name: 'White · PLA' })).toHaveAttribute('href', '/checkout/stand-white?utm_source=newsletter');
    const soldOut = within(chips).getByTestId('product-variant-red');
    expect(soldOut).toHaveTextContent(`Red · PETG · ${en.productVariants.soldOut}`);
    expect(soldOut).toHaveClass('Mui-disabled');
    expect(within(chips).queryByRole('link', { name: /Red/ })).toBeNull();
    expect(chips.compareDocumentPosition(screen.getByText('PLN 49.00')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no chips without at least two variants', async () => {
    serve([product('black', { variants: variants.slice(0, 1) })]);
    renderCheckout('stand-black');
    expect(await screen.findByText('A sturdy stand.')).toBeVisible();
    expect(screen.queryByTestId('product-variants')).toBeNull();
  });
});
