import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server } from '../../test/server.js';
import { sampleSalesLink } from '../../test/sales-link-fixtures.js';
import { CheckoutPage } from './CheckoutPage.js';

const exactly = (value: string) => new RegExp(`^${value}$`, 'u');
const stacked = (...parts: string[]) => parts.join('');
const mediaDisplays = (element: Element): string[] => {
  const classes = [...element.classList].filter((name) => name.startsWith('css-'));
  return Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
    .flatMap((rule) => Array.from(rule.cssRules))
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && classes.some((name) => rule.selectorText.includes(name)))
    .map((rule) => rule.style.display)
    .filter((display) => display !== '');
};

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
    anonymousMe(),
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

  it('shows the manufacturer, the model and the warnings of a physical product without a click and keeps the batch and instructions behind Details', async () => {
    serve([product('black', { compliance })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    expect(within(section).getByRole('heading', { name: en.productSafety.offerHeading })).toBeVisible();
    const line = within(section).getByTestId('product-safety-manufacturer');
    expect(line).toHaveTextContent(stacked('Example Workshop', 'Example Street 1, Warsaw', 'safety@example.com'));
    expect(line).not.toHaveTextContent(en.productSafety.appliesTo({ count: 1 }));
    for (const part of ['Example Workshop', 'Example Street 1, Warsaw', 'safety@example.com']) {
      expect(within(line).getByText(exactly(part)).closest('span')).toHaveTextContent(exactly(part));
    }
    expect(within(section).getByRole('link', { name: 'safety@example.com' })).toHaveAttribute('href', 'mailto:safety@example.com');
    const identity = within(line).getByTestId('product-safety-product-black');
    expect(identity).toHaveTextContent(`${en.productSafety.model}: STAND-1`);
    expect(within(identity).getByText('STAND-1')).toBeVisible();
    expect(within(identity).getByText('open flame')).toBeVisible();
    expect(within(identity).getByText('open flame').tagName).toBe('STRONG');
    expect(within(identity).queryByRole('button', { name: en.productSafety.showMore })).toBeNull();
    expect(within(section).getByText('B-2026-11')).not.toBeVisible();
    expect(within(section).getByRole('link', { name: en.productSafety.instructions, hidden: true })).not.toBeVisible();
    const details = within(section).getByRole('button', { name: en.productSafety.detailsFor({ name: 'Example Workshop' }) });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(details.getAttribute('aria-controls') ?? '')).toBeVisible();
    expect(within(section).getByText('STAND-1')).toBeVisible();
    expect(within(section).getByText('B-2026-11')).toBeVisible();
    expect(within(section).getByRole('link', { name: en.productSafety.instructions })).toHaveAttribute('href', 'https://example.com/manual.pdf');
    expect(section.compareDocumentPosition(screen.getByTestId('checkout-pay-cta')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('stacks the manufacturer parts on their own lines without separators at every width and puts the Details toggle after the product rows, directly above its panel', async () => {
    serve([product('black', { compliance })]);
    renderCheckout('stand-black');
    const line = within(await screen.findByTestId('product-safety-info')).getByTestId('product-safety-manufacturer');
    for (const part of ['Example Workshop', 'Example Street 1, Warsaw', 'safety@example.com']) {
      const element = within(line).getByText(exactly(part)).closest('span');
      if (element === null) throw new Error(`expected ${part} in its own part`);
      expect(element).toHaveStyle({ display: 'block' });
      expect(mediaDisplays(element)).toEqual([]);
    }
    expect(line.textContent).not.toContain('·');
    const toggle = within(line).getByRole('button', { name: en.productSafety.detailsFor({ name: 'Example Workshop' }) });
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.nextElementSibling).toBe(panel);
    const row = within(line).getByTestId('product-safety-product-black');
    expect(row.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(line).getByRole('link', { name: 'safety@example.com' }).compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.querySelectorAll('svg')).toHaveLength(1);
  });

  it('draws the focus ring of an inline toggle inside its own box, clear of the text beside it', async () => {
    serve([product('black', { compliance })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    const toggle = within(section).getByRole('button', { name: en.productSafety.detailsFor({ name: 'Example Workshop' }) });
    expect(toggle).toHaveStyle({ paddingLeft: '0.25rem', paddingRight: '0.25rem', marginLeft: '-0.25rem', marginRight: '-0.25rem' });
    toggle.classList.add('Mui-focusVisible');
    expect(toggle).toHaveStyle({ outlineOffset: '-2px' });
  });

  it('shows the same compact block for other product types', async () => {
    serve([product('black', { type: 'digital_download', compliance })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    expect(within(section).getByTestId('product-safety-manufacturer')).toHaveTextContent(stacked('Example Workshop', 'Example Street 1, Warsaw', 'safety@example.com'));
    expect(within(section).getByText('STAND-1')).toBeVisible();
    expect(within(section).getByText('B-2026-11')).not.toBeVisible();
    await userEvent.click(within(section).getByRole('button', { name: en.productSafety.detailsFor({ name: 'Example Workshop' }) }));
    expect(await within(section).findByText('B-2026-11')).toBeVisible();
  });

  it('shows a small picture of the product next to its model line when the product has a cover', async () => {
    serve([product('black', { compliance, coverUrl: 'https://cdn.example.com/stand.jpg' })]);
    renderCheckout('stand-black');
    const identity = within(await screen.findByTestId('product-safety-info')).getByTestId('product-safety-product-black');
    const picture = within(identity).getByRole('img', { name: 'Printed stand black' });
    expect(picture).toBeVisible();
    expect(picture).toHaveAttribute('src', 'https://cdn.example.com/stand.jpg');
    expect(picture).toHaveAttribute('width', '40');
    expect(picture.parentElement).toBe(identity);
    expect(picture.compareDocumentPosition(within(identity).getByText('STAND-1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no picture and no warning text when the product has neither a cover nor warnings', async () => {
    serve([product('black', { compliance: { ...compliance, safetyWarnings: '', safetyWarningsHtml: '' } })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    expect(within(section).getByText('STAND-1')).toBeVisible();
    expect(within(section).queryByTestId('product-safety-warnings')).toBeNull();
    expect(within(section).queryByTestId('product-safety-picture')).toBeNull();
    expect(within(section).queryByRole('button', { name: en.productSafety.showMore })).toBeNull();
  });

  it('shows the start of a long warning without a click and lets Show more extend the same text', async () => {
    const longWarning = `Keep away from open flame. ${'Do not leave the stand in direct sunlight for long periods. '.repeat(6)}Recycle the packaging.`;
    serve([product('black', { compliance: { ...compliance, safetyWarnings: longWarning, safetyWarningsHtml: `<p>${longWarning}</p>` } })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    const warning = within(section).getByTestId('product-safety-warnings');
    expect(warning).toBeVisible();
    expect(warning).toHaveTextContent(/^Keep away from open flame\./u);
    expect(warning).toHaveTextContent('Recycle the packaging.');
    const more = within(section).getByRole('button', { name: en.productSafety.showMore });
    const clamp = document.getElementById(more.getAttribute('aria-controls') ?? '');
    expect(clamp).toContainElement(warning);
    expect(clamp).toHaveStyle({ overflow: 'hidden' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(within(section).getByRole('button', { name: en.productSafety.showLess })).toHaveAttribute('aria-expanded', 'true');
    expect(clamp).not.toHaveStyle({ overflow: 'hidden' });
    expect(within(section).getByTestId('product-safety-warnings')).toBe(warning);
  });

  it('ends a clamped warning on a line boundary by dropping the gap between its paragraphs until it is expanded', async () => {
    const paragraphs = ['Keep away from open flame.', `${'Do not leave the stand in direct sunlight for long periods. '.repeat(5)}`, 'Recycle the packaging.'];
    const longWarning = paragraphs.join('\n\n');
    serve([product('black', { compliance: { ...compliance, safetyWarnings: longWarning, safetyWarningsHtml: paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('') } })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    const second = within(section).getByText(/^Do not leave the stand/u);
    expect(second.tagName).toBe('P');
    expect(second).toHaveStyle({ marginTop: '0px' });
    await userEvent.click(within(section).getByRole('button', { name: en.productSafety.showMore }));
    expect(second).toHaveStyle({ marginTop: '0.5em' });
    await userEvent.click(within(section).getByRole('button', { name: en.productSafety.showLess }));
    expect(second).toHaveStyle({ marginTop: '0px' });
  });

  it('offers no Details toggle when a product has nothing beyond the visible minimum', async () => {
    serve([product('black', { compliance: { ...compliance, batchIdentifier: null, instructionsUrl: null } })]);
    renderCheckout('stand-black');
    const section = await screen.findByTestId('product-safety-info');
    expect(within(section).getByText('STAND-1')).toBeVisible();
    expect(within(section).getByText('open flame')).toBeVisible();
    expect(within(section).queryByRole('button', { name: en.productSafety.detailsFor({ name: 'Example Workshop' }) })).toBeNull();
  });

  it('renders no safety section without safety information', async () => {
    serve([product('black')]);
    renderCheckout('stand-black');
    expect(await screen.findByRole('heading', { name: 'Printed stand black' })).toBeVisible();
    expect(screen.getByTestId('checkout-pay-cta')).toBeInTheDocument();
    expect(screen.queryByTestId('product-safety-info')).toBeNull();
  });
});

describe('sales-link product safety information', () => {
  const line = (productId: string, name: string, type: string, lineCompliance: unknown) => ({
    productId, name, type, deliveryMethod: 'pickup', compliance: lineCompliance, grossCents: 4900, netCents: 4667, vatCents: 233, vatRate: 5, vatExemptionBasis: null,
  });
  const serveLink = (lines: unknown[]) => {
    server.use(
      anonymousMe(),
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

  it('shows the manufacturer line of a single-product sales link without a product count or title', async () => {
    serveLink([line('black', 'Printed stand', 'physical', compliance)]);
    renderLink();
    const section = await screen.findByTestId('product-safety-info');
    expect(within(section).getByRole('heading', { name: en.productSafety.offerHeading })).toBeVisible();
    expect(within(section).getByTestId('product-safety-manufacturer')).not.toHaveTextContent(en.productSafety.appliesTo({ count: 1 }));
    expect(within(section).getByText('STAND-1')).toBeVisible();
    expect(within(section).getByText('open flame')).toBeVisible();
    await userEvent.click(within(section).getByRole('button', { name: en.productSafety.detailsFor({ name: 'Example Workshop' }) }));
    expect(within(section).getByText('B-2026-11')).toBeVisible();
    expect(within(section).queryByText('Printed stand')).toBeNull();
  });

  it('shares one line between products with identical manufacturer data, names each product with its model, picture and warnings without a click and lists the extras behind Details', async () => {
    const other = { ...compliance, manufacturerName: 'Other Works', manufacturerEmail: 'hello@other.example', modelIdentifier: 'BOOK-1', batchIdentifier: null, instructionsUrl: null, safetyWarningsHtml: '' };
    serveLink([
      { ...line('black', 'Printed stand', 'physical', compliance), coverUrl: 'https://cdn.example.com/stand.jpg' },
      line('guide', 'Assembly guide', 'digital_download', null),
      line('lamp', 'Printed lamp', 'physical', { ...compliance, modelIdentifier: 'LAMP-1', batchIdentifier: null, instructionsUrl: null, safetyWarningsHtml: '<p>Do not cover the <em>shade</em>.</p>' }),
      line('book', 'Printed book', 'physical', other),
    ]);
    renderLink();
    const section = await screen.findByTestId('product-safety-info');
    expect(screen.getAllByTestId('product-safety-info')).toHaveLength(1);
    const [shared, single, ...rest] = within(section).getAllByTestId('product-safety-manufacturer');
    if (shared === undefined || single === undefined) throw new Error('expected two manufacturer lines');
    expect(rest).toEqual([]);
    expect(shared).toHaveTextContent(stacked('Example Workshop', 'Example Street 1, Warsaw', 'safety@example.com', en.productSafety.appliesTo({ count: 2 })));
    expect(single).toHaveTextContent(stacked('Other Works', 'Example Street 1, Warsaw', 'hello@other.example', en.productSafety.appliesTo({ count: 1 })));
    const stand = within(shared).getByTestId('product-safety-product-black');
    const lamp = within(shared).getByTestId('product-safety-product-lamp');
    expect(within(stand).getByText('Printed stand')).toBeVisible();
    expect(within(stand).getByText('STAND-1')).toBeVisible();
    expect(within(stand).getByText('open flame').tagName).toBe('STRONG');
    expect(within(stand).getByRole('img', { name: 'Printed stand' })).toHaveAttribute('src', 'https://cdn.example.com/stand.jpg');
    expect(within(lamp).getByText('Printed lamp')).toBeVisible();
    expect(within(lamp).getByText('LAMP-1')).toBeVisible();
    expect(within(lamp).getByText('shade').tagName).toBe('EM');
    expect(within(lamp).queryByRole('img')).toBeNull();
    expect(within(single).getByText('BOOK-1')).toBeVisible();
    expect(within(single).queryByTestId('product-safety-warnings')).toBeNull();
    expect(within(single).queryByRole('button', { name: en.productSafety.detailsFor({ name: 'Other Works' }) })).toBeNull();

    const toggle = within(shared).getByRole('button', { name: en.productSafety.detailsFor({ name: 'Example Workshop' }) });
    expect(toggle).toHaveTextContent(en.productSafety.details);
    expect(within(shared).getByText('B-2026-11')).not.toBeVisible();
    await userEvent.click(toggle);
    const standExtras = within(shared).getByTestId('product-safety-details-black');
    expect(within(standExtras).queryByText('Printed stand')).toBeNull();
    expect(within(standExtras).getByText('B-2026-11')).toBeVisible();
    expect(within(standExtras).getByRole('link', { name: en.productSafety.instructions })).toHaveAttribute('href', 'https://example.com/manual.pdf');
    expect(within(shared).queryByTestId('product-safety-details-lamp')).toBeNull();
  });

  it('names each product inside the Details panel only when more than one product of the group has extras', async () => {
    serveLink([
      line('black', 'Printed stand', 'physical', compliance),
      line('lamp', 'Printed lamp', 'physical', { ...compliance, modelIdentifier: 'LAMP-1', batchIdentifier: 'L-7' }),
    ]);
    renderLink();
    const shared = within(await screen.findByTestId('product-safety-info')).getByTestId('product-safety-manufacturer');
    await userEvent.click(within(shared).getByRole('button', { name: en.productSafety.detailsFor({ name: 'Example Workshop' }) }));
    expect(within(within(shared).getByTestId('product-safety-details-black')).getByText('Printed stand')).toBeVisible();
    expect(within(within(shared).getByTestId('product-safety-details-lamp')).getByText('Printed lamp')).toBeVisible();
  });

  it('keeps an empty picture slot hidden from assistive technology in rows without a picture when another product of the group has one', async () => {
    const other = { ...compliance, manufacturerName: 'Other Works', manufacturerEmail: 'hello@other.example' };
    serveLink([
      { ...line('black', 'Printed stand', 'physical', compliance), coverUrl: 'https://cdn.example.com/stand.jpg' },
      { ...line('lamp', 'Printed lamp', 'physical', { ...compliance, modelIdentifier: 'LAMP-1' }), coverUrl: null },
      { ...line('book', 'Printed book', 'physical', other), coverUrl: null },
    ]);
    renderLink();
    const section = await screen.findByTestId('product-safety-info');
    const lamp = within(section).getByTestId('product-safety-product-lamp');
    const slot = within(lamp).getByTestId('product-safety-picture-slot');
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    expect(slot).toHaveStyle({ width: '2.5rem', flexShrink: '0' });
    expect(slot.parentElement).toBe(lamp);
    expect(within(lamp).queryByRole('img')).toBeNull();
    expect(within(within(section).getByTestId('product-safety-product-black')).queryByTestId('product-safety-picture-slot')).toBeNull();
    expect(within(within(section).getByTestId('product-safety-product-book')).queryByTestId('product-safety-picture-slot')).toBeNull();
  });

  it('spaces several manufacturers apart and names each one in the primary text colour', async () => {
    const other = { ...compliance, manufacturerName: 'Other Works', manufacturerEmail: 'hello@other.example' };
    serveLink([line('black', 'Printed stand', 'physical', compliance), line('book', 'Printed book', 'physical', other)]);
    renderLink();
    const [first, second] = within(await screen.findByTestId('product-safety-info')).getAllByTestId('product-safety-manufacturer');
    if (first === undefined || second === undefined) throw new Error('expected two manufacturer lines');
    expect(first.parentElement).toBe(second.parentElement);
    expect(first.parentElement).toHaveStyle({ gap: '0.75rem' });
    const name = within(first).getByText(exactly('Example Workshop'));
    const address = within(first).getByText(exactly('Example Street 1, Warsaw'));
    expect(name).toHaveStyle({ fontWeight: '500' });
    expect(getComputedStyle(name).color).not.toBe(getComputedStyle(address).color);
  });

  it('keeps a single manufacturer name in the line colour', async () => {
    serveLink([line('black', 'Printed stand', 'physical', compliance)]);
    renderLink();
    const manufacturer = within(await screen.findByTestId('product-safety-info')).getByTestId('product-safety-manufacturer');
    const name = within(manufacturer).getByText(exactly('Example Workshop'));
    expect(getComputedStyle(name).color).toBe(getComputedStyle(within(manufacturer).getByText(exactly('Example Street 1, Warsaw'))).color);
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
    expect(chips.parentElement?.firstElementChild).toHaveTextContent(exactly(en.productVariants.offerLabel));
    expect(within(chips).getByTestId('product-variant-black')).toHaveAttribute('aria-current', 'page');
    expect(within(chips).getByRole('link', { name: 'White · PLA' })).toHaveAttribute('href', '/checkout/stand-white?utm_source=newsletter');
    const soldOut = within(chips).getByTestId('product-variant-red');
    expect(soldOut).toHaveTextContent(`Red · PETG · ${en.productVariants.soldOut}`);
    expect(soldOut).toHaveClass('Mui-disabled');
    expect(within(chips).queryByRole('link', { name: /Red/ })).toBeNull();
    expect(screen.getByTestId('checkout-summary').compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chips.compareDocumentPosition(screen.getByTestId('checkout-pay-cta')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no chips without at least two variants', async () => {
    serve([product('black', { variants: variants.slice(0, 1) })]);
    renderCheckout('stand-black');
    expect(await screen.findByRole('heading', { name: 'Printed stand black' })).toBeVisible();
    expect(screen.queryByTestId('product-variants')).toBeNull();
  });
});
