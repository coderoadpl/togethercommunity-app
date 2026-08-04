import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
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
      priceCents: 4900,
      currency: 'PLN',
      grantStatus: 'active',
      grantStartsAt: '2026-07-01T00:00:00.000Z',
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
  it('lists my products with course links', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: productsBody })),
      http.get('/api/tenant/settings', () => HttpResponse.json({
        ok: true,
        data: { settings: {
          name: 'Akademia', socialLinks: [], billingPortalUrl: null, bunnyStreamLibraryId: null,
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

    expect(await screen.findByRole('heading', { name: pl.student.myProducts })).toBeInTheDocument();
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
                currentPeriodEnd: '2026-08-18T00:00:00.000Z',
                cancelAtPeriodEnd: false,
              },
            },
            {
              ...productsBody.products[0],
              id: 'past-due',
              subscription: {
                id: 'sub-past-due',
                status: 'past_due',
                currentPeriodEnd: '2026-08-19T00:00:00.000Z',
                cancelAtPeriodEnd: false,
              },
            },
            {
              ...productsBody.products[0],
              id: 'canceled',
              subscription: {
                id: 'sub-canceled',
                status: 'canceled',
                currentPeriodEnd: '2026-08-20T00:00:00.000Z',
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
            name: 'Akademia',
            socialLinks: [],
            billingPortalUrl: 'https://billing.stripe.com/p/login/example',
            bunnyStreamLibraryId: null,
          },
        },
      })),
    );

    await renderPage(MyProductsPage, '/my/products');

    expect(await screen.findByTestId('subscription-status-active')).toHaveTextContent(
      pl.student.subscriptionActiveLabel,
    );
    expect(screen.getByTestId('subscription-status-past-due')).toHaveTextContent(
      pl.student.subscriptionPastDueLabel,
    );
    expect(screen.getByTestId('subscription-status-canceled')).toHaveTextContent('Anulowana — dostęp do');
    expect(screen.getByTestId('subscription-date-active')).toHaveTextContent('Odnowienie:');
    expect(screen.getByTestId('subscription-date-canceled')).toHaveTextContent('Dostęp do:');
    expect(screen.getAllByRole('link', { name: pl.student.manageSubscription })).toHaveLength(3);
  });

  it('renders purchased digital-download buttons alongside the course link', async () => {
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
              productId: 'download-1',
              fileName: 'workbook.pdf',
              contentType: 'application/pdf',
              sizeBytes: 4096,
              status: 'ready',
              createdAt: '2026-07-12T00:00:00.000Z',
              downloadPath: '/api/my/products/download-1/downloads/asset-1',
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

    expect(await screen.findByRole('link', { name: pl.student.downloadFile({ name: 'workbook.pdf' }) }))
      .toHaveAttribute('href', '/api/my/products/download-1/downloads/asset-1');
    expect(screen.getByRole('link', { name: 'Creator workbook' }))
      .toHaveAttribute('href', '/my/course/download-1');
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
    expect(screen.getByRole('heading', { name: pl.student.courseContentComingSoon })).toBeInTheDocument();
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
                name: 'Kurs front-end od A do Z',
                description: '',
                imageUrl: null,
                moduleOrder: [],
                legacyId: null,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        }),
      ),
    );

    await renderPage(() => <CoursePage productId="course-1" />, '/my/course/course-1');

    expect(await screen.findByTestId('product-course-links')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kurs front-end od A do Z' })).toHaveAttribute(
      'href',
      '/my/courses/c1',
    );
    expect(
      screen.queryByRole('heading', { name: pl.student.courseContentComingSoon }),
    ).not.toBeInTheDocument();
  });
});
