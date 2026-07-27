import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SalesPanel } from './SalesPanel.js';

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
              title: 'Workshop',
              description: '',
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
      http.get('/api/orders/export', ({ request }) => {
        exportQueries.push(new URL(request.url).search);
        return HttpResponse.json({
          ok: true,
          data: { filename: 'sales-acme.csv', mimeType: 'text/csv', content: 'date,member' },
        });
      }),
    );

    renderWithProviders(<SalesPanel />);

    expect(await screen.findByTestId('sales-row')).toHaveTextContent('Workshop');
    expect(screen.getByTestId('sales-row')).toHaveTextContent('Ada');

    await userEvent.click(screen.getByLabelText(pl.sales.status));
    await userEvent.click(await screen.findByRole('option', { name: pl.sales.paid }));
    await waitFor(() => expect(listQueries.some((query) => query.includes('status=paid'))).toBe(true));

    await userEvent.click(screen.getByTestId('sales-export-csv'));
    await waitFor(() => expect(exportQueries).toHaveLength(1));
    expect(exportQueries[0]).toContain('format=csv');
    expect(exportQueries[0]).toContain('status=paid');
    expect(exportQueries[0]).not.toContain('page=');
    expect(exportQueries[0]).not.toContain('pageSize=');
  });
});
