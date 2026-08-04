import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import {
  newProductSchema,
  PRODUCT_TYPES,
  updateProductInputSchema,
  type Product,
  type ProductAccessIssues,
  type ProductPrice,
  type ProductDownloadAssetMetadata,
} from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { productTypeLabel } from './product-type.js';
import { ProductCreatePage } from './ProductCreatePage.js';
import { ProductEditorPage } from './ProductEditorPage.js';
import { ProductsPanel } from './ProductsPanel.js';

const initialProducts: Product[] = [
  {
    id: 'draft-1',
    tenantId: 't1',
    type: 'course',
    slug: 'draft-course',
    title: 'Draft Course',
    description: 'Draft description',
    coverUrl: null,
    priceCents: 2500,
    currency: 'PLN',
    published: false,
    accessItems: [{ level: 'course', courseId: 'c1' }],
    legacyId: null,
    createdAt: '2026-07-12T10:00:00.000Z',
  },
];

const initialPrices: ProductPrice[] = [{
  id: 'price-draft-1',
  tenantId: 't1',
  productId: 'draft-1',
  kind: 'one_time',
  interval: null,
  amountCents: 2500,
  currency: 'PLN',
  active: true,
  createdAt: '2026-07-12T10:00:00.000Z',
}];

const renderProductsPanel = async (
  issues: ProductAccessIssues[] = [],
  initialEntry = '/panel/products',
  seededProducts = initialProducts,
  seededPrices = initialPrices,
) => {
  let products = [...seededProducts];
  let prices = [...seededPrices];
  let assets: ProductDownloadAssetMetadata[] = [];
  let directUploadCalled = false;
  let updatedProduct: Product | null = null;
  const created: Product[] = [];

  server.use(
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products } })),
    http.get('/api/products/access-issues', () => HttpResponse.json({ ok: true, data: { issues } })),
    http.post('/api/products', async ({ request }) => {
      const input = newProductSchema.parse(await request.json());
      const product: Product = {
        id: `product-${created.length + 2}`,
        tenantId: 't1',
        type: input.type,
        slug: input.slug ?? '',
        title: input.title,
        description: input.description,
        coverUrl: input.coverUrl,
        priceCents: input.priceCents,
        currency: input.currency,
        published: false,
        accessItems: input.accessItems,
        legacyId: null,
        createdAt: '2026-07-12T11:00:00.000Z',
      };
      created.push(product);
      products = [...products, product];
      return HttpResponse.json({ ok: true, data: { product } });
    }),
    http.post('/api/products/update', async ({ request }) => {
      const input = updateProductInputSchema.parse(await request.json());
      const existing = products.find((candidate) => candidate.id === input.id);
      if (existing === undefined) return HttpResponse.json({ ok: false }, { status: 404 });
      const product: Product = {
        ...existing,
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        coverUrl: input.coverUrl === undefined ? existing.coverUrl : input.coverUrl,
      };
      updatedProduct = product;
      products = products.map((candidate) => candidate.id === product.id ? product : candidate);
      return HttpResponse.json({ ok: true, data: { product } });
    }),
    http.get('/api/products/:productId/prices', () =>
      HttpResponse.json({ ok: true, data: { prices } }),
    ),
    http.get('/api/products/:productId/downloads', () =>
      HttpResponse.json({ ok: true, data: { assets } }),
    ),
    http.post('/api/products/:productId/downloads/upload', () =>
      HttpResponse.json({
        ok: true,
        data: {
          asset: {
            id: 'asset-1',
            productId: 'download-1',
            fileName: 'workbook.pdf',
            contentType: 'application/pdf',
            sizeBytes: 7,
            status: 'pending',
            createdAt: '2026-07-12T12:00:00.000Z',
          },
          upload: {
            url: 'https://storage.example.test/product-download',
            headers: { 'content-type': 'application/pdf' },
            expiresAt: '2026-07-12T12:15:00.000Z',
          },
        },
      }),
    ),
    http.put('https://storage.example.test/product-download', () => {
      directUploadCalled = true;
      return new HttpResponse(null, { status: 200 });
    }),
    http.post('/api/products/:productId/downloads/:assetId/complete', () => {
      const asset: ProductDownloadAssetMetadata = {
        id: 'asset-1',
        productId: 'download-1',
        fileName: 'workbook.pdf',
        contentType: 'application/pdf',
        sizeBytes: 7,
        status: 'ready',
        createdAt: '2026-07-12T12:00:00.000Z',
      };
      assets = [asset];
      return HttpResponse.json({ ok: true, data: { asset } });
    }),
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
    http.get('/api/marketing/consent-definitions', () =>
      HttpResponse.json({ ok: true, data: { definitions: [] } }),
    ),
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
    http.post('/api/products/unpublish', () => {
      const published = products.find((candidate) => candidate.published);
      if (!published) return HttpResponse.json({ ok: false }, { status: 404 });
      const product = { ...published, published: false };
      products = products.map((candidate) => candidate.id === product.id ? product : candidate);
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
      const product = created.at(-1) ?? products[0];
      return product === undefined ? null : <ProductEditorPage product={product} />;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, createRoutePage, detailRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return {
    ...renderWithProviders(<RouterProvider router={router} />),
    created,
    directUploadCalled: () => directUploadCalled,
    updatedProduct: () => updatedProduct,
  };
};

describe('ProductsPanel', () => {
  it('lists products, creates a product without the legacy price field, and publishes a draft', async () => {
    await renderProductsPanel();

    expect(await screen.findByText('Draft Course')).toBeInTheDocument();

    const publish = screen.getByRole('button', { name: pl.products.publish });
    await waitFor(() => expect(publish).toBeEnabled());
    await userEvent.click(publish);
    expect(await screen.findByText(pl.products.publishConfirmIntro)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.products.publishPublicUrl)).toHaveValue(
      `${window.location.origin}/checkout/draft-1`,
    );
    expect(screen.getByText(/25,00/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: pl.products.publishConfirm }));

    await waitFor(() => {
      expect(screen.getByText(pl.products.published)).toBeInTheDocument();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: `+ ${pl.common.add}` }));
    await userEvent.type(await screen.findByLabelText(pl.products.titleLabel), 'New Workshop');
    await userEvent.type(screen.getByLabelText(pl.common.description), 'Hands-on session');
    await userEvent.click(screen.getByRole('button', { name: pl.products.create }));

    expect(await screen.findByRole('heading', { name: 'New Workshop', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('prices-section')).toBeInTheDocument();
  });

  it.each(PRODUCT_TYPES)('creates a %s product from the panel', async (type) => {
    const { created } = await renderProductsPanel([], '/panel/products/new');

    await userEvent.click(await screen.findByRole('combobox', { name: pl.products.typeLabel }));
    await userEvent.click(screen.getByRole('option', { name: productTypeLabel(type, pl) }));
    await userEvent.type(screen.getByLabelText(pl.products.titleLabel), 'Creator Club');
    await userEvent.type(screen.getByLabelText(pl.products.coverUrlLabel), 'https://cdn.test/cover.jpg');
    expect(screen.getByTestId('product-cover-preview')).toHaveAttribute('src', 'https://cdn.test/cover.jpg');
    await userEvent.type(screen.getByLabelText(pl.common.description), '<strong>Members only</strong>');
    await userEvent.click(screen.getByRole('button', { name: pl.products.create }));

    expect(await screen.findByRole('heading', { name: 'Creator Club', level: 1 })).toBeInTheDocument();
    expect(created).toEqual([
      expect.objectContaining({
        type,
        slug: 'creator-club',
        title: 'Creator Club',
        description: '<strong>Members only</strong>',
        coverUrl: 'https://cdn.test/cover.jpg',
      }),
    ]);
  });

  it('shows a duplicate slug error on the slug field', async () => {
    await renderProductsPanel([], '/panel/products/new');
    server.use(
      http.post('/api/products', () => HttpResponse.json({
        ok: false,
        error: { code: 'slug_reserved', message: 'Product slug already exists' },
      }, { status: 422 })),
    );

    await userEvent.type(await screen.findByLabelText(pl.products.titleLabel), 'Draft Course');
    await userEvent.click(screen.getByRole('button', { name: pl.products.create }));

    expect(await screen.findByText(pl.errors.messageSlugReservedGeneric)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.products.slugLabel)).toHaveAccessibleDescription(
      pl.errors.messageSlugReservedGeneric,
    );
  });

  it('locks membership prices to recurring in the editor', async () => {
    const baseProduct = initialProducts[0];
    if (baseProduct === undefined) throw new Error('Expected the base product fixture');
    const membership: Product = {
      ...baseProduct,
      id: 'membership-1',
      type: 'membership',
      slug: 'creator-club',
      title: 'Creator Club',
    };
    await renderProductsPanel([], '/panel/products/membership-1', [membership]);

    expect(await screen.findByText(pl.products.membershipPricesDescription)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: pl.products.kindLabel })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('combobox', { name: pl.products.kindLabel })).toHaveTextContent(
      pl.products.recurring,
    );
    expect(screen.getByRole('combobox', { name: pl.products.intervalLabel })).toBeInTheDocument();
  });

  it('uploads an asset directly from a digital-download product editor', async () => {
    const baseProduct = initialProducts[0];
    if (baseProduct === undefined) throw new Error('Expected the base product fixture');
    const download: Product = {
      ...baseProduct,
      id: 'download-1',
      type: 'digital_download',
      slug: 'creator-workbook',
      title: 'Creator workbook',
    };
    const rendered = await renderProductsPanel([], '/panel/products/download-1', [download]);

    const input = await screen.findByLabelText(pl.products.downloadFileInput);
    await userEvent.upload(input, new File(['content'], 'workbook.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(rendered.directUploadCalled()).toBe(true));
    expect(await screen.findByText('workbook.pdf')).toBeInTheDocument();
    expect(screen.getByText(pl.products.downloadStatusReady)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: pl.access.heading, level: 2 })).toBeInTheDocument();
  });

  it('shows the product type of every listed product', async () => {
    await renderProductsPanel();

    expect(await screen.findByTestId('product-type-draft-1')).toHaveTextContent(pl.products.typeCourse);
  });

  it('shows publish blockers for missing access and an inactive price', async () => {
    const product = initialProducts[0];
    if (product === undefined) throw new Error('Expected the base product fixture');
    await renderProductsPanel([], '/panel/products', [{ ...product, accessItems: [] }], []);

    const publish = await screen.findByRole('button', { name: pl.products.publish });
    expect(publish).toBeDisabled();
    expect(screen.getByText(pl.products.publishNeedsAccess)).toBeInTheDocument();
    expect(await screen.findByText(pl.products.publishNeedsActivePrice)).toBeInTheDocument();
  });

  it('offers a selectable checkout URL when clipboard writing fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard denied')) },
    });
    await renderProductsPanel();

    await userEvent.click(await screen.findByRole('button', { name: pl.products.copyCheckoutLink }));

    expect(await screen.findByText(pl.products.checkoutLinkCopyFailed)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.products.publishPublicUrl)).toHaveValue(
      `${window.location.origin}/checkout/draft-1`,
    );
    expect(screen.queryByText(pl.products.checkoutLinkCopied)).not.toBeInTheDocument();
  });

  it('updates product details while keeping the slug read-only', async () => {
    const rendered = await renderProductsPanel([], '/panel/products/draft-1');

    const title = await screen.findByLabelText(pl.products.titleLabel);
    await userEvent.clear(title);
    await userEvent.type(title, 'Updated course offer');
    await userEvent.clear(screen.getByLabelText(pl.products.coverUrlLabel));
    await userEvent.type(screen.getByLabelText(pl.products.coverUrlLabel), 'https://cdn.test/new-cover.jpg');
    expect(screen.getByLabelText(pl.products.slugLabel)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(pl.products.slugLabel)).toHaveAccessibleDescription(
      pl.products.slugImmutableHint,
    );
    await userEvent.click(screen.getByRole('button', { name: pl.products.saveDetails }));

    expect(await screen.findByText(pl.products.detailsSaved)).toBeInTheDocument();
    expect(rendered.updatedProduct()).toMatchObject({
      title: 'Updated course offer',
      slug: 'draft-course',
      coverUrl: 'https://cdn.test/new-cover.jpg',
    });
  });

  it('unpublishes a live product after confirmation', async () => {
    const product = initialProducts[0];
    if (product === undefined) throw new Error('Expected the base product fixture');
    await renderProductsPanel([], '/panel/products', [{ ...product, published: true }]);

    await userEvent.click(await screen.findByRole('button', { name: pl.products.unpublish }));
    expect(await screen.findByText(pl.products.unpublishConfirmBody)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: pl.products.unpublishConfirm }));

    expect(await screen.findByRole('button', { name: pl.products.publish })).toBeInTheDocument();
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
});
