import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { CouponCreatePage, CouponDetailPage, CouponsPanel } from './CouponsPanel.js';

const coupon = {
  id: 'coupon-1',
  tenantId: 'tenant-1',
  code: 'PARTNER20',
  kind: 'percent',
  value: 20,
  scope: { kind: 'all' },
  appliesTo: 'both',
  recurringDuration: 'forever',
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  maxRedemptionsPerMember: null,
  status: 'active',
  partnerLabel: 'Partner A',
  stripeCouponId: null,
  stripePromotionCodeId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const item = {
  coupon,
  redemptions: 2,
  sessionsWithCode: 4,
  conversionRate: 0.5,
  grossAttributed: [{ currency: 'PLN', amountCents: 8000 }],
  discountGiven: [{ currency: 'PLN', amountCents: 2000 }],
  timeSeries: [{
    date: '2026-07-27',
    currency: 'PLN',
    redemptions: 2,
    grossAttributedCents: 8000,
    discountGivenCents: 2000,
  }],
};

describe('coupon sales surfaces', () => {
  it('lists attribution, filters by partner, and opens settlement export', async () => {
    const queries: string[] = [];
    server.use(
      http.get('/api/coupons', ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ ok: true, data: { items: [item], nextCursor: null } });
      }),
      http.get('/api/coupons/export', () =>
        HttpResponse.json({
          ok: true,
          data: {
            filename: 'coupon-attribution.csv',
            mimeType: 'text/csv',
            content: 'code,redemptions\nPARTNER20,2',
          },
        }),
      ),
    );

    renderWithProviders(<CouponsPanel />);

    expect(await screen.findByTestId('coupon-row')).toHaveTextContent('PARTNER20');
    expect(screen.getByTestId('coupon-row')).toHaveTextContent('80,00');
    await userEvent.type(screen.getByTestId('coupon-partner-filter'), 'Partner A');
    await waitFor(() =>
      expect(queries.some((query) => query.includes('partnerLabel=Partner+A'))).toBe(true),
    );
    await userEvent.click(screen.getByTestId('coupons-export-csv'));
  });

  it('creates a coupon with the contract defaults', async () => {
    const payloads: unknown[] = [];
    server.use(
      http.get('/api/products', () =>
        HttpResponse.json({ ok: true, data: { products: [] } }),
      ),
      http.post('/api/coupons', async ({ request }) => {
        payloads.push(await request.json());
        return HttpResponse.json({ ok: true, data: { coupon } });
      }),
    );
    const root = createRootRoute();
    const createPage = createRoute({
      getParentRoute: () => root,
      path: '/panel/sales/coupons/new',
      component: CouponCreatePage,
    });
    const detailPage = createRoute({
      getParentRoute: () => root,
      path: '/panel/sales/coupons/$couponId',
      component: () => <div>detail</div>,
    });
    const router = createRouter({
      routeTree: root.addChildren([createPage, detailPage]),
      history: createMemoryHistory({ initialEntries: ['/panel/sales/coupons/new'] }),
    });
    await router.load();
    renderWithProviders(<RouterProvider router={router} />);

    await userEvent.type(await screen.findByLabelText(pl.coupons.code), 'partner20');
    await userEvent.type(screen.getByLabelText(pl.coupons.valuePercent), '20');
    await userEvent.type(screen.getByLabelText(pl.coupons.partner), 'Partner A');
    await userEvent.click(screen.getByRole('button', { name: pl.coupons.create }));

    await screen.findByText('detail');
    expect(payloads).toMatchObject([{
      code: 'partner20',
      kind: 'percent',
      value: 20,
      scope: { kind: 'all' },
      appliesTo: 'both',
      recurringDuration: 'first_invoice',
      partnerLabel: 'Partner A',
    }]);
  });

  it('shows coupon conversion and archives from detail', async () => {
    let archived = false;
    server.use(
      http.get('/api/coupons/coupon-1', () =>
        HttpResponse.json({
          ok: true,
          data: { item: { ...item, coupon: { ...coupon, status: archived ? 'archived' : 'active' } } },
        }),
      ),
      http.post('/api/coupons/archive', () => {
        archived = true;
        return HttpResponse.json({
          ok: true,
          data: { coupon: { ...coupon, status: 'archived' } },
        });
      }),
    );

    renderWithProviders(<CouponDetailPage couponId="coupon-1" />);

    expect(await screen.findByText('50%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: pl.coupons.archive }));
    await waitFor(() => expect(archived).toBe(true));
  });
});
