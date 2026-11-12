import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, it } from 'vitest';
import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const variants = [
  { productId: 'black', slug: 'black', label: 'Black', soldOut: false },
  { productId: 'white', slug: 'white', label: 'White · PLA', soldOut: false },
  { productId: 'red', slug: 'red', label: 'Red · PETG', soldOut: true },
];
const line = { productId: 'black', baseProductId: 'black', name: 'Printed stand', type: 'physical', grossCents: 1230, netCents: 1000, vatCents: 230, vatRate: 23, vatExemptionBasis: null, variants };
const offer = {
  salesLink: { slug: 'stand-offer', heading: 'Stand bundle', description: '', validFrom: null, validTo: null },
  descriptionHtml: '', lines: [line, { ...line, productId: 'guide', baseProductId: 'guide', name: 'Guide', variants: [] }], currency: 'PLN', totalCents: 2460,
  tenant: { slug: 'acme', name: 'Community', defaultLanguage: 'en', signInNotice: { enabled: false, text: '' }, branding: {}, socialLinks: [], legal: { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' }, support: { url: null }, timezone: 'Europe/Warsaw' }, marketingConsents: [],
};
const renderOffer = () => {
  const root = createRootRoute({ component: () => <CheckoutPage productRef="" salesLinkSlug="stand-offer" /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/offer/stand-offer'] }) });
  return renderWithProviders(<RouterProvider router={router} />);
};
const serve = (data = offer) => server.use(http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data })));

beforeEach(() => {
  window.history.replaceState(null, '', '/offer/stand-offer?utm_source=newsletter&checkout=together');
  server.use(http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: true } })));
  serve();
});

it('renders named navigation between the title and prices with current and disabled non-links', async () => {
  renderOffer();
  const nav = await screen.findByRole('navigation', { name: 'Variant: Printed stand' });
  expect(screen.getAllByRole('navigation')).toHaveLength(1);
  const current = within(nav).getByTestId('product-variant-black');
  expect(current).toHaveAttribute('aria-current', 'true');
  expect(current).not.toHaveAttribute('tabindex');
  expect(current).not.toHaveAttribute('href');
  const white = within(nav).getByRole('link', { name: 'White · PLA' });
  expect(white).toHaveAttribute('href', '/offer/stand-offer?utm_source=newsletter&checkout=together&variant=black.white');
  await userEvent.tab();
  expect(white).toHaveFocus();
  const red = within(nav).getByTestId('product-variant-red');
  expect(red).toHaveClass('Mui-disabled');
  expect(red).toHaveTextContent('Red · PETG · Sold out');
  expect(red).not.toHaveAttribute('href');
  const net = screen.getAllByText(en.salesLinks.net)[0];
  if (net === undefined) throw new Error('Missing price label');
  expect(nav.compareDocumentPosition(net) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
});

it('marks a sibling already chosen by another line as unavailable before its stock reason', async () => {
  serve({ ...offer, lines: [line, { ...line, productId: 'red', baseProductId: 'red', name: 'Red stand', variants: [] }] });
  renderOffer();
  const red = await screen.findByTestId('product-variant-red');
  expect(red).toHaveTextContent('Red · PETG · Already in the bundle');
  expect(red).toHaveClass('Mui-disabled');
  expect(red).not.toHaveAttribute('href');
});

it('keeps a sold-out current chip selected and allows a sibling switch on a one-line offer', async () => {
  server.use(http.get('/api/public/sales-links/:slug', () => HttpResponse.json({ ok: true, data: {
    ...offer, soldOut: true, lines: [{ ...line, variants: variants.map((variant) => ({ ...variant, soldOut: variant.productId !== 'white' })) }],
  } })));
  renderOffer();
  expect(await screen.findByTestId('product-variant-black')).toHaveTextContent('Black · Sold out');
  expect(screen.getByTestId('product-variant-black')).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('button', { name: en.checkout.soldOut })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'White · PLA' })).toHaveAttribute('href');
});

it('rebuilds links from effective choices, drops stale pairs and preserves campaign, coupon and test context in order', async () => {
  window.history.replaceState(null, '', '/offer/stand-offer?variant=stale.bad&code=SAVE&checkout=together&test_purchase=1&utm_source=newsletter&extra=drop');
  serve({ ...offer, lines: [{ ...line, productId: 'white', name: 'White stand' }, { ...line, baseProductId: 'guide', productId: 'guide-v2', name: 'Guide', variants: [] }] });
  renderOffer();
  const nav = await screen.findByRole('navigation', { name: 'Variant: White stand' });
  expect(within(nav).getByRole('link', { name: 'Black' })).toHaveAttribute('href', '/offer/stand-offer?utm_source=newsletter&checkout=together&code=SAVE&test_purchase=1&variant=guide.guide-v2');
});

it.each(['simulate', 'checkout', 'coupon', 'auto-coupon'] as const)('passes effective choices with the first base identity to %s', async (mode) => {
  window.history.replaceState(null, '', `/offer/stand-offer?checkout=together&variant=black.white${mode === 'auto-coupon' ? '&code=SAVE' : ''}`);
  let query: string[] = [];
  let payload: unknown;
  const path = mode === 'simulate' ? '/api/dev/simulate-purchase' : mode === 'checkout' ? '/api/public/checkout/session' : '/api/public/checkout/coupon';
  server.use(
    http.get('/api/public/sales-links/:slug', ({ request }) => {
      query = new URL(request.url).searchParams.getAll('variant');
      return HttpResponse.json({ ok: true, data: { ...offer, lines: [{ ...line, productId: 'white', name: 'White stand' }, offer.lines[1]] } });
    }),
    http.get('/api/public/payment-config', () => HttpResponse.json({ ok: true, data: { stripeConfigured: mode !== 'simulate', simulatedPaymentsEnabled: mode === 'simulate' } })),
    http.post(path, async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Invalid sales link selection' } }, { status: 400 });
    }),
  );
  renderOffer();
  await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.test');
  expect(query).toEqual(['black.white']);
  if (mode === 'coupon') {
    await userEvent.click(screen.getByRole('button', { name: en.checkout.couponReveal }));
    await userEvent.type(screen.getByLabelText(en.checkout.couponLabel), 'SAVE');
    await userEvent.click(screen.getByRole('button', { name: en.checkout.couponApply }));
  } else if (mode !== 'auto-coupon') {
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: en.salesLinks.buyBundle }));
  }
  await waitFor(() => expect(payload).toMatchObject({ productId: 'black', salesLinkSlug: 'stand-offer', variantSelections: [{ productId: 'black', variantProductId: 'white' }] }));
  expect(await screen.findByRole('alert')).toBeVisible();
});

it('omits the selection payload when no line was swapped', async () => {
  let payload: unknown;
  server.use(http.post('/api/dev/simulate-purchase', async ({ request }) => {
    payload = await request.json();
    return HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Unavailable' } }, { status: 400 });
  }));
  renderOffer();
  await userEvent.type(await screen.findByLabelText(en.checkout.emailLabel), 'buyer@example.test');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: en.salesLinks.buyBundle }));
  await waitFor(() => expect(payload).toMatchObject({ productId: 'black' }));
  expect(payload).not.toHaveProperty('variantSelections');
});

it('retains all variant parameters on both cancellation retry paths', async () => {
  window.history.replaceState(null, '', '/offer/stand-offer?status=cancelled&variant=black.white&variant=guide.guide-v2');
  const first = renderOffer();
  expect(await screen.findByRole('link', { name: en.checkout.retry })).toHaveAttribute('href', '/offer/stand-offer?variant=black.white&variant=guide.guide-v2');
  first.unmount();
  window.history.replaceState(null, '', '/offer/stand-offer?status=cancelled&checkout=together&variant=black.white');
  renderOffer();
  await userEvent.click(await screen.findByRole('button', { name: en.checkout.retry }));
  expect(window.location.search).toBe('?checkout=together&variant=black.white');
  expect(await screen.findByRole('navigation', { name: 'Variant: Printed stand' })).toBeVisible();
});
