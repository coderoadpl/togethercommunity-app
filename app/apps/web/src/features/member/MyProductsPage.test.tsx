import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MyProductsPage } from './MyProductsPage.js';

const course = (id: string, name: string) => ({
  id, tenantId: 'tenant-studio', name, description: '', imageUrl: null, moduleOrder: [],
  legacyId: null, publiclyVisible: false, createdAt: '2026-07-01T00:00:00.000Z',
});

const product = {
  id: 'product-single', type: 'course', title: 'JavaScript basics', description: '',
  accessItems: [{ level: 'course', courseId: 'course-js' }], priceCents: 4900, currency: 'EUR',
  purchasable: true, grantStatus: 'active', grantStartsAt: '2026-07-01T00:00:00.000Z',
  grantExpiresAt: null, subscription: null, downloads: [],
};

const settings = {
  billingPortalUrl: null, supportUrl: null, supportConfigured: false,
  videoAutoplayDefault: false, memberVideoAutoplayOverride: false,
};

const mockProducts = (products: unknown[], courses = [course('course-js', 'JavaScript'), course('course-react', 'React')]) => {
  server.use(
    http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: { products } })),
    http.get('/api/member/settings', () => HttpResponse.json({ ok: true, data: { settings } })),
    http.get('/api/student/courses', () => HttpResponse.json({ ok: true, data: { courses } })),
  );
};

const renderMyProducts = async (path = '/my/products') => {
  const rootRoute = createRootRoute({ component: MyProductsPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return { ...renderWithProviders(<RouterProvider router={router} />), router };
};

describe('my products cards', () => {
  it('opens the course directly when the product grants one accessible course', async () => {
    mockProducts([product]);

    await renderMyProducts();

    const card = within(await screen.findByTestId('my-product-product-single'));
    expect(await card.findByRole('link', { name: en.student.openCourse })).toHaveAttribute('href', '/my/courses/course-js');
    expect(card.getByRole('heading', { level: 2, name: product.title })).toBeVisible();
    expect(card.getByRole('link', { name: product.title })).toHaveAttribute('href', '/my/course/product-single');
  });

  it('sends a product that grants several courses to its product page', async () => {
    mockProducts([{
      ...product, id: 'product-bundle',
      accessItems: [{ level: 'course', courseId: 'course-js' }, { level: 'modules', courseId: 'course-react', moduleIds: ['module-1'] }],
    }]);

    await renderMyProducts();

    const card = within(await screen.findByTestId('my-product-product-bundle'));
    expect(await card.findByRole('link', { name: en.student.viewCourses })).toHaveAttribute('href', '/my/course/product-bundle');
    expect(card.queryByRole('link', { name: en.student.openCourse })).not.toBeInTheDocument();
  });

  it('counts only the granted courses the member can open', async () => {
    mockProducts([{
      ...product, id: 'product-partial',
      accessItems: [{ level: 'course', courseId: 'course-js' }, { level: 'course', courseId: 'course-archived' }],
    }]);

    await renderMyProducts();

    const card = within(await screen.findByTestId('my-product-product-partial'));
    expect(await card.findByRole('link', { name: en.student.openCourse })).toHaveAttribute('href', '/my/courses/course-js');
  });

  it('shows no open-course action for download-only, expired or physical products', async () => {
    mockProducts([
      { ...product, id: 'product-download', type: 'digital_download', accessItems: [] },
      { ...product, id: 'product-expired', grantStatus: 'expired', grantExpiresAt: '2026-07-02T00:00:00.000Z' },
      { ...product, id: 'product-physical', type: 'physical', accessItems: [] },
    ]);

    await renderMyProducts();

    await screen.findByTestId('my-product-product-download');
    for (const id of ['product-download', 'product-expired', 'product-physical']) {
      expect(screen.queryByTestId(`open-course-${id}`)).not.toBeInTheDocument();
    }
    expect(within(screen.getByTestId('my-product-product-physical')).getByRole('heading', { level: 2, name: product.title }))
      .toBeVisible();
  });

  it('shows the price only next to the renew action of an expired product', async () => {
    mockProducts([
      product,
      { ...product, id: 'product-expired', grantStatus: 'expired', grantExpiresAt: '2026-07-02T00:00:00.000Z' },
    ]);

    await renderMyProducts();

    const active = within(await screen.findByTestId('my-product-product-single'));
    expect(active.queryByText(/49/u)).not.toBeInTheDocument();
    const expired = within(screen.getByTestId('my-product-product-expired'));
    expect(expired.getByRole('link', { name: en.student.renewAccess })).toHaveAttribute('href', '/checkout/product-expired');
    expect(expired.getByTestId('renew-price-product-expired')).toHaveTextContent(/49/u);
  });
});

const salesLink = (slug: string) => ({ id: `link-${slug}`, slug, heading: 'Complete bundle', description: '', totalCents: 4200, currency: 'EUR' });

const mockPublicOffer = (salesLinks: unknown[]) => {
  server.use(http.get('/api/public/offer', () => HttpResponse.json({
    ok: true, data: { tenant: { slug: 'acme', name: 'Acme' }, contentVersion: 1, products: [], salesLinks },
  })));
};

describe('my products empty state', () => {
  it('says purchases appear here and suggests signing in with the address used to buy', async () => {
    mockProducts([]);
    mockPublicOffer([]);

    await renderMyProducts();

    const empty = within(await screen.findByTestId('my-products-empty-state'));
    expect(empty.getByRole('heading', { name: en.student.noProducts })).toBeVisible();
    expect(empty.getByText(en.student.productsWillAppear)).toBeVisible();
    expect(empty.getByText(en.student.productsOtherEmailHint)).toBeVisible();
    expect(empty.queryByRole('link', { name: en.student.browseOffers })).not.toBeInTheDocument();
  });

  it('links to the offer when the workspace lists one', async () => {
    mockProducts([]);
    mockPublicOffer([salesLink('complete-bundle')]);

    await renderMyProducts();

    const empty = within(await screen.findByTestId('my-products-empty-state'));
    expect(await empty.findByRole('link', { name: en.student.browseOffers })).toHaveAttribute('href', '/offer/complete-bundle');
  });

  it('offers no single link when the workspace lists several offers', async () => {
    let offerRequests = 0;
    mockProducts([]);
    server.use(http.get('/api/public/offer', () => {
      offerRequests += 1;
      return HttpResponse.json({
        ok: true, data: { tenant: { slug: 'acme', name: 'Acme' }, contentVersion: 1, products: [], salesLinks: [salesLink('first'), salesLink('second')] },
      });
    }));

    await renderMyProducts();

    const empty = within(await screen.findByTestId('my-products-empty-state'));
    await expect.poll(() => offerRequests).toBeGreaterThan(0);
    expect(empty.queryByRole('link', { name: en.student.browseOffers })).not.toBeInTheDocument();
  });
});

const guide = {
  id: 'asset-guide', lineageId: 'asset-guide', productId: 'product-guide', status: 'ready', createdAt: '2026-07-01T00:00:00.000Z',
  personalisationSizeExceeded: false, versionNumber: 1, versionNote: null, supersededAt: null, fileName: 'guide.pdf',
  contentType: 'application/pdf', sizeBytes: 2048, downloadPath: '/api/my/products/product-guide/downloads/asset-guide',
  previousVersions: [],
};

const downloadProduct = { ...product, id: 'product-guide', type: 'digital_download', title: 'Field guide', accessItems: [], downloads: [guide] };

describe('my products download failures', () => {
  it('shows the translated error with Retry on the failed product and drops the parameters from the URL', async () => {
    mockProducts([downloadProduct, product]);

    const { router } = await renderMyProducts('/my/products?downloadError=failed&product=product-guide&asset=asset-guide');

    const alert = await screen.findByTestId('download-failure-product-guide');
    expect(alert).toHaveTextContent(en.student.downloadFailures.failed);
    expect(within(screen.getByTestId('product-downloads-product-guide')).getByRole('alert')).toBe(alert);
    expect(within(alert).getByRole('link', { name: en.common.retry })).toHaveAttribute('href', guide.downloadPath);
    expect(screen.queryByTestId('download-failure-product-single')).not.toBeInTheDocument();
    await expect.poll(() => router.state.location.searchStr).toBe('');
    expect(router.state.location.pathname).toBe('/my/products');
  });

  it('keeps the error on the card of a product whose access ended', async () => {
    mockProducts([{ ...downloadProduct, grantStatus: 'expired', grantExpiresAt: '2026-07-02T00:00:00.000Z', downloads: [] }]);

    await renderMyProducts('/my/products?downloadError=no_access&product=product-guide&asset=asset-guide');

    const alert = await screen.findByTestId('download-failure-product-guide');
    expect(alert).toHaveTextContent(en.student.downloadFailures.no_access);
    await userEvent.click(within(alert).getByRole('button', { name: en.common.retry }));
    expect(screen.queryByTestId('download-failure-product-guide')).not.toBeInTheDocument();
  });

  it('shows the error above the list when the product is not listed and clears it on Retry', async () => {
    mockProducts([product]);

    await renderMyProducts('/my/products?downloadError=not_found&product=product-gone');

    const alert = await screen.findByTestId('download-failure');
    expect(alert).toHaveTextContent(en.student.downloadFailures.not_found);
    await userEvent.click(within(alert).getByRole('button', { name: en.common.retry }));
    expect(screen.queryByTestId('download-failure')).not.toBeInTheDocument();
  });

  it('ignores an error code outside the fixed list and still cleans the URL', async () => {
    mockProducts([downloadProduct]);

    const { router } = await renderMyProducts('/my/products?downloadError=%3Cscript%3E&product=product-guide');

    await screen.findByTestId('my-product-product-guide');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('<script>');
    await expect.poll(() => router.state.location.searchStr).toBe('');
  });
});
