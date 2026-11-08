import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrderListItem } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { sampleBundleOrder } from '../../../test/sales-link-fixtures.js';
import { PanelContextProvider } from '../panel-context.js';
import { OrderDetailPage } from './OrderDetailPage.js';
import { SalesPanel } from './SalesPanel.js';

const shipping = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23 as const, carrier: 'inpost' as const,
  pickupPoint: { provider: 'inpost' as const, code: 'WAW01M', name: null, address: null },
  address: { name: 'Alex Smith', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: null,
};

const order = (id: string, fulfilmentStatus: 'to_pack' | 'shipped' | null): OrderListItem => ({
  ...sampleBundleOrder, id, mode: 'live', shipping: fulfilmentStatus === null ? null : shipping, fulfilmentStatus,
});

const panelContext = { tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner' as const, memberId: 'm1' }, email: 'owner@example.com', emailVerified: true };

const renderAt = async (path: string, component: () => ReactElement) => {
  const rootRoute = createRootRoute();
  const route = createRoute({ getParentRoute: () => rootRoute, path, component });
  const router = createRouter({ routeTree: rootRoute.addChildren([route]), history: createMemoryHistory({ initialEntries: [path.replace('$orderId', 'o1')] }) });
  await router.load();
  return renderWithProviders(<PanelContextProvider value={panelContext}><RouterProvider router={router} /></PanelContextProvider>);
};

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sales fulfilment', () => {
  it('filters by fulfilment status, shows the fulfilment column and downloads the packing list', async () => {
    const listQueries: URLSearchParams[] = [];
    const packingQueries: URLSearchParams[] = [];
    server.use(
      http.get('/api/orders', ({ request }) => {
        const params = new URL(request.url).searchParams;
        listQueries.push(params);
        const orders = params.get('fulfilmentStatus') === 'to_pack' ? [order('o1', 'to_pack')] : [order('o1', 'to_pack'), order('o2', 'shipped'), order('o3', null)];
        return HttpResponse.json({ ok: true, data: { orders, total: orders.length, page: 1, pageSize: 25, sources: [] } });
      }),
      http.get('/api/orders/packing-list', ({ request }) => {
        packingQueries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ ok: true, data: { filename: 'packing-list-acme.csv', mimeType: 'text/csv; charset=utf-8', content: 'order_number' } });
      }),
    );
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:packing-list');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await renderAt('/panel/sales', SalesPanel);

    const chips = await screen.findAllByTestId('sales-fulfilment-chip');
    expect(chips.map((chip) => chip.textContent)).toEqual([en.shipping.fulfilmentStatuses.to_pack, en.shipping.fulfilmentStatuses.shipped]);
    expect(screen.getByRole('columnheader', { name: en.shipping.fulfilmentColumn })).toBeInTheDocument();
    expect(screen.queryByTestId('sales-packing-list')).toBeNull();

    await userEvent.click(screen.getByRole('combobox', { name: en.shipping.fulfilmentFilter }));
    await userEvent.click(await screen.findByRole('option', { name: en.shipping.fulfilmentStatuses.to_pack }));
    await waitFor(() => expect(listQueries.at(-1)?.get('fulfilmentStatus')).toBe('to_pack'));
    await waitFor(() => expect(screen.getAllByTestId('sales-row')).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: en.shipping.packingListDownload }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(packingQueries.map((params) => [params.get('format'), params.get('fulfilmentStatus'), params.get('mode')])).toEqual([['csv', 'to_pack', 'live']]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sales-packing-list-live-only')).toHaveTextContent(en.shipping.packingListLiveOnly);

    await userEvent.click(screen.getByRole('combobox', { name: en.sales.mode }));
    await userEvent.click(await screen.findByRole('option', { name: en.integrations.stripeTestMode }));
    await waitFor(() => expect(listQueries.at(-1)?.get('mode')).toBe('test'));
    await userEvent.click(await screen.findByRole('button', { name: en.shipping.packingListDownload }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    expect(packingQueries.at(-1)?.get('mode')).toBe('test');
    expect(screen.queryByTestId('sales-packing-list-live-only')).toBeNull();

    await userEvent.click(screen.getByRole('combobox', { name: en.sales.mode }));
    await userEvent.click(await screen.findByRole('option', { name: en.integrations.stripeLiveMode }));
    await waitFor(() => expect(listQueries.at(-1)?.get('mode')).toBe('live'));
    await userEvent.click(await screen.findByRole('button', { name: en.shipping.packingListDownload }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(3));
    expect(packingQueries.at(-1)?.get('mode')).toBe('live');
    expect(screen.queryByTestId('sales-packing-list-live-only')).toBeNull();
  });
});

describe('order detail shipment', () => {
  it('marks an order to pack as shipped and shows the shipment summary', async () => {
    let current: OrderListItem = order('o1', 'to_pack');
    const shipBodies: unknown[] = [];
    server.use(
      http.get('/api/orders/o1', () => HttpResponse.json({ ok: true, data: { order: current, invoice: null } })),
      http.post('/api/orders/o1/ship', async ({ request }) => {
        shipBodies.push(await request.json());
        current = {
          ...current, fulfilmentStatus: 'shipped',
          shipment: { carrier: 'inpost', trackingNumber: 'ABCD1234', shippedAt: '2026-11-05T09:30:00.000Z', shippedBy: 'staff-1', shippedByDisplayName: 'Jordan Smith' },
        };
        return HttpResponse.json({ ok: true, data: { order: current } });
      }),
    );
    await renderAt('/panel/sales/$orderId', () => <OrderDetailPage orderId="o1" />);

    const delivery = await screen.findByTestId('order-delivery');
    expect(screen.getByTestId('order-to-pack')).toHaveTextContent(en.shipping.fulfilmentStatuses.to_pack);
    await userEvent.type(within(delivery).getByLabelText(en.shipping.shipTracking), 'ABCD1234');
    await userEvent.click(within(delivery).getByRole('button', { name: en.shipping.markShipped }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en.shipping.shipConfirm }));

    await waitFor(() => expect(shipBodies).toEqual([{ orderId: 'o1', carrier: 'inpost', trackingNumber: 'ABCD1234' }]));
    expect(await screen.findByTestId('order-shipment')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ABCD1234' })).toHaveAttribute('href', 'https://inpost.pl/sledzenie-przesylek?number=ABCD1234');
    expect(screen.getByText('Jordan Smith')).toBeInTheDocument();
    expect(screen.getByTestId('order-shipped')).toHaveTextContent(en.shipping.fulfilmentStatuses.shipped);
  });

  it('downloads the InPost label through the API client and shows a JSON error instead of saving it', async () => {
    const shipment = {
      shipxShipmentId: '1001', status: 'confirmed', trackingNumber: '520000011395200025754311', environment: 'production', createAttemptedAt: null,
      boughtAt: '2026-11-08T10:00:00.000Z', labelFetchedAt: null, createdAt: '2026-11-08T10:00:00.000Z', updatedAt: '2026-11-08T10:00:00.000Z',
    };
    let labelAnswer: 'error' | 'pdf' = 'error';
    server.use(
      http.get('/api/orders/o1', () => HttpResponse.json({ ok: true, data: { order: order('o1', 'shipped'), invoice: null } })),
      http.get('/api/orders/o1/shipx', () => HttpResponse.json({ ok: true, data: { available: false, reason: 'not_to_pack', service: 'inpost_locker_standard', parcelTemplate: 'medium', shipment } })),
      http.get('/api/orders/o1/shipx/label', () => labelAnswer === 'error'
        ? HttpResponse.json({ ok: false, error: { code: 'shipx_rejected', message: 'InPost could not generate the label', details: { status: 400, error: 'label_generation_failed', description: 'Template error', fields: {} } } }, { status: 422 })
        : new HttpResponse(new TextEncoder().encode('%PDF-1.4'), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="inpost-520000011395200025754311.pdf"' } })),
    );
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:label');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await renderAt('/panel/sales/$orderId', () => <OrderDetailPage orderId="o1" />);

    await userEvent.click(await screen.findByRole('button', { name: en.shipx.printLabel }));
    expect(await screen.findByText('InPost: Template error')).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    labelAnswer = 'pdf';
    await userEvent.click(screen.getByRole('button', { name: en.shipx.printLabel }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('order-shipx-error')).toBeNull();
  });

  it('discards an unconfirmed InPost attempt and creates the shipment again', async () => {
    const calls: string[] = [];
    server.use(
      http.get('/api/orders/o1', () => HttpResponse.json({ ok: true, data: { order: { ...order('o1', 'to_pack'), memberEmail: 'buyer@example.org' }, invoice: null } })),
      http.get('/api/orders/o1/shipx', () => HttpResponse.json({
        ok: true,
        data: {
          available: true, reason: null, service: 'inpost_locker_standard', parcelTemplate: 'medium',
          shipment: calls.includes('discard') ? null : {
            shipxShipmentId: null, status: 'unknown', trackingNumber: null, environment: 'production', createAttemptedAt: '2026-11-08T09:55:00.000Z',
            boughtAt: null, labelFetchedAt: null, createdAt: '2026-11-08T09:55:00.000Z', updatedAt: '2026-11-08T09:55:00.000Z',
          },
        },
      })),
      http.post('/api/orders/o1/shipx/discard', () => {
        calls.push('discard');
        return HttpResponse.json({ ok: true, data: { discarded: true } });
      }),
      http.post('/api/orders/o1/shipx', () => {
        calls.push('create');
        return HttpResponse.json({ ok: false, error: { code: 'shipx_unavailable', message: 'InPost ShipX is unavailable; retry in a moment' } }, { status: 503 });
      }),
    );
    await renderAt('/panel/sales/$orderId', () => <OrderDetailPage orderId="o1" />);

    expect(await screen.findByTestId('order-shipx-unconfirmed')).toHaveTextContent(en.shipx.attemptUnconfirmed);
    await userEvent.click(screen.getByRole('button', { name: en.shipx.discardAttempt }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(en.shipx.discardConfirmBody)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: en.shipx.discardConfirm }));
    await waitFor(() => expect(calls).toEqual(['discard', 'create']));
  });

  it('shows the conflict when the order was shipped meanwhile', async () => {
    server.use(
      http.get('/api/orders/o1', () => HttpResponse.json({ ok: true, data: { order: order('o1', 'to_pack'), invoice: null } })),
      http.post('/api/orders/o1/ship', () => HttpResponse.json({ ok: false, error: { code: 'fulfilment_conflict', message: 'Order has already been shipped' } }, { status: 409 })),
    );
    await renderAt('/panel/sales/$orderId', () => <OrderDetailPage orderId="o1" />);
    const delivery = await screen.findByTestId('order-delivery');
    await userEvent.type(within(delivery).getByLabelText(en.shipping.shipTracking), 'ABCD1234');
    await userEvent.click(within(delivery).getByRole('button', { name: en.shipping.markShipped }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en.shipping.shipConfirm }));
    expect(await within(delivery).findByText(en.errors.messageFulfilmentConflict, { exact: false })).toBeInTheDocument();
  });
});
