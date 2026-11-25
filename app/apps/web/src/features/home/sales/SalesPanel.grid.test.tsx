import { act, fireEvent, render as renderReact, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listLayoutSchema, type ListLayout, type OrderListItem } from '#core/domain/index.js';
import { z } from 'zod';

import { loadStudioDataGrid, reloadStudioGridPage } from '../../../components/ui/data-grid/load-studio-data-grid.js';
import { en } from '../../../i18n/en.js';
import { LanguageProvider } from '../../../i18n/index.js';
import { pl } from '../../../i18n/pl.js';
import { clearListLayoutCopies } from '../../../theme-mode.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider, type PanelContextValue } from '../panel-context.js';
import { validateOrdersSearch } from './order-filters.js';
import { SalesPanel } from './SalesPanel.js';
import { heldInvoice } from './sales-test-fixtures.js';

vi.mock('../../../components/ui/data-grid/load-studio-data-grid.js', async (importOriginal) => {
  const actual = await importOriginal<{ loadStudioDataGrid: typeof loadStudioDataGrid }>();
  return { loadStudioDataGrid: vi.fn(actual.loadStudioDataGrid), reloadStudioGridPage: vi.fn() };
});

const gridLoader = vi.mocked(loadStudioDataGrid);

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

const ownerContext: PanelContextValue = { tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: 'm1' }, userId: 'u1', email: 'owner@example.com', emailVerified: true };

interface Recorded { list: URLSearchParams[]; exports: URLSearchParams[]; packing: URLSearchParams[]; saves: unknown[]; resets: number }

const serve = (layout: ListLayout | null, rows: OrderListItem[] = orders, total?: number): Recorded => {
  const recorded: Recorded = { list: [], exports: [], packing: [], saves: [], resets: 0 };
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
      return HttpResponse.json({ ok: true, data: { orders: filtered, total: total ?? filtered.length, page: Number(params.get('page') ?? 1), pageSize: 25, sources: [] } });
    }),
    http.get('/api/orders/export', ({ request }) => {
      recorded.exports.push(new URL(request.url).searchParams);
      return HttpResponse.json({ ok: true, data: { filename: 'sales.csv', mimeType: 'text/csv', content: 'date' } });
    }),
    http.get('/api/orders/packing-list', ({ request }) => {
      recorded.packing.push(new URL(request.url).searchParams);
      return HttpResponse.json({ ok: true, data: { filename: 'packing-list.csv', mimeType: 'text/csv', content: 'date' } });
    }),
  );
  return recorded;
};

const render = async ({ path = '/panel/sales', language = 'en', context = ownerContext }: { path?: string; language?: 'en' | 'pl'; context?: PanelContextValue } = {}) => {
  window.localStorage.setItem('together-language', language);
  const rootRoute = createRootRoute();
  const route = createRoute({ getParentRoute: () => rootRoute, path: '/panel/sales', validateSearch: validateOrdersSearch, component: SalesPanel });
  const router = createRouter({ routeTree: rootRoute.addChildren([route]), history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  const panel = (value: PanelContextValue) => <LanguageProvider><PanelContextProvider value={value}><RouterProvider router={router} /></PanelContextProvider></LanguageProvider>;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const withClient = (value: PanelContextValue) => <QueryClientProvider client={queryClient}>{panel(value)}</QueryClientProvider>;
  const rendered = renderReact(withClient(context));
  const switchContext = (value: PanelContextValue) => rendered.rerender(withClient(value));
  return { ...rendered, router, switchContext };
};

const headers = () => within(screen.getByTestId('sales-grid')).getAllByRole('columnheader', { hidden: true }).map((header) => header.textContent);

beforeEach(() => {
  gridLoader.mockReset();
  vi.mocked(reloadStudioGridPage).mockClear();
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
  it('shows a table skeleton while the grid module loads', async () => {
    let finishLoading: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { finishLoading = resolve; });
    gridLoader.mockImplementationOnce(async () => {
      await pending;
      return import('../../../components/ui/data-grid/StudioDataGrid.js');
    });
    serve(null);
    await render();
    expect(await screen.findByText(en.dataGrid.loading)).toBeInTheDocument();
    expect(screen.queryByTestId('sales-grid')).not.toBeInTheDocument();
    finishLoading();
    expect(await screen.findByTestId('sales-grid')).toBeInTheDocument();
    expect(screen.queryByText(en.dataGrid.loading)).not.toBeInTheDocument();
  });

  it('offers a full reload without changing the sales URL when the grid chunk is missing', async () => {
    const user = userEvent.setup();
    gridLoader.mockRejectedValue(new Error('Grid chunk unavailable'));
    serve(null);
    const { router } = await render({ language: 'pl', path: '/panel/sales?billing=company&search=buyer' });
    expect(await screen.findByText(pl.dataGrid.loadFailed)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: pl.dataGrid.reloadPage }));
    expect(reloadStudioGridPage).toHaveBeenCalledOnce();
    expect(gridLoader).toHaveBeenCalledOnce();
    expect(router.state.location.href).toBe('/panel/sales?billing=company&search=buyer');
  });

  it('renders phone cards without asking for the grid module', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width'), media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }));
    serve(null);
    await render();
    expect(await screen.findByTestId('sales-cards')).toBeInTheDocument();
    expect(gridLoader).not.toHaveBeenCalled();
  });

  it('shows the invoice state, never empty, and recorded billing data', async () => {
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
    expect(screen.queryAllByTestId('sales-billing-caption')).toEqual([]);
  });

  it('hides the billing data column below the widest screens and shows it as a caption under the invoice state', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width') && !query.includes('599'), media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }));
    const recorded = serve(null);
    await render();
    const rows = await screen.findAllByTestId('sales-row');
    expect(headers().slice(1)).toEqual([
      en.sales.date, en.sales.member, en.sales.product, en.sales.amount, en.sales.status, en.shipping.fulfilmentColumn, en.sales.invoiceColumn,
    ]);
    expect(screen.queryAllByTestId('sales-billing-state')).toEqual([]);
    expect(rows.map((row) => within(row).getByTestId('sales-billing-caption').textContent))
      .toEqual([en.sales.billings.company, en.sales.billings.company, en.sales.billings.private, en.sales.billings.none]);
    expect(within(rows[2] ?? document.body).getByTestId('sales-billing-caption')).toHaveAccessibleDescription(en.sales.billingHints.private);
    await user.click(screen.getByRole('columnheader', { name: en.sales.invoiceColumn }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.click(await screen.findByRole('menuitem', { name: en.dataGrid.filter }));
    const popover = await screen.findByRole('dialog', { name: en.dataGrid.filterTitle({ column: en.sales.invoiceColumn }) });
    within(popover).getByRole('combobox', { name: en.sales.invoiceData }).focus();
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: en.sales.billings.company }));
    await waitFor(() => expect(recorded.list.at(-1)?.get('billing')).toBe('company'));
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

  it('passes billing to sales exports in both-modes view but only mode and fulfilment to the packing list', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sales');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const recorded = serve(null);
    await render({ path: '/panel/sales?billing=company&fulfilmentStatus=to_pack' });
    await waitFor(() => expect(recorded.list.at(-1)?.get('billing')).toBe('company'));
    expect(recorded.list.at(-1)?.has('mode')).toBe(false);
    await userEvent.click(screen.getByTestId('sales-export-csv'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByTestId('sales-export-json'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    expect(screen.getByText(en.shipping.packingListFilterHint)).toBeVisible();
    await userEvent.click(screen.getByTestId('sales-packing-list'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(3));
    expect(recorded.exports.map((query) => [...query.entries()].sort())).toEqual([
      [['billing', 'company'], ['format', 'csv'], ['fulfilmentStatus', 'to_pack']],
      [['billing', 'company'], ['format', 'json'], ['fulfilmentStatus', 'to_pack']],
    ]);
    expect(recorded.packing.map((query) => [...query.entries()].sort())).toEqual([
      [['format', 'csv'], ['fulfilmentStatus', 'to_pack'], ['mode', 'live']],
    ]);
  });

  it('syncs same-route navigation and caps the search shared by the URL, request and export', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sales');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const recorded = serve(null, [order('held', { invoice: heldInvoice('held') })], 50);
    const { router } = await render({ path: '/panel/sales?search=old' });
    const search = await screen.findByTestId('sales-search');
    expect(search).toHaveValue('old');
    const next = await screen.findByRole('button', { name: 'Go to next page' });
    await user.click(next);
    await waitFor(() => expect(recorded.list.at(-1)?.get('page')).toBe('2'));
    const checkbox = await screen.findByRole('checkbox', { name: `${en.sales.sendSelectedToKsef}: held` });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await act(async () => { await router.navigate({ to: '/panel/sales', search: { search: 'new' } }); });
    expect(search).toHaveValue('new');
    expect(screen.getByRole('checkbox', { name: `${en.sales.sendSelectedToKsef}: held` })).not.toBeChecked();
    await waitFor(() => expect(recorded.list.at(-1)?.get('search')).toBe('new'));
    expect(recorded.list.at(-1)?.get('page')).toBe('1');

    const capped = 'x'.repeat(200);
    await user.clear(search);
    await user.paste(`  ${capped}extra  `);
    await waitFor(() => expect(recorded.list.at(-1)?.get('search')).toBe(capped));
    expect(router.state.location.search).toEqual({ search: capped });
    await user.click(screen.getByTestId('sales-export-csv'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(recorded.exports.at(-1)?.get('search')).toBe(capped);
  });

  it('counts orders with recorded billing data with one click and removes the chip from the keyboard', async () => {
    const user = userEvent.setup();
    const recorded = serve(null);
    const { router } = await render();
    await screen.findAllByTestId('sales-row');
    const quick = screen.getByRole('button', { name: en.sales.withBillingData });
    expect(quick).toHaveAttribute('aria-pressed', 'false');
    await user.click(quick);
    await waitFor(() => expect(recorded.list.at(-1)?.get('billing')).toBe('requested'));
    await waitFor(() => expect(screen.getByTestId('studio-grid-count')).toHaveTextContent(en.sales.orderCount({ count: 3 })));
    expect(router.state.location.search).toEqual({ billing: 'requested' });
    expect(screen.getByRole('button', { name: en.sales.withBillingData })).toHaveAttribute('aria-pressed', 'true');
    const chip = screen.getByRole('button', { name: en.dataGrid.removeFilter({ filter: `${en.sales.invoiceData}: ${en.sales.withBillingData}` }) });
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
    const { layout } = z.object({ layout: listLayoutSchema }).parse(recorded.saves[0]);
    const savedColumns = layout.columns;
    expect(savedColumns.slice(0, 2).map((column) => column.field)).toEqual(['member', 'date']);
    expect(savedColumns.find((column) => column.field === 'billing')?.visible).toBe(false);
    expect(window.localStorage.getItem('together-list-layout:orders:t1:u1')).toBe(JSON.stringify(layout));
    expect(Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))).not.toEqual(expect.arrayContaining([expect.stringContaining('@')]));
    await user.click(within(dialog).getByRole('button', { name: en.dataGrid.resetLayout }));
    await waitFor(() => expect(recorded.resets).toBe(1));
    await waitFor(() => expect(headers().slice(1, 3)).toEqual([en.sales.date, en.sales.member]));
    expect(headers()).toContain(en.sales.invoiceData);
    expect(window.localStorage.getItem('together-list-layout:orders:t1:u1')).toBeNull();
  });

  it('does not carry local state, cached queries or a pending save to another account in the same workspace', async () => {
    const user = userEvent.setup();
    const recorded = serve(null);
    let account = 'u1';
    let finishSecondRead: () => void = () => undefined;
    const secondRead = new Promise<void>((resolve) => { finishSecondRead = resolve; });
    const readers: string[] = [];
    server.use(http.get('/api/panel/list-layouts/orders', async () => {
      readers.push(account);
      if (account === 'u1') return HttpResponse.json({ ok: true, data: { layout: savedLayout } });
      await secondRead;
      return HttpResponse.json({ ok: true, data: { layout: null } });
    }));
    const { switchContext } = await render();
    await waitFor(() => expect(headers().slice(1, 3)).toEqual([en.sales.amount, en.sales.date]));
    await user.click(screen.getByRole('button', { name: en.dataGrid.columns }));
    const dialog = await screen.findByRole('dialog', { name: en.dataGrid.columnsDialogTitle });
    await user.click(within(dialog).getByRole('checkbox', { name: en.sales.date }));
    expect(headers()).not.toContain(en.sales.date);

    account = 'u2';
    switchContext({ ...ownerContext, userId: account });
    try {
      await waitFor(() => expect(readers).toEqual(['u1', 'u2']));
      await waitFor(() => expect(headers().slice(1, 3)).toEqual([en.sales.date, en.sales.member]));
      await waitFor(() => expect(recorded.list.at(-1)?.has('status')).toBe(false));
      await new Promise((resolve) => setTimeout(resolve, 850));
      expect(recorded.saves).toEqual([]);
    } finally {
      finishSecondRead();
    }
  });

  it('flushes a pending layout save when leaving the page before the debounce ends', async () => {
    const user = userEvent.setup();
    const recorded = serve(null);
    const { unmount } = await render();
    await screen.findByTestId('sales-grid');
    await user.click(screen.getByRole('button', { name: en.dataGrid.columns }));
    const dialog = await screen.findByRole('dialog', { name: en.dataGrid.columnsDialogTitle });
    const column = within(dialog).getByRole('checkbox', { name: en.sales.invoiceData });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(column);
      expect(recorded.saves).toEqual([]);
      unmount();
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(recorded.saves).toEqual([
      { layout: expect.objectContaining({ columns: expect.arrayContaining([{ field: 'billing', visible: false }]) }) },
    ]));
  });

  it('rejects a pending save when browser authentication changes before the panel account updates', async () => {
    const user = userEvent.setup();
    serve(null);
    let signedInUserId = 'u1';
    const stored = new Map<string, ListLayout>();
    const expectedAccounts: (string | null)[] = [];
    server.use(http.put('/api/panel/list-layouts/orders', async ({ request }) => {
      const expectedUserId = request.headers.get('X-Expected-User-Id');
      expectedAccounts.push(expectedUserId);
      if (expectedUserId !== signedInUserId) {
        return HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'The signed-in account changed' } }, { status: 409 });
      }
      const { layout } = z.object({ layout: listLayoutSchema }).parse(await request.json());
      stored.set(signedInUserId, layout);
      return HttpResponse.json({ ok: true, data: { layout } });
    }));
    await render();
    await screen.findByTestId('sales-grid');
    await user.click(screen.getByRole('button', { name: en.dataGrid.columns }));
    const dialog = await screen.findByRole('dialog', { name: en.dataGrid.columnsDialogTitle });
    await user.click(within(dialog).getByRole('checkbox', { name: en.sales.invoiceData }));
    signedInUserId = 'u2';
    expect(await screen.findByText(en.dataGrid.layoutSaveFailed({ message: en.errors.messageConflict }), {}, { timeout: 2000 })).toBeInTheDocument();
    expect(expectedAccounts).toEqual(['u1']);
    expect(stored.has('u2')).toBe(false);
  });

  it('finishes a reset after a delayed save and unmount, discarding a superseded queued save', async () => {
    const user = userEvent.setup();
    serve(null);
    let finishPut: () => void = () => undefined;
    const delayedPut = new Promise<void>((resolve) => { finishPut = resolve; });
    const operations: string[] = [];
    let stored: ListLayout | null = null;
    server.use(
      http.get('/api/panel/list-layouts/orders', () => HttpResponse.json({ ok: true, data: { layout: stored } })),
      http.put('/api/panel/list-layouts/orders', async ({ request }) => {
        const { layout } = z.object({ layout: listLayoutSchema }).parse(await request.json());
        operations.push('put');
        await delayedPut;
        stored = layout;
        return HttpResponse.json({ ok: true, data: { layout } });
      }),
      http.delete('/api/panel/list-layouts/orders', () => {
        operations.push('delete');
        stored = null;
        return HttpResponse.json({ ok: true, data: { reset: true } });
      }),
    );
    const { unmount } = await render();
    await screen.findByTestId('sales-grid');
    await user.click(screen.getByRole('button', { name: en.dataGrid.columns }));
    const dialog = await screen.findByRole('dialog', { name: en.dataGrid.columnsDialogTitle });
    try {
      await user.click(within(dialog).getByRole('checkbox', { name: en.sales.invoiceData }));
      await waitFor(() => expect(operations).toEqual(['put']), { timeout: 2000 });
      await user.click(within(dialog).getByRole('checkbox', { name: en.sales.coupon }));
      await new Promise((resolve) => setTimeout(resolve, 850));
      await user.click(within(dialog).getByRole('button', { name: en.dataGrid.resetLayout }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(operations).toEqual(['put']);
      unmount();
    } finally {
      finishPut();
    }
    await waitFor(() => expect(operations).toEqual(['put', 'delete']));
    expect(stored).toBeNull();
    await render();
    await waitFor(() => expect(headers()).toContain(en.sales.invoiceData));
  });

  it('drops a pending save when sign-out clears layout copies before unmount', async () => {
    const user = userEvent.setup();
    const recorded = serve(null);
    const { unmount } = await render();
    await screen.findByTestId('sales-grid');
    await user.click(screen.getByRole('button', { name: en.dataGrid.columns }));
    const dialog = await screen.findByRole('dialog', { name: en.dataGrid.columnsDialogTitle });
    await user.click(within(dialog).getByRole('checkbox', { name: en.sales.invoiceData }));
    expect(window.localStorage.getItem('together-list-layout:orders:t1:u1')).not.toBeNull();
    clearListLayoutCopies();
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 850));
    expect(recorded.saves).toEqual([]);
    expect(window.localStorage.getItem('together-list-layout:orders:t1:u1')).toBeNull();
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
    expect(window.localStorage.getItem('together-list-layout:orders:t1:u1')).toBeNull();
  });

  it('speaks Polish, with Polish plural forms of the count', async () => {
    serve(null);
    await render({ language: 'pl' });
    await screen.findAllByTestId('sales-row');
    expect(screen.getByTestId('studio-grid-count')).toHaveTextContent(pl.sales.orderCount({ count: 4 }));
    const countSuffix = (count: number) => pl.sales.orderCount({ count }).replace(/^\d+\s+/u, '');
    expect(new Set([1, 4, 5].map(countSuffix)).size).toBe(3);
    expect(countSuffix(22)).toBe(countSuffix(4));
    expect(countSuffix(12)).toBe(countSuffix(5));
    expect(screen.getByRole('columnheader', { name: pl.sales.invoiceData })).toBeInTheDocument();
    expect(screen.getAllByText(pl.sales.noInvoice).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: pl.sales.withBillingData })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.dataGrid.columns })).toBeInTheDocument();
  });
});
