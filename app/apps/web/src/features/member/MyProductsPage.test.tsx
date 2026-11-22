import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
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

const renderMyProducts = async () => {
  const rootRoute = createRootRoute({ component: MyProductsPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my/products'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
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
