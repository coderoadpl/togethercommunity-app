import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { sampleSalesLink } from '../../test/sales-link-fixtures.js';
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

describe('sales-link product safety information', () => {
  const line = (productId: string, name: string, type: string, lineCompliance: unknown) => ({
    productId, name, type, deliveryMethod: 'pickup', compliance: lineCompliance, grossCents: 4900, netCents: 4667, vatCents: 233, vatRate: 5, vatExemptionBasis: null,
  });
  const serveLink = (lines: unknown[]) => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Acme School' }, contentVersion: 1, products: [] } })),
      http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: {
        salesLink: sampleSalesLink, descriptionHtml: '<p>All items together.</p>', lines, currency: 'PLN', totalCents: 9800, soldOut: false,
        tenant: { slug: 'acme', name: 'Acme School', defaultLanguage: 'en', signInNotice: { enabled: false, text: '' }, branding: {}, socialLinks: [], legal: { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' }, support: { url: null }, timezone: 'Europe/Warsaw' },
        marketingConsents: [],
      } })),
      http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: true, simulatedPaymentsEnabled: false } })),
    );
  };
  const renderLink = () => {
    const root = createRootRoute({ component: () => <CheckoutPage productRef="" salesLinkSlug="stand-offer" /> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/offer/stand-offer'] }) });
    return renderWithProviders(<RouterProvider router={router} />);
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/offer/stand-offer');
  });

  it('shows the safety information of a single-product sales link expanded without the product title', async () => {
    serveLink([line('black', 'Printed stand', 'physical', compliance)]);
    renderLink();
    const section = await screen.findByTestId('product-safety-info');
    expect(within(section).getByRole('heading', { name: en.productSafety.offerHeading })).toBeVisible();
    expect(within(section).getByText('STAND-1')).toBeVisible();
  });

  it('shows one titled block per product with safety information in a bundle', async () => {
    serveLink([
      line('black', 'Printed stand', 'physical', compliance),
      line('guide', 'Assembly guide', 'digital_download', null),
      line('lamp', 'Printed lamp', 'physical', { ...compliance, modelIdentifier: 'LAMP-1', batchIdentifier: null, instructionsUrl: null }),
    ]);
    renderLink();
    await screen.findByText('All items together.');
    const [stand, lamp, ...rest] = await screen.findAllByTestId('product-safety-info');
    if (stand === undefined || lamp === undefined) throw new Error('expected two safety sections');
    expect(rest).toEqual([]);
    expect(within(stand).getByRole('heading', { name: en.productSafety.offerHeadingFor({ title: 'Printed stand' }) })).toBeVisible();
    expect(within(stand).getByText('STAND-1')).toBeVisible();
    expect(within(lamp).getByRole('heading', { name: en.productSafety.offerHeadingFor({ title: 'Printed lamp' }) })).toBeVisible();
    expect(within(lamp).getByText('LAMP-1')).toBeVisible();
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
