import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { Course } from '@core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MyCoursesPage } from './MyCoursesPage.js';

const courses: Course[] = [
  {
    id: 'course-1',
    tenantId: 't1',
    name: 'JavaScript Foundations',
    description: 'Start from zero.',
    imageUrl: null,
    legacyId: null,
    createdAt: '2026-07-12T10:00:00.000Z',
  },
];

const renderPage = async (node: ReactNode) => {
  const rootRoute = createRootRoute({ component: () => node });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('MyCoursesPage', () => {
  it('lists accessible courses with a completion state and a link to the course', async () => {
    server.use(
      http.get('/api/student/courses', () =>
        HttpResponse.json({ ok: true, data: { courses } }),
      ),
      http.get('/api/student/courses/:courseId/structure', () =>
        HttpResponse.json({
          ok: true,
          data: {
            structure: {
              courseId: 'course-1',
              name: 'JavaScript Foundations',
              accessStatus: 'partially-accessible',
              completionStatus: 'partially-completed',
              modules: [],
            },
          },
        }),
      ),
    );

    await renderPage(<MyCoursesPage />);

    expect(await screen.findByRole('heading', { name: pl.student.myCourses })).toBeInTheDocument();
    const card = screen.getByTestId('course-card-course-1');
    expect(card).toHaveAttribute('href', '/my/courses/course-1');
    expect(screen.getByText('Start from zero.')).toBeInTheDocument();
    expect(await screen.findByTestId('completion-course-1')).toHaveTextContent(pl.student.completionInProgress);
    expect(screen.getByRole('link', { name: pl.student.myProducts })).toHaveAttribute('href', '/my/products');
  });

  it('shows an empty state when no courses are accessible', async () => {
    server.use(
      http.get('/api/student/courses', () =>
        HttpResponse.json({ ok: true, data: { courses: [] } }),
      ),
    );

    await renderPage(<MyCoursesPage />);

    expect(await screen.findByRole('heading', { name: pl.student.noCourses })).toBeInTheDocument();
  });
});
