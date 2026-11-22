import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

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

  it('waits for the course list before choosing a course target', async () => {
    let releaseCourses: () => void = () => undefined;
    const coursesReady = new Promise<void>((resolve) => { releaseCourses = resolve; });
    mockProducts([product]);
    server.use(http.get('/api/student/courses', async () => {
      await coursesReady;
      return HttpResponse.json({ ok: true, data: { courses: [course('course-js', 'JavaScript')] } });
    }));

    await renderMyProducts();

    const card = within(await screen.findByTestId('my-product-product-single'));
    expect(card.queryByTestId('open-course-product-single')).not.toBeInTheDocument();
    expect(card.getByTestId('open-course-pending-product-single')).toHaveTextContent(en.student.loadingCourses);
    expect(card.queryByRole('button', { name: en.student.openCourse })).not.toBeInTheDocument();
    releaseCourses();
    expect(await card.findByRole('link', { name: en.student.openCourse })).toHaveAttribute('href', '/my/courses/course-js');
    expect(card.queryByTestId('open-course-pending-product-single')).not.toBeInTheDocument();
  });

  it('keeps no course placeholder on products that grant no course while the course list loads', async () => {
    mockProducts([product, { ...product, id: 'product-download', type: 'digital_download', accessItems: [] }]);
    server.use(http.get('/api/student/courses', () => new Promise<never>(() => undefined)));

    await renderMyProducts();

    await screen.findByTestId('open-course-pending-product-single');
    expect(screen.queryByTestId('open-course-pending-product-download')).not.toBeInTheDocument();
  });

  it('sends the member to the product page when the course list fails to load', async () => {
    mockProducts([product]);
    server.use(http.get('/api/student/courses', () => HttpResponse.json(
      { ok: false, error: { code: 'internal', message: 'Course list unavailable' } }, { status: 500 },
    )));

    await renderMyProducts();

    const card = within(await screen.findByTestId('my-product-product-single'));
    expect(await card.findByRole('link', { name: en.student.viewCourses })).toHaveAttribute('href', '/my/course/product-single');
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

const salesLink = (slug: string, heading = 'Complete bundle') => ({ id: `link-${slug}`, slug, heading, description: '', totalCents: 4200, currency: 'EUR' });

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

  it('lists one link per offer, named after it, when the workspace lists several offers', async () => {
    mockProducts([]);
    mockPublicOffer([salesLink('starter-kit', 'Starter kit'), salesLink('complete-bundle', 'Complete bundle')]);

    await renderMyProducts();

    const empty = within(await screen.findByTestId('my-products-empty-state'));
    const offers = await empty.findByRole('list', { name: en.student.browseOffers });
    expect(within(offers).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Starter kit', '/offer/starter-kit'],
      ['Complete bundle', '/offer/complete-bundle'],
    ]);
    expect(empty.queryByRole('link', { name: en.student.browseOffers })).not.toBeInTheDocument();
    expect(empty.getAllByRole('link').map((link) => link.getAttribute('href'))).not.toContain('/');
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
    expect(within(alert).queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: en.common.close }));
    expect(screen.queryByTestId('download-failure-product-guide')).not.toBeInTheDocument();
  });

  it('shows the error above the list when the product is not listed and clears it on Close', async () => {
    mockProducts([product]);

    await renderMyProducts('/my/products?downloadError=not_found&product=product-gone');

    const alert = await screen.findByTestId('download-failure');
    expect(alert).toHaveTextContent(en.student.downloadFailures.not_found);
    await userEvent.click(within(alert).getByRole('button', { name: en.common.close }));
    expect(screen.queryByTestId('download-failure')).not.toBeInTheDocument();
  });

  it('scrolls the error on the failed product card into the middle of the view and focuses it', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    mockProducts([product, downloadProduct]);

    try {
      await renderMyProducts('/my/products?downloadError=failed&product=product-guide&asset=asset-guide');

      const alert = await screen.findByTestId('download-failure-product-guide');
      await waitFor(() => expect(alert).toHaveFocus());
      expect(alert).toHaveAttribute('role', 'alert');
      expect(alert).toHaveAttribute('tabindex', '-1');
      expect(scrollIntoView.mock.instances).toEqual([alert]);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  it('scrolls the error above the list into view without smooth scrolling under reduced motion and focuses it', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)', media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }));
    mockProducts([product]);

    try {
      await renderMyProducts('/my/products?downloadError=not_found&product=product-gone');

      const alert = await screen.findByTestId('download-failure');
      await waitFor(() => expect(alert).toHaveFocus());
      expect(alert).toHaveAttribute('role', 'alert');
      expect(scrollIntoView.mock.instances).toEqual([alert]);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    } finally {
      scrollIntoView.mockRestore();
      vi.unstubAllGlobals();
    }
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
