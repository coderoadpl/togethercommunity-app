import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { Course, MemberNavigation } from '#core/domain/index.js';

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
    moduleOrder: [],
    publiclyVisible: false,
    legacyId: null,
    createdAt: '2026-07-12T10:00:00.000Z',
  },
];

const navigation = (courseCounts: MemberNavigation['courses'] = []) =>
  http.get('/api/member/navigation', () =>
    HttpResponse.json({
      ok: true,
      data: { navigation: { spaces: [], courses: courseCounts, lockedSpaces: [] } },
    }),
  );

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
  it('lists accessible courses with navigation-fed progress and a link to the course', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: { userId: 'u1', email: 'free@together.dev', name: 'Free', tenant: null },
        }),
      ),
      http.get('/api/student/courses', () =>
        HttpResponse.json({ ok: true, data: { courses } }),
      ),
      navigation([
        {
          courseId: 'course-1',
          courseName: 'JavaScript Foundations',
          completedLessonCount: 1,
          accessibleLessonCount: 3,
          lastActivityAt: '2026-08-10T10:00:00.000Z',
        },
      ]),
    );

    await renderPage(<MyCoursesPage />);

    expect(await screen.findByRole('heading', { name: pl.student.myCourses })).toBeInTheDocument();
    const card = await screen.findByTestId('course-card-course-1');
    expect(card).toHaveAttribute('href', '/my/courses/course-1');
    expect(screen.getByText('Start from zero.')).toBeInTheDocument();
    expect(await screen.findByTestId('course-progress-course-1')).toHaveTextContent('33%');
    expect(within(screen.getByRole('banner')).queryAllByRole('link')).toHaveLength(0);
  });

  it('shows an empty state when no courses are accessible', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: { userId: 'u1', email: 'free@together.dev', name: 'Free', tenant: null },
        }),
      ),
      http.get('/api/student/courses', () =>
        HttpResponse.json({ ok: true, data: { courses: [] } }),
      ),
      navigation(),
    );

    await renderPage(<MyCoursesPage />);

    expect(await screen.findByRole('heading', { name: pl.student.noCourses })).toBeInTheDocument();
    const empty = screen.getByTestId('my-courses-empty-state');
    expect(within(empty).getByTestId('empty-library-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(pl.student.coursesWillAppear);
  });

  it('renders a cover image when set and a tinted initials placeholder otherwise', async () => {
    const base = courses[0];
    if (base === undefined) throw new Error('missing course fixture');
    const withCover: Course = {
      ...base,
      id: 'course-2',
      name: 'React w praktyce',
      imageUrl: 'https://picsum.photos/seed/react/960/540',
    };
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: { userId: 'u1', email: 'free@together.dev', name: 'Free', tenant: null },
        }),
      ),
      http.get('/api/student/courses', () =>
        HttpResponse.json({ ok: true, data: { courses: [...courses, withCover] } }),
      ),
      navigation(),
    );

    await renderPage(<MyCoursesPage />);

    const cover = await screen.findByTestId('course-cover-course-2');
    expect(cover.tagName).toBe('IMG');
    expect(cover).toHaveAttribute('src', 'https://picsum.photos/seed/react/960/540');

    const fallback = screen.getByTestId('course-cover-fallback-course-1');
    expect(fallback).toHaveTextContent('JF');
    expect(screen.queryByTestId('course-cover-course-1')).not.toBeInTheDocument();
  });
});
