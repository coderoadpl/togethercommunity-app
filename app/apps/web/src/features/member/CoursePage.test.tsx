import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CoursePage } from './CoursePage.js';
import { MyProductsPage } from './MyProductsPage.js';

const previousDownload = {
  id: 'previous', lineageId: 'asset-1', versionNumber: 1, versionNote: 'First edition',
  supersededAt: '2026-07-12T00:00:00.000Z', productId: 'download-1',
  fileName: 'original.pdf', contentType: 'application/pdf', sizeBytes: 2048, status: 'ready',
  createdAt: '2026-07-01T00:00:00.000Z', downloadPath: '/api/my/products/download-1/downloads/previous',
  personalisationSizeExceeded: true,
};

const product = {
  id: 'download-1', type: 'digital_download', title: 'Field guide',
  description: '<p>A practical companion.</p>', accessItems: [], priceCents: 4900,
  currency: 'EUR', purchasable: true, grantStatus: 'active',
  grantStartsAt: '2026-07-01T00:00:00.000Z', grantExpiresAt: null, subscription: null,
  downloads: [{
    ...previousDownload, id: 'asset-1', versionNumber: 2, versionNote: 'Updated examples',
    fileName: 'guide.pdf', supersededAt: null, personalisationSizeExceeded: false,
    downloadPath: '/api/my/products/download-1/downloads/asset-1', previousVersions: [previousDownload],
  }],
};

const renderPage = async (component: () => ReactNode, path = '/my/course/download-1') => {
  const rootRoute = createRootRoute({ component });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const noCourses = () => http.get('/api/student/courses', () =>
  HttpResponse.json({ ok: true, data: { courses: [] } }));

const myProducts = (value = product) => http.get('/api/my/products', () =>
  HttpResponse.json({ ok: true, data: { products: [value] } }));

const renderProduct = () => renderPage(() => <CoursePage productId="download-1" />);

describe('download product page', () => {
  it('shows the description, download guidance and versioned files instead of the empty course state', async () => {
    server.use(myProducts(), noCourses());

    await renderProduct();

    expect(await screen.findByRole('heading', { level: 1, name: product.title })).toBeVisible();
    expect(within(screen.getByRole('banner')).getByText(en.student.downloadsHeading)).toBeVisible();
    const description = screen.getByText('A practical companion.');
    const guidance = screen.getByText(en.student.downloadProductBody);
    const files = screen.getByTestId('product-downloads-download-1');
    expect(description.compareDocumentPosition(guidance)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(guidance.compareDocumentPosition(files)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText(en.student.productWithoutCoursesTitle)).not.toBeInTheDocument();
    expect(screen.getByTestId('download-asset-1')).toHaveAttribute('href', product.downloads[0]?.downloadPath);
    expect(screen.getByText('Updated examples')).toBeVisible();
    expect(screen.getByText('First edition')).not.toBeVisible();
    await userEvent.click(screen.getByText(en.products.previousVersions));
    expect(screen.getByText('First edition')).toBeVisible();
    expect(screen.getByTestId('download-previous')).toHaveAttribute('href', previousDownload.downloadPath);
    expect(screen.getByText(en.student.downloadNoCopyIdentifier)).toBeVisible();
  });

  it('shows downloads without a description even when the unrelated courses request fails', async () => {
    server.use(
      myProducts({ ...product, description: '' }),
      http.get('/api/student/courses', () => HttpResponse.json({
        ok: false, error: { code: 'unavailable', message: 'Courses unavailable' },
      }, { status: 503 })),
    );

    await renderProduct();

    expect(await screen.findByTestId('download-asset-1')).toBeVisible();
    expect(screen.getByText(en.student.downloadProductBody)).toBeVisible();
    expect(screen.queryByText(en.student.productWithoutCoursesTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(en.errors.messageIntegrationUnavailable)).not.toBeInTheDocument();
  });

  it('keeps the course view and adds downloads below the courses for a mixed product', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: { products: [{
        ...product, accessItems: [{ level: 'course', courseId: 'c1' }],
      }] } })),
      http.get('/api/student/courses', () => HttpResponse.json({ ok: true, data: { courses: [{
        id: 'c1', tenantId: 't1', name: 'Field course', description: '', imageUrl: null,
        moduleOrder: [], legacyId: null, publiclyVisible: false, createdAt: '2026-07-01T00:00:00.000Z',
      }] } })),
    );

    await renderProduct();

    const courses = await screen.findByTestId('product-course-links');
    expect(within(screen.getByRole('banner')).getByText(en.student.courseEyebrow)).toBeVisible();
    expect(within(courses).getByRole('link', { name: 'Field course' })).toHaveAttribute('href', '/my/courses/c1');
    const files = screen.getByTestId('product-downloads-download-1');
    expect(within(files).getByRole('heading', { name: en.student.downloadsHeading })).toBeVisible();
    expect(courses.compareDocumentPosition(files)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId('download-asset-1')).toBeVisible();
    expect(screen.queryByText(en.student.downloadProductBody)).not.toBeInTheDocument();
  });

  it('keeps download-only titles linked to the product page in My products', async () => {
    server.use(myProducts());

    await renderPage(MyProductsPage, '/my/products');

    expect(await screen.findByRole('link', { name: product.title })).toHaveAttribute('href', '/my/course/download-1');
    expect(screen.getByTestId('download-asset-1')).toBeVisible();
  });
});
