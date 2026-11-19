import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SALES_LINK_TIME_ZONE, type OrderLinePersonalization, type OrderListItem } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { formatDateTime } from '../../../lib/format.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { sampleBundleOrder } from '../../../test/sales-link-fixtures.js';
import { PanelContextProvider, type PanelContextValue } from '../panel-context.js';
import { OrderDetailPage } from './OrderDetailPage.js';
import { OrderPersonalization } from './OrderPersonalization.js';
import { SalesPanel } from './SalesPanel.js';

const condition = 'I understand a personalised item is made to my order.';

const personalization: OrderLinePersonalization = {
  text: 'For Alex',
  label: 'Add an engraving',
  description: '',
  inputLabel: 'Engraving text',
  condition,
  maxLength: 20,
  requestedAt: '2026-11-05T23:30:00.000Z',
  conditionAcceptedAt: '2026-11-05T23:30:00.000Z',
};

const personalisedOrder = (line: OrderLinePersonalization = personalization): OrderListItem => ({
  ...sampleBundleOrder,
  id: 'o1',
  mode: 'live',
  lines: sampleBundleOrder.lines.map((orderLine, index) => index === 0 ? { ...orderLine, personalization: line } : orderLine),
});

const panelContext = { tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner' as const, memberId: 'm1' }, email: 'owner@example.com', emailVerified: true };

const renderAt = async (path: string, component: () => ReactElement, context: PanelContextValue = panelContext) => {
  const rootRoute = createRootRoute();
  const route = createRoute({ getParentRoute: () => rootRoute, path, component });
  const router = createRouter({ routeTree: rootRoute.addChildren([route]), history: createMemoryHistory({ initialEntries: [path.replace('$orderId', 'o1')] }) });
  await router.load();
  return renderWithProviders(<PanelContextProvider value={context}><RouterProvider router={router} /></PanelContextProvider>);
};

const warsaw = (value: string) => formatDateTime(value, 'en', SALES_LINK_TIME_ZONE);

describe('OrderPersonalization', () => {
  it('shows the text, the accepted condition and its acceptance time in the Warsaw time zone', () => {
    renderWithProviders(<OrderPersonalization personalization={personalization} testId="block" canCorrect={false} pending={false} error={null} onCorrect={vi.fn()} />);
    const block = screen.getByTestId('block');
    expect(within(block).getByText(en.personalization.heading)).toBeVisible();
    expect(within(block).getByText('Add an engraving')).toBeVisible();
    expect(screen.getByTestId('block-text')).toHaveTextContent('For Alex');
    expect(within(block).getByText(condition)).toBeVisible();
    expect(within(block).getByText(warsaw('2026-11-05T23:30:00.000Z'))).toBeVisible();
    expect(warsaw('2026-11-05T23:30:00.000Z')).toBe('6 Nov 2026, 00:30');
    expect(within(block).queryByText(en.personalization.originalText)).toBeNull();
    expect(within(block).queryByRole('button', { name: en.personalization.correct })).toBeNull();
  });

  it('shows the original text with who corrected it and when, and no condition rows without a condition', () => {
    renderWithProviders(<OrderPersonalization
      personalization={{ ...personalization, condition: null, conditionAcceptedAt: null, text: 'For Alexa', originalText: 'For Alex', editedAt: '2026-11-07T10:00:00.000Z', editedBy: 'staff-1' }}
      testId="block" canCorrect={false} pending={false} error={null} onCorrect={vi.fn()}
    />);
    const block = screen.getByTestId('block');
    expect(within(block).getByText(en.personalization.originalText)).toBeVisible();
    expect(within(block).getByText('For Alex')).toBeVisible();
    expect(within(block).getByText(warsaw('2026-11-07T10:00:00.000Z'))).toBeVisible();
    expect(within(block).getByText('staff-1')).toBeVisible();
    expect(within(block).queryByText(en.personalization.acceptedCondition)).toBeNull();
  });

  it('lets staff correct the text with the trimmed value and closes the form when it is saved', async () => {
    const user = userEvent.setup();
    const onCorrect = vi.fn((_text: string, done: () => void) => done());
    renderWithProviders(<OrderPersonalization personalization={personalization} testId="block" canCorrect pending={false} error={null} onCorrect={onCorrect} />);
    await user.click(screen.getByRole('button', { name: en.personalization.correct }));
    const input = screen.getByLabelText('Engraving text');
    const save = screen.getByRole('button', { name: en.personalization.saveCorrection });
    expect(input).toHaveValue('For Alex');
    expect(input).toHaveAttribute('maxlength', '20');
    expect(save).toBeDisabled();
    await user.clear(input);
    expect(save).toBeDisabled();
    await user.type(input, ' For Alexa ');
    expect(screen.getByText(en.personalization.characterCount({ count: 11, max: 20 }))).toBeVisible();
    await user.click(save);
    expect(onCorrect).toHaveBeenCalledWith('For Alexa', expect.any(Function));
    expect(screen.queryByLabelText('Engraving text')).toBeNull();
  });
});

describe('order personalisation in the panel', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/orders/consumer-sales-summary', ({ request }) => {
        const params = new URL(request.url).searchParams;
        return HttpResponse.json({ ok: true, data: { from: params.get('from'), to: params.get('to'), timezone: 'Europe/Warsaw', currency: 'PLN', rates: [], totals: { orderCount: 0, lineCount: 0, netCents: 0, vatCents: 0, grossCents: 0 }, orderIds: [], orders: [] } });
      }),
      http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
      http.get('/api/coupons/options', () => HttpResponse.json({ ok: true, data: { coupons: [] } })),
      http.get('/api/orders/reconciliation', () => HttpResponse.json({ ok: true, data: { rows: [], checkedThrough: '2026-07-28T10:00:00.000Z' } })),
      http.get('/api/download-copies', () => HttpResponse.json({ ok: true, data: { copies: [] } })),
    );
  });

  it('marks only personalised orders in the orders list', async () => {
    server.use(http.get('/api/orders', () => HttpResponse.json({ ok: true, data: {
      orders: [personalisedOrder(), { ...sampleBundleOrder, id: 'o2', mode: 'live' }], total: 2, page: 1, pageSize: 25, sources: [],
    } })));
    await renderAt('/panel/sales', SalesPanel);
    const rows = await screen.findAllByTestId('sales-row');
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    if (first === undefined || second === undefined) throw new Error('Expected two order rows');
    expect(within(first).getByTestId('sales-personalization-chip')).toHaveTextContent(en.personalization.marker);
    expect(within(second).queryByTestId('sales-personalization-chip')).toBeNull();
  });

  it('corrects the text of a personalised line from the order detail', async () => {
    let current = personalisedOrder();
    const bodies: unknown[] = [];
    server.use(
      http.get('/api/orders/o1', () => HttpResponse.json({ ok: true, data: { order: current, invoice: null } })),
      http.post('/api/orders/o1/personalization', async ({ request }) => {
        bodies.push(await request.json());
        current = personalisedOrder({ ...personalization, text: 'For Alexa', originalText: 'For Alex', editedAt: '2026-11-07T10:00:00.000Z', editedBy: 'staff-1' });
        return HttpResponse.json({ ok: true, data: { order: current } });
      }),
    );
    await renderAt('/panel/sales/$orderId', () => <OrderDetailPage orderId="o1" />);
    const block = await screen.findByTestId('order-personalization-product-1');
    expect(screen.queryByTestId('order-personalization-product-2')).toBeNull();
    await userEvent.click(within(block).getByRole('button', { name: en.personalization.correct }));
    const input = within(block).getByLabelText('Engraving text');
    await userEvent.clear(input);
    await userEvent.type(input, 'For Alexa');
    await userEvent.click(within(block).getByRole('button', { name: en.personalization.saveCorrection }));
    await waitFor(() => expect(bodies).toEqual([{ orderId: 'o1', productId: 'product-1', text: 'For Alexa' }]));
    expect(await within(block).findByText(en.personalization.originalText)).toBeVisible();
    expect(screen.getByTestId('order-personalization-product-1-text')).toHaveTextContent('For Alexa');
  });

  it('offers no correction to a viewer without order write access', async () => {
    server.use(http.get('/api/orders/o1', () => HttpResponse.json({ ok: true, data: { order: personalisedOrder(), invoice: null } })));
    await renderAt('/panel/sales/$orderId', () => <OrderDetailPage orderId="o1" />, { ...panelContext, tenant: { ...panelContext.tenant, staffRole: null } });
    const block = await screen.findByTestId('order-personalization-product-1');
    expect(within(block).getByText('For Alex')).toBeVisible();
    expect(within(block).queryByRole('button', { name: en.personalization.correct })).toBeNull();
  });
});
