import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SalesPanel } from './SalesPanel.js';
import { OrderDetailPage } from './OrderDetailPage.js';

describe('SalesPanel', () => {
  it('renders orders, applies a server filter, and exports all filtered rows without page parameters', async () => {
    const listQueries: string[] = [];
    const exportQueries: string[] = [];
    server.use(
      http.get('/api/products', () =>
        HttpResponse.json({
          ok: true,
          data: {
            products: [{
              id: 'p1',
              tenantId: 't1',
              type: 'course',
              slug: 'workshop',
              title: 'Workshop',
              description: '',
              coverUrl: null,
              priceCents: 4900,
              currency: 'PLN',
              published: true,
              accessItems: [],
              legacyId: null,
              createdAt: '2026-07-01T10:00:00.000Z',
            }],
          },
        }),
      ),
      http.get('/api/orders', ({ request }) => {
        listQueries.push(new URL(request.url).search);
        return HttpResponse.json({
          ok: true,
          data: {
            orders: [{
              id: 'o1',
              tenantId: 't1',
              memberId: 'm1',
              productId: 'p1',
              priceId: 'price-1',
              kind: 'one_time',
              status: 'paid',
              amountCents: 4900,
              currency: 'PLN',
              provider: 'simulated',
              providerObjectIds: {},
              couponId: null,
              discountCents: 0,
              couponCode: null,
              createdAt: '2026-07-18T10:00:00.000Z',
              memberEmail: 'member@example.com',
              memberName: 'Ada',
              productTitle: 'Workshop',
            }],
            total: 1,
            page: 1,
            pageSize: 25,
          },
        });
      }),
      http.get('/api/coupons/options', () =>
        HttpResponse.json({
          ok: true,
          data: {
            coupons: [{ id: 'coupon-1', code: 'PARTNER20' }],
          },
        }),
      ),
      http.get('/api/orders/export', ({ request }) => {
        exportQueries.push(new URL(request.url).search);
        return HttpResponse.json({
          ok: true,
          data: { filename: 'sales-acme.csv', mimeType: 'text/csv', content: 'date,member' },
        });
      }),
    );

    const rootRoute = createRootRoute();
    const salesRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/panel/sales',
      component: SalesPanel,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([salesRoute]),
      history: createMemoryHistory({ initialEntries: ['/panel/sales'] }),
    });
    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByTestId('sales-row')).toHaveTextContent('Workshop');
    expect(screen.getByTestId('sales-row')).toHaveTextContent('Ada');
    expect(screen.getByRole('link', { name: 'Ada' }))
      .toHaveAttribute('href', '/panel/members/m1');

    await userEvent.click(screen.getByLabelText(pl.sales.status));
    await userEvent.click(await screen.findByRole('option', { name: pl.sales.paid }));
    await waitFor(() => expect(listQueries.some((query) => query.includes('status=paid'))).toBe(true));

    await userEvent.click(screen.getByLabelText(pl.sales.coupon));
    await userEvent.click(await screen.findByRole('option', { name: 'PARTNER20' }));
    await waitFor(() =>
      expect(listQueries.some((query) => query.includes('couponId=coupon-1'))).toBe(true),
    );

    await userEvent.click(screen.getByTestId('sales-export-csv'));
    await waitFor(() => expect(exportQueries).toHaveLength(1));
    expect(exportQueries[0]).toContain('format=csv');
    expect(exportQueries[0]).toContain('status=paid');
    expect(exportQueries[0]).toContain('couponId=coupon-1');
    expect(exportQueries[0]).not.toContain('page=');
    expect(exportQueries[0]).not.toContain('pageSize=');
  });
});

describe('OrderDetailPage', () => {
  it('shows coupon and discount attribution', async () => {
    server.use(
      http.get('/api/orders/o1', () =>
        HttpResponse.json({
          ok: true,
          data: {
            order: {
              id: 'o1',
              tenantId: 't1',
              memberId: 'm1',
              productId: 'p1',
              priceId: 'price-1',
              kind: 'one_time',
              status: 'paid',
              amountCents: 3920,
              currency: 'PLN',
              provider: 'simulated',
              providerObjectIds: {},
              couponId: 'coupon-1',
              discountCents: 980,
              couponCode: 'PARTNER20',
              createdAt: '2026-07-18T10:00:00.000Z',
              memberEmail: 'member@example.com',
              memberName: 'Ada',
              productTitle: 'Workshop',
            },
          },
        }),
      ),
    );

    renderWithProviders(<OrderDetailPage orderId="o1" />);

    expect(await screen.findByText('PARTNER20')).toBeInTheDocument();
    expect(screen.getByText('9,80 zł')).toBeInTheDocument();
  });

  it('uses the authenticated app download route and exposes status refresh', async () => {
    let refreshCalls = 0;
    const detail = {
      order: {
        id: 'o1',
        tenantId: 't1',
        memberId: 'm1',
        productId: 'p1',
        priceId: null,
        kind: 'one_time',
        status: 'paid',
        amountCents: 7900,
        currency: 'PLN',
        provider: 'stripe',
        providerObjectIds: {},
        couponId: null,
        discountCents: 0,
        billing: {
          nip: '5555555555',
          companyName: 'Acme sp. z o.o.',
          address: 'Prosta 1',
          postalCode: '00-001',
          city: 'Warszawa',
          country: 'PL',
        },
        createdAt: '2026-07-27T10:00:00.000Z',
        memberEmail: 'member@example.com',
        memberName: 'Ada',
        productTitle: 'Workshop',
        couponCode: null,
      },
      invoice: {
        id: 'invoice-1',
        tenantId: 't1',
        orderId: 'o1',
        status: 'issued',
        provider: 'ifirma',
        providerInvoiceId: '1244512',
        invoiceNumber: 'FV/1',
        pdfUrl: null,
        error: null,
        issuedAt: '2026-07-27T10:00:00.000Z',
        createdAt: '2026-07-27T10:00:00.000Z',
      },
    };
    server.use(
      http.get('/api/orders/o1', () => HttpResponse.json({ ok: true, data: detail })),
      http.post('/api/invoices/invoice-1/refresh', () => {
        refreshCalls += 1;
        return HttpResponse.json({ ok: true, data: { invoice: { ...detail.invoice, status: 'delivered' } } });
      }),
    );
    renderWithProviders(<OrderDetailPage orderId="o1" />);

    const download = await screen.findByRole('link', { name: /pobierz fakturę/i });
    expect(download).toHaveAttribute('href', '/api/invoices/invoice-1/download');
    await userEvent.click(screen.getByRole('button', { name: /odśwież status/i }));
    await waitFor(() => expect(refreshCalls).toBe(1));
  });

  it('shows the KSeF number and awaiting-UPO state after fiscal acceptance', async () => {
    const ksef = {
      environment: 'test',
      schemaSystemCode: 'FA (3)',
      schemaVersion: '1-0E',
      contextNip: '5555555555',
      sellerName: 'Together',
      sellerAddress: 'Prosta 1',
      p2: 'FV/2026/000001',
      invoiceType: 'VAT',
      issueDate: '2026-07-28',
      xmlArtifactKey: 'invoice/invoice-1/fa3.xml',
      xmlByteSize: 100,
      xmlSha256: 'a'.repeat(64),
      state: 'awaiting_upo',
      authConfigVersion: 1,
      sessionReference: 'session-1',
      invoiceReference: 'reference-1',
      ksefNumber: '5555555555-20260728-ABCDEF-01',
      lastStatusCode: 200,
      lastStatusDescription: 'Sukces',
      lastStatusDetails: [],
      lastStatusExtensions: {},
      lastPolledAt: '2026-07-28T10:00:00.000Z',
      acquisitionAt: '2026-07-28T10:00:00.000Z',
      invoicingAt: '2026-07-28T10:00:00.000Z',
      permanentStorageAt: null,
      upoArtifactKey: null,
      upoSha256: null,
      upoRetrievedAt: null,
      originalSessionReference: null,
      originalKsefNumber: null,
      lastTransportError: null,
      retryAt: '2026-07-28T10:01:00.000Z',
      attempt: 1,
      correlationChecks: 0,
      version: 4,
    };
    const order = {
      id: 'o1',
      tenantId: 't1',
      memberId: 'm1',
      productId: 'p1',
      priceId: null,
      kind: 'one_time',
      status: 'paid',
      amountCents: 12300,
      currency: 'PLN',
      provider: 'stripe',
      providerObjectIds: {},
      couponId: null,
      discountCents: 0,
      billing: null,
      createdAt: '2026-07-28T09:00:00.000Z',
      memberEmail: 'member@example.com',
      memberName: 'Ada',
      productTitle: 'Workshop',
      couponCode: null,
    };
    const invoice = {
      id: 'invoice-1',
      tenantId: 't1',
      orderId: 'o1',
      status: 'processing',
      provider: 'ksef',
      providerInvoiceId: 'reference-1',
      invoiceNumber: 'FV/2026/000001',
      pdfUrl: null,
      error: null,
      issuedAt: null,
      createdAt: '2026-07-28T09:00:00.000Z',
      ksef,
    };
    server.use(
      http.get('/api/orders/o1', () =>
        HttpResponse.json({ ok: true, data: { order, invoice } })),
    );
    renderWithProviders(<OrderDetailPage orderId="o1" />);

    expect(await screen.findByText((_content, element) =>
      element?.tagName === 'P'
      && element.textContent?.includes('5555555555-20260728-ABCDEF-01') === true))
      .toBeInTheDocument();
    expect(screen.getByText(pl.sales.ksefStates.awaiting_upo)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.sales.ksefPdfDownload }))
      .toHaveAttribute('href', '/api/invoices/invoice-1/download');
  });
});
