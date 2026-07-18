import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { Product, ProductAccessIssues, ProductPrice } from '@core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ProductCreatePage } from './ProductCreatePage.js';
import { ProductEditorPage } from './ProductEditorPage.js';
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
  let prices: ProductPrice[] = [];

  server.use(
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products } })),
    http.get('/api/products/access-issues', () => HttpResponse.json({ ok: true, data: { issues } })),
    http.post('/api/products', () => {
      const product: Product = {
        id: 'product-2',
        tenantId: 't1',
        title: 'New Workshop',
        description: 'Hands-on session',
        priceCents: 0,
        currency: 'PLN',
        published: false,
        accessItems: [],
        legacyId: null,
        createdAt: '2026-07-12T11:00:00.000Z',
      };
      products = [...products, product];
      return HttpResponse.json({ ok: true, data: { product } });
    }),
    http.get('/api/products/:productId/prices', () =>
      HttpResponse.json({ ok: true, data: { prices } }),
    ),
    http.post('/api/products/prices', async ({ request }) => {
      const body = await request.json();
      const parsed = typeof body === 'object' && body !== null ? body : {};
      const price: ProductPrice = {
        id: 'price-1',
        tenantId: 't1',
        productId: 'draft-1',
        kind: 'one_time',
        interval: null,
        amountCents: 'amountCents' in parsed && typeof parsed.amountCents === 'number' ? parsed.amountCents : 0,
        currency: 'PLN',
        active: true,
        createdAt: '2026-07-12T12:00:00.000Z',
      };
      prices = [price];
      return HttpResponse.json({ ok: true, data: { price } });
    }),
    http.post('/api/products/prices/deactivate', () => {
      const existing = prices[0];
      if (existing === undefined) return HttpResponse.json({ ok: false }, { status: 404 });
      const price: ProductPrice = { ...existing, active: false };
      prices = [price];
      return HttpResponse.json({ ok: true, data: { price } });
    }),
    http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [] } })),
    http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules: [] } })),
    http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
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
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/products/$productId',
    component: () => {
      const product = products.find((candidate) => candidate.id === 'product-2') ?? products[0];
      return product === undefined ? null : <ProductEditorPage product={product} />;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, createRoutePage, detailRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('ProductsPanel', { timeout: 15000 }, () => {
  it('lists products, creates a product without the legacy price field, and publishes a draft', async () => {
    await renderProductsPanel();

    expect(await screen.findByText('Draft Course')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.products.publish }));

    await waitFor(() => {
      expect(screen.getByText(pl.products.published)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('link', { name: `+ ${pl.common.add}` }));
    await userEvent.type(await screen.findByLabelText(pl.products.titleLabel), 'New Workshop');
    await userEvent.type(screen.getByLabelText(pl.common.description), 'Hands-on session');
    await userEvent.click(screen.getByRole('button', { name: pl.products.create }));

    expect(await screen.findByRole('heading', { name: 'New Workshop', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('prices-section')).toBeInTheDocument();
  });

  it('adds a price and deactivates it through the confirmation dialog', async () => {
    await renderProductsPanel([], '/panel/products/draft-1');

    await userEvent.type(await screen.findByLabelText(pl.products.priceLabel), '49.99');
    await userEvent.click(screen.getByRole('button', { name: pl.products.addPrice }));

    expect(await screen.findByTestId('price-row')).toHaveTextContent('49,99');
    await userEvent.click(screen.getByRole('button', { name: pl.products.deactivate }));
    expect(await screen.findByText(pl.products.deactivateBody)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: pl.products.deactivateConfirm }));

    await waitFor(() => expect(screen.getByTestId('price-row')).toHaveTextContent(pl.products.inactive));
    expect(screen.queryByRole('button', { name: pl.products.deactivate })).not.toBeInTheDocument();
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
