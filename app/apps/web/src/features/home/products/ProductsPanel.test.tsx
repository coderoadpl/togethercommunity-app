import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { Product } from '@core/domain/index.js';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ProductsPanel } from './ProductsPanel.js';

const initialProducts: Product[] = [
  {
    id: 'draft-1',
    tenantId: 't1',
    title: 'Draft Course',
    description: 'Draft description',
    priceCents: 2500,
    currency: 'PLN',
    published: false,
    createdAt: '2026-07-12T10:00:00.000Z',
  },
];

const renderProductsPanel = () => {
  let products = [...initialProducts];

  server.use(
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products } })),
    http.post('/api/products', () => {
      const product: Product = {
        id: 'product-2',
        tenantId: 't1',
        title: 'New Workshop',
        description: 'Hands-on session',
        priceCents: 4900,
        currency: 'EUR',
        published: false,
        createdAt: '2026-07-12T11:00:00.000Z',
      };
      products = [...products, product];
      return HttpResponse.json({ ok: true, data: { product } });
    }),
    http.post('/api/products/publish', () => {
      const draft = products.find((candidate) => !candidate.published);
      if (!draft) return HttpResponse.json({ ok: false }, { status: 404 });
      const product = {
        ...draft,
        published: true,
      };
      products = products.map((candidate) => (candidate.id === product.id ? product : candidate));
      return HttpResponse.json({ ok: true, data: { product } });
    }),
  );

  return renderWithProviders(<ProductsPanel />);
};

describe('ProductsPanel', () => {
  it('lists products, creates a product, and publishes a draft', async () => {
    renderProductsPanel();

    expect(await screen.findByText('Draft Course')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'publish' }));

    await waitFor(() => {
      expect(screen.getByText(/published/i)).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText('title'), 'New Workshop');
    await userEvent.type(screen.getByLabelText('description'), 'Hands-on session');
    await userEvent.clear(screen.getByLabelText('price in cents'));
    await userEvent.type(screen.getByLabelText('price in cents'), '4900');
    await userEvent.clear(screen.getByLabelText('currency'));
    await userEvent.type(screen.getByLabelText('currency'), 'EUR');
    await userEvent.click(screen.getByRole('button', { name: 'create product' }));

    expect(await screen.findByText('New Workshop')).toBeInTheDocument();
  });
});
