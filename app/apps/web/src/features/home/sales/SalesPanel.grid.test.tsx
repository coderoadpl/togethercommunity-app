import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listLayoutSchema, type ListLayout, type OrderListItem } from '#core/domain/index.js';
import { z } from 'zod';

import { en } from '../../../i18n/en.js';
import { LanguageProvider } from '../../../i18n/index.js';
import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider, type PanelContextValue } from '../panel-context.js';
import { SalesPanel } from './SalesPanel.js';

const billing = (nip: string | null) => ({ nip, companyName: 'Sample buyer', address: 'Main Street 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' });

const issuedInvoice = (orderId: string) => ({
  id: `invoice-${orderId}`, tenantId: 't1', orderId, status: 'issued' as const, provider: 'ifirma' as const, providerInvoiceId: '1', invoiceNumber: 'FV/1',
  pdfUrl: null, error: null, issuedAt: '2026-11-20T10:00:00.000Z', createdAt: '2026-11-20T10:00:00.000Z',
});

const order = (id: string, overrides: Partial<OrderListItem> = {}): OrderListItem => ({
  id, tenantId: 't1', memberId: 'm1', productId: 'p1', priceId: null, kind: 'one_time', status: 'paid', amountCents: 4900,
  currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0, couponCode: null,
  createdAt: '2026-11-20T10:00:00.000Z', memberEmail: `${id}@example.com`, memberName: null, productTitle: 'Workshop', mode: 'live',
  ...overrides,
});

const orders = [
  order('issued', { billing: billing('5555555555') }),
  order('company', { billing: billing('5555555555'), invoice: null }),
  order('private', { billing: billing(null) }),
  order('nobilling', { billing: null }),
];

const savedLayout: ListLayout = {
  version: 1,
  columns: [
    { field: 'amount', visible: true, width: 150 },
    { field: 'legacy', visible: true },
    { field: 'date', visible: true },
    { field: 'member', visible: true },
    { field: 'product', visible: true },
    { field: 'kind', visible: false },
    { field: 'coupon', visible: false },
    { field: 'source', visible: false },
    { field: 'status', visible: true },
    { field: 'fulfilment', visible: false },
    { field: 'invoice', visible: true },
  ],
  sort: { field: 'amount', direction: 'asc' },
  filters: { status: 'paid', legacy: 'x' },
};

const ownerContext: PanelContextValue = { tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: 'm1' }, email: 'owner@example.com', emailVerified: true };

interface Recorded { list: URLSearchParams[]; exports: URLSearchParams[]; saves: unknown[]; resets: number }

const serve = (layout: ListLayout | null, rows: OrderListItem[] = orders): Recorded => {
  const recorded: Recorded = { list: [], exports: [], saves: [], resets: 0 };
  server.use(
    http.get('/api/panel/list-layouts/orders', () => HttpResponse.json({ ok: true, data: { layout } })),
    http.put('/api/panel/list-layouts/orders', async ({ request }) => {
      const body: unknown = await request.json();
      recorded.saves.push(body);
      return HttpResponse.json({ ok: true, data: body });
    }),
    http.delete('/api/panel/list-layouts/orders', () => { recorded.resets += 1; return HttpResponse.json({ ok: true, data: { reset: true } }); }),
    http.get('/api/orders', ({ request }) => {
      const params = new URL(request.url).searchParams;
      recorded.list.push(params);
      const filtered = params.get('billing') === 'requested' ? rows.filter((row) => row.billing != null) : rows;
      return HttpResponse.json({ ok: true, data: { orders: filtered, total: filtered.length, page: 1, pageSize: 25, sources: [] } });
    }),
    http.get('/api/orders/export', ({ request }) => {
      recorded.exports.push(new URL(request.url).searchParams);
      return HttpResponse.json({ ok: true, data: { filename: 'sales.csv', mimeType: 'text/csv', content: 'date' } });
    }),
  );
  return recorded;
};

const render = async ({ path = '/panel/sales', language = 'en', context = ownerContext }: { path?: string; language?: 'en' | 'pl'; context?: PanelContextValue } = {}) => {
  window.localStorage.setItem('together-language', language);
  const rootRoute = createRootRoute();
  const route = createRoute({ getParentRoute: () => rootRoute, path: '/panel/sales', component: SalesPanel });
  const router = createRouter({ routeTree: rootRoute.addChildren([route]), history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  const rendered = renderWithProviders(<LanguageProvider><PanelContextProvider value={context}><RouterProvider router={router} /></PanelContextProvider></LanguageProvider>);
  return { ...rendered, router };
};

const headers = () => within(screen.getByTestId('sales-grid')).getAllByRole('columnheader', { hidden: true }).map((header) => header.textContent);

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }));
  server.use(
    http.get('/api/orders/consumer-sales-summary', ({ request }) => {
      const params = new URL(request.url).searchParams;
      return HttpResponse.json({ ok: true, data: { from: params.get('from'), to: params.get('to'), timezone: 'Europe/Warsaw', currency: 'PLN', rates: [], totals: { orderCount: 0, lineCount: 0, netCents: 0, vatCents: 0, grossCents: 0 }, orderIds: [], orders: [] } });
    }),
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
    http.get('/api/coupons/options', () => HttpResponse.json({ ok: true, data: { coupons: [] } })),
    http.get('/api/orders/reconciliation', () => HttpResponse.json({ ok: true, data: { rows: [], checkedThrough: '2026-11-20T10:00:00.000Z' } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('orders grid', () => {
  it('shows the invoice state, never empty, and the invoice data the buyer asked for', async () => {
    serve(null, orders.map((row) => (row.id === 'issued' ? { ...row, invoice: issuedInvoice(row.id) } : row)));
    await render();
    const rows = await screen.findAllByTestId('sales-row');
    expect(rows.map((row) => within(row).getByTestId('sales-invoice-state').textContent))
      .toEqual([en.sales.invoiceStatuses.issued, en.sales.noInvoice, en.sales.noInvoice, en.sales.noInvoice]);
    expect(rows.map((row) => within(row).getByTestId('sales-billing-state').textContent))
      .toEqual([en.sales.billings.company, en.sales.billings.company, en.sales.billings.private, en.sales.billings.none]);
    expect(within(rows[1] ?? document.body).getByTestId('sales-invoice-state')).toHaveAccessibleDescription(en.sales.noInvoiceHint);
    expect(within(rows[2] ?? document.body).getByTestId('sales-billing-state')).toHaveAccessibleDescription(en.sales.billingHints.private);
    expect(screen.getByTestId('studio-grid-count')).toHaveTextContent(en.sales.orderCount({ count: 4 }));
  });

  it('applies the saved layout, drops an unknown column and filter, appends a new column, and sends the saved sort and filter', async () => {
    const recorded = serve(savedLayout);
    await render();
    await waitFor(() => expect(headers()).toContain(en.sales.amount));
    await waitFor(() => expect(headers().slice(1)).toEqual([
      en.sales.amount, en.sales.date, en.sales.member, en.sales.product, en.sales.status, en.sales.invoiceColumn, en.sales.invoiceData,
    ]));
    await waitFor(() => expect(recorded.list.at(-1)?.get('status')).toBe('paid'));
    expect(recorded.list.at(-1)?.get('sortBy')).toBe('amountCents');
    expect(recorded.list.at(-1)?.get('sortDirection')).toBe('asc');
    expect(recorded.list.at(-1)?.has('legacy')).toBe(false);
    expect(screen.getByRole('button', { name: en.dataGrid.removeFilter({ filter: `${en.sales.status}: ${en.sales.paid}` }) })).toBeInTheDocument();
  });

  it('lets the URL filters win over the saved ones and exports with exactly the grid filters and sort', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sales');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const recorded = serve(savedLayout);
    await render({ path: '/panel/sales?invoice=without&billing=company' });
    await waitFor(() => expect(recorded.list.at(-1)?.get('sortBy')).toBe('amountCents'));
    const last = recorded.list.at(-1);
    expect([last?.get('invoice'), last?.get('billing'), last?.get('status')]).toEqual(['without', 'company', null]);
    await userEvent.click(screen.getByTestId('sales-export-csv'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const exported = recorded.exports[0];
    expect([...(exported?.entries() ?? [])].sort()).toEqual([
      ['billing', 'company'], ['format', 'csv'], ['invoice', 'without'], ['sortBy', 'amountCents'], ['sortDirection', 'asc'],
    ]);
  });

  it('counts the orders bought with an invoice with one click and removes the chip from the keyboard', async () => {
    const user = userEvent.setup();
    const recorded = serve(null);
    const { router } = await render();
    await screen.findAllByTestId('sales-row');
    const quick = screen.getByRole('button', { name: en.sales.boughtWithInvoice });
    expect(quick).toHaveAttribute('aria-pressed', 'false');
    await user.click(quick);
    await waitFor(() => expect(recorded.list.at(-1)?.get('billing')).toBe('requested'));
    await waitFor(() => expect(screen.getByTestId('studio-grid-count')).toHaveTextContent(en.sales.orderCount({ count: 3 })));
    expect(router.state.location.search).toEqual({ billing: 'requested' });
    expect(screen.getByRole('button', { name: en.sales.boughtWithInvoice })).toHaveAttribute('aria-pressed', 'true');
    const chip = screen.getByRole('button', { name: en.dataGrid.removeFilter({ filter: `${en.sales.invoiceData}: ${en.sales.billingRequested}` }) });
    chip.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(recorded.list.at(-1)?.has('billing')).toBe(false));
    expect(screen.queryByRole('group', { name: en.dataGrid.activeFilters })).toBeNull();
    await waitFor(() => expect(recorded.saves.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(recorded.saves.at(-1)).toMatchObject({ layout: { filters: {} } });
  });

  it('filters from a column menu through a keyboard-operable popover', async () => {
    const user = userEvent.setup();
    const recorded = serve(null);
    await render();
    await screen.findAllByTestId('sales-row');
    const header = screen.getByRole('columnheader', { name: en.sales.invoiceColumn });
    await user.click(header);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await screen.findByRole('menuitem', { name: en.dataGrid.filter });
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: en.dataGrid.filter })).toHaveFocus());
    await user.keyboard('{Enter}');
    const popover = await screen.findByRole('dialog', { name: en.dataGrid.filterTitle({ column: en.sales.invoiceColumn }) });
    const select = within(popover).getByRole('combobox', { name: en.sales.invoiceColumn });
    select.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: en.sales.invoiceWithout }));
    await waitFor(() => expect(recorded.list.at(-1)?.get('invoice')).toBe('without'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: en.dataGrid.filterTitle({ column: en.sales.invoiceColumn }) })).toBeNull());
    expect(screen.getByRole('button', { name: en.dataGrid.removeFilter({ filter: `${en.sales.invoiceColumn}: ${en.sales.invoiceWithout}` }) })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.dataGrid.clearAll }));
    await waitFor(() => expect(recorded.list.at(-1)?.has('invoice')).toBe(false));
  });

  it('shows, hides and reorders columns from the keyboard, saves the layout and resets it', async () => {
    const user = userEvent.setup();
    const recorded = serve(null);
    await render();
    await screen.findAllByTestId('sales-row');
    screen.getByRole('button', { name: en.dataGrid.columns }).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: en.dataGrid.columnsDialogTitle });
    within(dialog).getByRole('checkbox', { name: en.sales.invoiceData }).focus();
    await user.keyboard(' ');
    await waitFor(() => expect(headers()).not.toContain(en.sales.invoiceData));
    within(dialog).getByRole('button', { name: en.dataGrid.moveUp({ column: en.sales.member }) }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(headers().slice(1, 3)).toEqual([en.sales.member, en.sales.date]));
    expect(within(dialog).getByRole('button', { name: en.dataGrid.moveUp({ column: en.sales.member }) })).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: en.dataGrid.moveDown({ column: en.sales.member }) })).toHaveFocus());
    expect(within(dialog).getByRole('button', { name: en.dataGrid.moveDown({ column: en.sales.invoiceData }) })).toBeDisabled();
    await waitFor(() => expect(recorded.saves.length).toBe(1), { timeout: 3000 });
    expect(recorded.saves[0]).toMatchObject({ layout: { version: 1, sort: null, filters: {} } });
    const savedColumns = z.object({ layout: listLayoutSchema }).parse(recorded.saves[0]).layout.columns;
    expect(savedColumns.slice(0, 2).map((column) => column.field)).toEqual(['member', 'date']);
    expect(savedColumns.find((column) => column.field === 'billing')?.visible).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: en.dataGrid.resetLayout }));
    await waitFor(() => expect(recorded.resets).toBe(1));
    await waitFor(() => expect(headers().slice(1, 3)).toEqual([en.sales.date, en.sales.member]));
    expect(headers()).toContain(en.sales.invoiceData);
  });

  it('keeps changes on screen without saving them while impersonating', async () => {
    const user = userEvent.setup();
    const recorded = serve(null);
    await render({ context: { ...ownerContext, impersonating: true } });
    await screen.findAllByTestId('sales-row');
    await user.click(screen.getByRole('button', { name: en.dataGrid.columns }));
    const dialog = await screen.findByRole('dialog', { name: en.dataGrid.columnsDialogTitle });
    await user.click(within(dialog).getByRole('checkbox', { name: en.sales.invoiceData }));
    await waitFor(() => expect(headers()).not.toContain(en.sales.invoiceData));
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    expect(recorded.saves).toEqual([]);
  });

  it('speaks Polish, with Polish plural forms of the count', async () => {
    serve(null);
    await render({ language: 'pl' });
    await screen.findAllByTestId('sales-row');
    expect(screen.getByTestId('studio-grid-count')).toHaveTextContent('4 zamówienia');
    expect(pl.sales.orderCount({ count: 1 })).toBe('1 zamówienie');
    expect(pl.sales.orderCount({ count: 5 })).toBe('5 zamówień');
    expect(pl.sales.orderCount({ count: 22 })).toBe('22 zamówienia');
    expect(screen.getByRole('columnheader', { name: pl.sales.invoiceData })).toBeInTheDocument();
    expect(screen.getAllByText(pl.sales.noInvoice).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Na fakturę' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.dataGrid.columns })).toBeInTheDocument();
  });
});
