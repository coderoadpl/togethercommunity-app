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

const myProducts = (value: Record<string, unknown> = product) => http.get('/api/my/products', () =>
  HttpResponse.json({ ok: true, data: { products: [value] } }));

const renderProduct = () => renderPage(() => <CoursePage productId="download-1" />);

describe('download product page', () => {
  it('shows the description, download guidance and versioned files instead of the empty course state', async () => {
    server.use(myProducts(), noCourses());

    await renderProduct();

    expect(await screen.findByRole('heading', { level: 1, name: product.title })).toBeVisible();
    expect(within(screen.getByRole('banner')).getByText(en.student.productEyebrow)).toBeVisible();
    expect(within(screen.getByRole('banner')).queryByText(en.student.downloadsHeading)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/copy identifier/u)).not.toBeInTheDocument();
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
    expect(within(screen.getByRole('banner')).getByText(en.student.productEyebrow)).toBeVisible();
    expect(within(screen.getByRole('banner')).queryByText(en.student.courseEyebrow)).not.toBeInTheDocument();
    expect(within(courses).getByRole('link', { name: /Field course/u })).toHaveAttribute('href', '/my/courses/c1');
    expect(within(courses).getByTestId('course-row-c1')).toHaveTextContent(en.student.openCourse);
    expect(screen.getByText('A practical companion.').compareDocumentPosition(courses)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const files = screen.getByTestId('product-downloads-download-1');
    expect(within(files).getByRole('heading', { name: en.student.downloadsHeading })).toBeVisible();
    expect(courses.compareDocumentPosition(files)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId('download-asset-1')).toBeVisible();
    expect(screen.queryByText(en.student.downloadProductBody)).not.toBeInTheDocument();
  });

  it('shows each granted course as a row that says whether it opens or continues the course', async () => {
    const courseView = (id: string, name: string) => ({
      id, tenantId: 't1', name, description: '', imageUrl: null, moduleOrder: [], legacyId: null,
      publiclyVisible: false, createdAt: '2026-07-01T00:00:00.000Z',
    });
    server.use(
      myProducts({ ...product, downloads: [], accessItems: [{ level: 'course', courseId: 'c1' }, { level: 'course', courseId: 'c2' }] }),
      http.get('/api/student/courses', () => HttpResponse.json({ ok: true, data: { courses: [
        courseView('c1', 'Started course'), courseView('c2', 'New course'),
      ] } })),
      http.get('/api/member/navigation', () => HttpResponse.json({ ok: true, data: { navigation: {
        spaces: [], lockedSpaces: [],
        courses: [
          { courseId: 'c1', courseName: 'Started course', completedLessonCount: 2, accessibleLessonCount: 5, lastActivityAt: null },
          { courseId: 'c2', courseName: 'New course', completedLessonCount: 0, accessibleLessonCount: 3, lastActivityAt: null },
        ],
      } } })),
    );

    await renderProduct();

    const started = await screen.findByTestId('course-row-c1');
    expect(started).toHaveAttribute('href', '/my/courses/c1');
    await within(started).findByText(en.student.continueCourse);
    expect(screen.getByTestId('course-row-c2')).toHaveTextContent(en.student.openCourse);
    expect(screen.getByText(en.student.productCoursesHint)).toBeVisible();
  });

  it('keeps download-only titles linked to the product page in My products', async () => {
    server.use(myProducts());

    await renderPage(MyProductsPage, '/my/products');

    expect(await screen.findByRole('link', { name: product.title })).toHaveAttribute('href', '/my/course/download-1');
    expect(screen.getByTestId('download-asset-1')).toBeVisible();
  });
});

const breadcrumbTrail = async () => {
  const trail = await screen.findByTestId('member-breadcrumbs');
  return {
    links: within(trail).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    text: trail.textContent,
  };
};

describe('product page header and states', () => {
  it('shows the My products trail and a neutral Product eyebrow while loading', async () => {
    server.use(http.get('/api/my/products', () => new Promise<never>(() => undefined)), noCourses());

    await renderProduct();

    const banner = within(screen.getByRole('banner'));
    expect(await banner.findByRole('heading', { level: 1, name: en.student.loadingProduct })).toBeVisible();
    expect(banner.getByText(en.student.productEyebrow, { selector: '.MuiTypography-overline' })).toBeVisible();
    expect(banner.queryByText(en.student.courseEyebrow)).not.toBeInTheDocument();
    expect((await breadcrumbTrail()).links).toEqual([[en.student.myProducts, '/my/products']]);
  });

  it('names the failure in the heading and keeps the trail when the products request fails', async () => {
    server.use(http.get('/api/my/products', () => HttpResponse.json({
      ok: false, error: { code: 'unavailable', message: 'Products unavailable' },
    }, { status: 503 })), noCourses());

    await renderProduct();

    expect(await screen.findByRole('heading', { level: 1, name: en.student.productLoadFailed })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1, name: en.student.myProducts })).not.toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText(en.student.productEyebrow, { selector: '.MuiTypography-overline' })).toBeVisible();
    expect((await breadcrumbTrail()).links).toEqual([[en.student.myProducts, '/my/products']]);
  });

  it('says the product was not found and links back to My products', async () => {
    server.use(myProducts({ ...product, id: 'other-product' }), noCourses());

    await renderProduct();

    expect(await screen.findByRole('heading', { level: 1, name: en.student.productNotFound })).toBeVisible();
    expect(screen.getByText(en.student.productNotInLibrary)).toBeVisible();
    expect(screen.getByRole('link', { name: en.student.backToMyProducts })).toHaveAttribute('href', '/my/products');
    const trail = await breadcrumbTrail();
    expect(trail.links).toEqual([[en.student.myProducts, '/my/products']]);
    expect(trail.text).toContain(en.student.productNotFound);
  });

  it('puts the product title last in the trail of a loaded product', async () => {
    server.use(myProducts(), noCourses());

    await renderProduct();

    await screen.findByRole('heading', { level: 1, name: product.title });
    const trail = await breadcrumbTrail();
    expect(trail.links).toEqual([[en.student.myProducts, '/my/products']]);
    expect(trail.text).toContain(product.title);
  });

  it('tells an expired buyer when access ended and offers renewal instead of the no-courses state', async () => {
    server.use(myProducts({
      ...product, type: 'course', accessItems: [{ level: 'course', courseId: 'c1' }], downloads: [],
      grantStatus: 'expired', grantExpiresAt: '2026-07-20T00:00:00.000Z',
    }), noCourses());

    await renderProduct();

    const expired = await screen.findByTestId('product-access-expired');
    expect(expired).toHaveTextContent(/^Your access expired on .+2026\./u);
    expect(within(expired).getByRole('link', { name: en.student.renewAccess })).toHaveAttribute('href', '/checkout/download-1');
    expect(screen.queryByText(en.student.productWithoutCoursesTitle)).not.toBeInTheDocument();
    expect(screen.getByText('A practical companion.')).toBeVisible();
  });

  it('says renewal is unavailable when an expired product can no longer be bought', async () => {
    server.use(myProducts({
      ...product, downloads: [], purchasable: false, grantStatus: 'expired', grantExpiresAt: '2026-07-20T00:00:00.000Z',
    }), noCourses());

    await renderProduct();

    const expired = await screen.findByTestId('product-access-expired');
    expect(expired).toHaveTextContent(en.student.renewalUnavailable);
    expect(within(expired).queryByRole('link')).not.toBeInTheDocument();
  });

  it('tells an upcoming buyer when access starts', async () => {
    server.use(myProducts({
      ...product, downloads: [], grantStatus: 'upcoming', grantStartsAt: '2026-08-01T00:00:00.000Z',
    }), noCourses());

    await renderProduct();

    const upcoming = await screen.findByTestId('product-access-upcoming');
    expect(upcoming).toHaveTextContent(/^Access opens on .+2026\./u);
    expect(screen.queryByText(en.student.productWithoutCoursesTitle)).not.toBeInTheDocument();
  });
});
