import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { Product, ProductAccessIssues } from '@core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ProductCreatePage } from './ProductCreatePage.js';
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
    accessItems: [],
    legacyId: null,
    createdAt: '2026-07-12T10:00:00.000Z',
  },
];

const renderProductsPanel = async (issues: ProductAccessIssues[] = [], initialEntry = '/panel/products') => {
  let products = [...initialProducts];

  server.use(
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products } })),
    http.get('/api/products/access-issues', () => HttpResponse.json({ ok: true, data: { issues } })),
    http.post('/api/products', () => {
      const product: Product = {
        id: 'product-2',
        tenantId: 't1',
        title: 'New Workshop',
        description: 'Hands-on session',
        priceCents: 4900,
        currency: 'EUR',
        published: false,
        accessItems: [],
        legacyId: null,
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

  const rootRoute = createRootRoute();
  const listRoute = createRoute({ getParentRoute: () => rootRoute, path: '/panel/products', component: ProductsPanel });
  const createRoutePage = createRoute({ getParentRoute: () => rootRoute, path: '/panel/products/new', component: ProductCreatePage });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, createRoutePage]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('ProductsPanel', { timeout: 15000 }, () => {
  it('lists products, creates a product, and publishes a draft', async () => {
    await renderProductsPanel();

    expect(await screen.findByText('Draft Course')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.products.publish }));

    await waitFor(() => {
      expect(screen.getByText(pl.products.published)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('link', { name: `+ ${pl.common.add}` }));
    await userEvent.type(await screen.findByLabelText(pl.products.titleLabel), 'New Workshop');
    await userEvent.type(screen.getByLabelText(pl.common.description), 'Hands-on session');
    await userEvent.clear(screen.getByLabelText(pl.products.priceLabel));
    await userEvent.type(screen.getByLabelText(pl.products.priceLabel), '49.99');

    await userEvent.click(screen.getByRole('combobox', { name: pl.products.currencyLabel }));
    await userEvent.click(await screen.findByRole('option', { name: 'EUR' }));

    await userEvent.click(screen.getByRole('button', { name: pl.products.create }));

    expect(await screen.findByText('New Workshop')).toBeInTheDocument();
  });

  it('rejects a price with more than two decimals before submitting', async () => {
    let createCalls = 0;
    await renderProductsPanel([], '/panel/products/new');
    server.use(
      http.post('/api/products', () => {
        createCalls += 1;
        return HttpResponse.json({ ok: false }, { status: 400 });
      }),
    );

    await userEvent.type(await screen.findByLabelText(pl.products.titleLabel), 'Bad price');
    await userEvent.clear(screen.getByLabelText(pl.products.priceLabel));
    await userEvent.type(screen.getByLabelText(pl.products.priceLabel), '1.999');
    await userEvent.click(screen.getByRole('button', { name: pl.products.create }));

    expect(await screen.findByText(pl.products.priceInvalid)).toBeInTheDocument();
    expect(createCalls).toBe(0);
  });

  it('flags products whose access items point at missing content', async () => {
    await renderProductsPanel([
      {
        productId: 'draft-1',
        productTitle: 'Draft Course',
        missingCourseIds: ['ghost-course'],
        missingModuleIds: [],
        missingLessonIds: ['ghost-lesson'],
        unreachableModuleIds: [],
        unreachableLessonIds: ['detached-lesson'],
      },
    ]);

    expect(await screen.findByText('Draft Course')).toBeInTheDocument();
    expect(await screen.findByText(pl.products.accessIssuesChip)).toBeInTheDocument();
    expect(screen.getByText(`${pl.products.missingCoursesLabel}: ghost-course`)).toBeInTheDocument();
    expect(screen.getByText(`${pl.products.missingLessonsLabel}: ghost-lesson`)).toBeInTheDocument();
    expect(
      screen.getByText(`${pl.products.unreachableLessonsLabel}: detached-lesson`),
    ).toBeInTheDocument();
  });
});
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
