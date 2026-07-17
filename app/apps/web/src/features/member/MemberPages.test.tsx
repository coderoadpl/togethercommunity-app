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
      title: 'Intro Course',
      description: 'Start here.',
      priceCents: 4900,
      currency: 'PLN',
      grantStatus: 'active',
      grantStartsAt: '2026-07-01T00:00:00.000Z',
      grantExpiresAt: null,
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

  it('renders the course stub for a purchased product', async () => {
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: productsBody })),
    );

    await renderPage(() => <CoursePage productId="course-1" />, '/my/course/course-1');

    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: pl.student.courseContentComingSoon })).toBeInTheDocument();
  });
});
