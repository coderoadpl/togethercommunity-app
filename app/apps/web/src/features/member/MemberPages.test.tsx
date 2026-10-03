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

const productsBody = {
  products: [
    {
      id: 'course-1',
      type: 'course',
      title: 'Intro Course',
      description: 'Start here.',
      accessItems: [{ level: 'course', courseId: 'c1' }],
      priceCents: 4900,
      currency: 'PLN',
      purchasable: true,
      grantStatus: 'active',
      grantStartsAt: '1998-07-01T00:00:00.000Z',
      grantExpiresAt: null,
      subscription: null,
      downloads: [],
    },
  ],
};

const renderPage = async (component: () => ReactNode, path: string) => {
  const rootRoute = createRootRoute({ component });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('member pages', () => {
  it.each([true, false])('shows renewal only for purchasable expired products: %s', async (purchasable) => {
    server.use(http.get('/api/my/products', () => HttpResponse.json({
      ok: true,
      data: { products: [{
        ...productsBody.products[0],
        purchasable,
        grantStatus: 'expired',
        grantExpiresAt: '1998-07-02T00:00:00.000Z',
      }] },
    })));
    await renderPage(MyProductsPage, '/my/products');
    const product = within(await screen.findByTestId('my-product-course-1'));
    if (purchasable) {
      expect(product.getByRole('link', { name: en.student.renewAccess })).toHaveAttribute('href', '/checkout/course-1');
      expect(product.queryByText(en.student.renewalUnavailable)).not.toBeInTheDocument();
    } else {
      expect(product.queryByRole('link', { name: en.student.renewAccess })).not.toBeInTheDocument();
      expect(product.getByText(en.student.renewalUnavailable)).toBeInTheDocument();
    }
  });

  it('lists my products with course links', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: productsBody })),
      http.get('/api/tenant/settings', () => HttpResponse.json({
        ok: true,
        data: { settings: {
          name: 'Academy', socialLinks: [], billingPortalUrl: null, bunnyStreamLibraryId: null,
        } },
      })),
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: { userId: 'u1', email: 'free@together.dev', name: 'Free', tenant: null },
        }),
      ),
    );

    await renderPage(MyProductsPage, '/my');

    expect(await screen.findByRole('heading', { name: en.student.myProducts })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Intro Course/ })).toHaveAttribute(
      'href',
      '/my/course/course-1',
    );
  });

  it('shows active, past-due and canceled subscription states with billing management', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({
        ok: true,
        data: {
          products: [
            {
              ...productsBody.products[0],
              id: 'active',
              subscription: {
                id: 'sub-active',
                status: 'active',
                currentPeriodEnd: '1998-08-18T00:00:00.000Z',
                cancelAtPeriodEnd: false,
              },
            },
            {
              ...productsBody.products[0],
              id: 'past-due',
              subscription: {
                id: 'sub-past-due',
                status: 'past_due',
                currentPeriodEnd: '1998-08-19T00:00:00.000Z',
                cancelAtPeriodEnd: false,
              },
            },
            {
              ...productsBody.products[0],
              id: 'canceled',
              subscription: {
                id: 'sub-canceled',
                status: 'canceled',
                currentPeriodEnd: '1998-08-20T00:00:00.000Z',
                cancelAtPeriodEnd: false,
              },
            },
          ],
        },
      })),
      http.get('/api/tenant/settings', () => HttpResponse.json({
        ok: true,
        data: {
          settings: {
            name: 'Academy',
            socialLinks: [],
            billingPortalUrl: 'https://billing.stripe.com/p/login/example',
            bunnyStreamLibraryId: null,
          },
        },
      })),
    );

    await renderPage(MyProductsPage, '/my/products');

    expect(await screen.findByTestId('subscription-status-active')).toHaveTextContent(
      en.student.subscriptionActiveLabel,
    );
    expect(screen.getByTestId('subscription-status-past-due')).toHaveTextContent(
      en.student.subscriptionPastDueLabel,
    );
    expect(screen.getByTestId('subscription-status-canceled')).toHaveTextContent(
      en.student.subscriptionCanceledLabel({ date: '' }),
    );
    expect(screen.queryByTestId('grant-status-active')).not.toBeInTheDocument();
    expect(screen.getByTestId('subscription-date-active')).toHaveTextContent(
      en.student.subscriptionRenewalDate({ date: '' }),
    );
    expect(screen.getByTestId('subscription-date-canceled')).toHaveTextContent(
      en.student.subscriptionAccessUntil({ date: '' }),
    );
    expect(screen.getAllByRole('link', { name: en.student.manageSubscription })).toHaveLength(3);
  });

  it('renders latest and collapsed previous versions with their own links', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({
        ok: true,
        data: {
          products: [{
            ...productsBody.products[0],
            id: 'download-1',
            type: 'digital_download',
            title: 'Creator workbook',
            downloads: [{
              id: 'asset-1',
              lineageId: 'asset-1',
              versionNumber: 2,
              versionNote: 'Corrected diagram',
              supersededAt: null,
              productId: 'download-1',
              fileName: 'workbook.pdf',
              contentType: 'application/pdf',
              sizeBytes: 4096,
              status: 'ready',
              createdAt: '1998-07-12T00:00:00.000Z',
              downloadPath: '/api/my/products/download-1/downloads/asset-1',
              personalisationSizeExceeded: false,
              previousVersions: [{
                id: 'previous', lineageId: 'asset-1', versionNumber: 1, versionNote: 'First edition',
                supersededAt: '1998-07-12T00:00:00.000Z', productId: 'download-1',
                fileName: 'original.pdf', contentType: 'application/pdf', sizeBytes: 2048, status: 'ready',
                createdAt: '1998-07-01T00:00:00.000Z', downloadPath: '/api/my/products/download-1/downloads/previous',
                personalisationSizeExceeded: true,
              }],
            }],
          }],
        },
      })),
      http.get('/api/tenant/settings', () => HttpResponse.json({
        ok: true,
        data: { settings: { billingPortalUrl: null, bunnyStreamLibraryId: null } },
      })),
    );

    await renderPage(MyProductsPage, '/my/products');

    expect(await screen.findByRole('link', { name: `${en.student.downloadFile({ name: 'workbook.pdf' })} · ${en.products.fileVersion({ number: 2 })}` }))
      .toHaveAttribute('href', '/api/my/products/download-1/downloads/asset-1');
    expect(screen.getByText('Corrected diagram')).toBeVisible();
    expect(screen.getByText('First edition')).not.toBeVisible();
    await userEvent.click(screen.getByText(en.products.previousVersions));
    expect(screen.getByText('First edition')).toBeVisible();
    expect(screen.getByTestId('download-previous')).toHaveAttribute('href', '/api/my/products/download-1/downloads/previous');
    expect(screen.getByText(en.student.downloadNoCopyIdentifier)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Creator workbook' }))
      .toHaveAttribute('href', '/my/course/download-1');
  });

  it('shows when a buyer download is delivered without a copy identifier', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({
        ok: true,
        data: {
          products: [{
            ...productsBody.products[0],
            id: 'download-1',
            type: 'digital_download',
            title: 'Creator workbook',
            downloads: [{
              id: 'asset-1',
              lineageId: 'asset-1',
              versionNumber: 1,
              versionNote: null,
              supersededAt: null,
              productId: 'download-1',
              fileName: 'large-workbook.pdf',
              contentType: 'application/pdf',
              sizeBytes: 21 * 1024 * 1024,
              status: 'ready',
              createdAt: '1998-07-12T00:00:00.000Z',
              downloadPath: '/api/my/products/download-1/downloads/asset-1',
              previousVersions: [],
              personalisationSizeExceeded: true,
            }, {
              id: 'asset-2',
              lineageId: 'asset-2',
              versionNumber: 1,
              versionNote: null,
              supersededAt: null,
              productId: 'download-1',
              fileName: 'equal-limit-workbook.pdf',
              contentType: 'application/pdf',
              sizeBytes: 20 * 1024 * 1024,
              status: 'ready',
              createdAt: '1998-07-12T00:00:00.000Z',
              downloadPath: '/api/my/products/download-1/downloads/asset-2',
              previousVersions: [],
              personalisationSizeExceeded: false,
            }, {
              id: 'asset-3',
              lineageId: 'asset-3',
              versionNumber: 1,
              versionNote: null,
              supersededAt: null,
              productId: 'download-1',
              fileName: 'regular-workbook.pdf',
              contentType: 'application/pdf',
              sizeBytes: 1024,
              status: 'ready',
              createdAt: '1998-07-12T00:00:00.000Z',
              downloadPath: '/api/my/products/download-1/downloads/asset-3',
              previousVersions: [],
            }],
          }],
        },
      })),
      http.get('/api/tenant/settings', () => HttpResponse.json({
        ok: true,
        data: { settings: { billingPortalUrl: null, bunnyStreamLibraryId: null } },
      })),
    );

    await renderPage(MyProductsPage, '/my/products');

    expect(await screen.findByRole('link', { name: `${en.student.downloadFile({ name: 'large-workbook.pdf' })} · ${en.products.fileVersion({ number: 1 })}` }))
      .toHaveAttribute('href', '/api/my/products/download-1/downloads/asset-1');
    expect(screen.getByRole('link', { name: `${en.student.downloadFile({ name: 'equal-limit-workbook.pdf' })} · ${en.products.fileVersion({ number: 1 })}` }))
      .toHaveAttribute('href', '/api/my/products/download-1/downloads/asset-2');
    expect(screen.getByRole('link', { name: `${en.student.downloadFile({ name: 'regular-workbook.pdf' })} · ${en.products.fileVersion({ number: 1 })}` }))
      .toHaveAttribute('href', '/api/my/products/download-1/downloads/asset-3');
    expect(screen.getAllByText(en.student.downloadNoCopyIdentifier)).toHaveLength(1);
  });

  it('renders the coming-soon stub when the member can access no course yet', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: productsBody })),
      http.get('/api/student/courses', () =>
        HttpResponse.json({ ok: true, data: { courses: [] } }),
      ),
    );

    await renderPage(() => <CoursePage productId="course-1" />, '/my/course/course-1');

    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.student.productWithoutCoursesTitle })).toBeInTheDocument();
  });

  it('links a purchased product to the courses the member can browse', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: productsBody })),
      http.get('/api/student/courses', () =>
        HttpResponse.json({
          ok: true,
          data: {
            courses: [
              {
                id: 'c1',
                tenantId: 't1',
                name: 'Front-end Course',
                description: '',
                imageUrl: null,
                moduleOrder: [],
                legacyId: null,
                createdAt: '1998-01-01T00:00:00.000Z',
              },
              {
                id: 'c2',
                tenantId: 't1',
                name: 'A different product course',
                description: '',
                imageUrl: null,
                moduleOrder: [],
                legacyId: null,
                createdAt: '1998-01-02T00:00:00.000Z',
              },
            ],
          },
        }),
      ),
    );

    await renderPage(() => <CoursePage productId="course-1" />, '/my/course/course-1');

    expect(await screen.findByTestId('product-course-links')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Front-end Course' })).toHaveAttribute(
      'href',
      '/my/courses/c1',
    );
    expect(screen.queryByRole('link', { name: 'A different product course' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Intro Course');
    expect(within(screen.getByRole('banner')).queryAllByRole('link')).toHaveLength(0);
    expect(
      screen.queryByRole('heading', { name: en.student.productWithoutCoursesTitle }),
    ).not.toBeInTheDocument();
  });

  it('shows a course loading error with retry instead of a coming-soon state', async () => {
    let requests = 0;
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: productsBody })),
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: {
            userId: 'u1',
            email: 'free@together.dev',
            emailVerified: true,
            name: 'Free',
            tenant: null,
          },
        }),
      ),
      http.get('/api/notifications/unread-count', () =>
        HttpResponse.json({ ok: true, data: { unread: 0 } }),
      ),
      http.get('/api/student/courses', () => {
        requests += 1;
        return requests === 1
          ? HttpResponse.json(
              { ok: false, error: { code: 'unavailable', message: 'Courses unavailable' } },
              { status: 503 },
            )
          : HttpResponse.json({ ok: true, data: { courses: [] } });
      }),
    );

    await renderPage(() => <CoursePage productId="course-1" />, '/my/course/course-1');

    expect(await screen.findByText(en.errors.messageIntegrationUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.student.productWithoutCoursesTitle })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('main')).getByRole('button', { name: en.student.retryCourses }));
    expect(await screen.findByRole('heading', { name: en.student.productWithoutCoursesTitle })).toBeInTheDocument();
  });
});
