import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { MemberWithProductIds } from '@core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DashboardPanel } from './DashboardPanel.js';

const product = (id: string, published: boolean) => ({
  id,
  tenantId: 't1',
  title: `Product ${id}`,
  description: '',
  priceCents: 9900,
  currency: 'PLN',
  published,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-07-01T10:00:00.000Z',
});

const course = (id: string) => ({
  id,
  tenantId: 't1',
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  moduleOrder: [],
  legacyId: null,
  createdAt: '2026-07-01T10:00:00.000Z',
});

const member = (id: string, createdAt: string, activeProductIds: string[]): MemberWithProductIds => ({
  id,
  email: `${id}@together.dev`,
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt,
  productIds: activeProductIds,
  activeProductIds,
});

const members: MemberWithProductIds[] = [
  member('m1', '2026-07-01T10:00:00.000Z', ['p1']),
  member('m2', '2026-07-02T10:00:00.000Z', []),
  member('m3', '2026-07-03T10:00:00.000Z', ['p1', 'p2']),
  member('m4', '2026-07-04T10:00:00.000Z', []),
  member('m5', '2026-07-05T10:00:00.000Z', []),
  member('m6', '2026-07-06T10:00:00.000Z', []),
];

describe('DashboardPanel', () => {
  it('shows counts for products, courses, members and active grants plus recent members', async () => {
    server.use(
      http.get('/api/products', () =>
        HttpResponse.json({ ok: true, data: { products: [product('p1', true), product('p2', false)] } }),
      ),
      http.get('/api/courses', () =>
        HttpResponse.json({ ok: true, data: { courses: [course('c1')] } }),
      ),
      http.get('/api/members', () => HttpResponse.json({ ok: true, data: { members } })),
      http.get('/api/sales/summary', () =>
        HttpResponse.json({
          ok: true,
          data: {
            summary: {
              revenueLast30Days: [{ currency: 'PLN', amountCents: 14700 }],
              activeSubscriptions: 2,
              ordersLast30Days: 4,
            },
          },
        }),
      ),
    );

    renderWithProviders(<DashboardPanel />);

    expect(await screen.findByTestId('dashboard-tiles')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-tile-products')).toHaveTextContent('2');
    expect(screen.getByTestId('dashboard-tile-products')).toHaveTextContent(
      pl.dashboard.publishedDraft({ published: 1, draft: 1 }),
    );
    expect(screen.getByTestId('dashboard-tile-courses')).toHaveTextContent('1');
    expect(screen.getByTestId('dashboard-tile-members')).toHaveTextContent('6');
    expect(screen.getByTestId('dashboard-tile-grants')).toHaveTextContent('3');
    expect(screen.getByTestId('dashboard-tile-revenue')).toHaveTextContent('147');
    expect(screen.getByTestId('dashboard-tile-subscriptions')).toHaveTextContent('2');
    expect(screen.getByTestId('dashboard-tile-orders')).toHaveTextContent('4');

    const recent = screen.getAllByTestId('dashboard-member-row');
    expect(recent).toHaveLength(5);
    expect(recent[0]).toHaveTextContent('m6@together.dev');
    expect(recent[4]).toHaveTextContent('m2@together.dev');
  });
});
