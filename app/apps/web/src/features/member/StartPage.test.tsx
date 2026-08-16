import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { Course, MemberNavigation } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { StartPage } from './StartPage.js';

const course = (id: string, name: string): Course => ({
  id,
  tenantId: 't1',
  name,
  description: '',
  imageUrl: null,
  moduleOrder: [],
  legacyId: null,
  createdAt: '2026-07-12T10:00:00.000Z',
});

const okCourses = (list: Course[]) =>
  http.get('/api/student/courses', () => HttpResponse.json({ ok: true, data: { courses: list } }));

const okNavigation = (value: Partial<MemberNavigation> = {}) =>
  http.get('/api/member/navigation', () =>
    HttpResponse.json({
      ok: true,
      data: {
        navigation: { spaces: [], courses: [], lockedSpaces: [], ...value },
      },
    }),
  );

const lesson = (id: string, name: string, completed: boolean) => ({
  contentId: `content-${id}`,
  lessonId: id,
  name,
  accessStatus: 'fully-accessible',
  completionStatus: completed ? 'fully-completed' : 'not-completed',
});

const okStructures = (lessonsByCourse: Record<string, ReturnType<typeof lesson>[]>) =>
  http.get('/api/student/courses/:courseId/structure', ({ params }) => {
    const courseId = String(params.courseId);
    return HttpResponse.json({
      ok: true,
      data: {
        structure: {
          courseId,
          name: courseId,
          accessStatus: 'fully-accessible',
          completionStatus: 'partially-completed',
          modules: [
            {
              id: `module-${courseId}`,
              name: 'Moduł',
              accessStatus: 'fully-accessible',
              completionStatus: 'partially-completed',
              chapters: [
                {
                  id: `chapter-${courseId}`,
                  name: 'Rozdział',
                  accessStatus: 'fully-accessible',
                  completionStatus: 'partially-completed',
                  lessons: lessonsByCourse[courseId] ?? [],
                },
              ],
            },
          ],
        },
      },
    });
  });

const noNotifications = () =>
  http.get('/api/notifications/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread: 0 } }));

const space = (id: string, name: string) => ({
  id,
  slug: id,
  name,
  visibility: 'members' as const,
  position: 0,
  isFollowing: false,
});

const renderStart = async () => {
  const rootRoute = createRootRoute();
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    component: StartPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([startRoute]),
    history: createMemoryHistory({ initialEntries: ['/start'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('StartPage', () => {
  it('points the continue bar at the last active course and its unfinished lesson', async () => {
    server.use(
      okCourses([course('c1', 'JavaScript od zera'), course('c2', 'CSS w praktyce')]),
      okNavigation({
        courses: [
          {
            courseId: 'c1',
            courseName: 'JavaScript od zera',
            completedLessonCount: 1,
            accessibleLessonCount: 3,
            lastViewedLessonId: 'l2',
            lastActivityAt: '2026-08-11T10:00:00.000Z',
          },
          {
            courseId: 'c2',
            courseName: 'CSS w praktyce',
            completedLessonCount: 0,
            accessibleLessonCount: 2,
            lastActivityAt: '2026-08-09T10:00:00.000Z',
          },
        ],
      }),
      okStructures({
        c1: [lesson('l1', 'Wstęp', true), lesson('l2', 'Zmienne', false)],
      }),
      noNotifications(),
    );

    await renderStart();

    const bar = await screen.findByTestId('start-continue');
    expect(bar).toHaveAttribute('href', '/my/courses/c1/lessons/l2');
    expect(bar).toHaveTextContent(
      pl.start.continueLabel({ lesson: 'Zmienne', course: 'JavaScript od zera' }),
    );
    expect(bar).toHaveTextContent('33%');
  });

  it('offers a review when the last active course is already finished', async () => {
    server.use(
      okCourses([course('c2', 'CSS w praktyce')]),
      okNavigation({
        courses: [
          {
            courseId: 'c2',
            courseName: 'CSS w praktyce',
            completedLessonCount: 1,
            accessibleLessonCount: 1,
            lastActivityAt: '2026-08-09T10:00:00.000Z',
          },
        ],
      }),
      okStructures({ c2: [lesson('l9', 'Selektory', true)] }),
      noNotifications(),
    );

    await renderStart();

    const bar = await screen.findByTestId('start-continue');
    expect(bar).toHaveAttribute('href', '/my/courses/c2/lessons/l9');
    expect(bar).toHaveTextContent(
      pl.start.reviewLabel({ lesson: 'Selektory', course: 'CSS w praktyce' }),
    );
  });

  it('hides the continue bar when no course is entitled', async () => {
    server.use(
      okCourses([]),
      okNavigation({ spaces: [space('s1', 'Ogólna')] }),
      noNotifications(),
    );

    await renderStart();

    expect(await screen.findByTestId('start-spaces')).toBeInTheDocument();
    expect(screen.queryByTestId('start-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('start-courses')).not.toBeInTheDocument();
  });

  it('sells locked spaces through a checkout CTA and stays quiet without a product', async () => {
    server.use(
      okCourses([]),
      okNavigation({
        lockedSpaces: [
          { id: 's9', slug: 'premium', name: 'Premium', description: 'Tylko dla kursantów.', productIds: ['p1'] },
          { id: 's8', slug: 'orphan', name: 'Bez produktu', description: null, productIds: [] },
        ],
      }),
      noNotifications(),
    );

    await renderStart();

    const sold = await screen.findByTestId('locked-space-card-s9');
    expect(sold).toHaveTextContent('Tylko dla kursantów.');
    const cta = within(sold).getByTestId('locked-space-cta-s9');
    expect(cta).toHaveAttribute('href', '/checkout/p1');
    expect(cta).toHaveTextContent(pl.courseTree.unlockAccess);

    const orphan = screen.getByTestId('locked-space-card-s8');
    expect(within(orphan).queryByTestId('locked-space-cta-s8')).not.toBeInTheDocument();
  });

  it('renders course tiles with navigation-fed progress and no space section', async () => {
    server.use(
      okCourses([course('c1', 'JavaScript od zera')]),
      okNavigation({
        courses: [
          {
            courseId: 'c1',
            courseName: 'JavaScript od zera',
            completedLessonCount: 1,
            accessibleLessonCount: 4,
            lastActivityAt: null,
          },
        ],
      }),
      okStructures({ c1: [lesson('l1', 'Wstęp', false)] }),
      noNotifications(),
    );

    await renderStart();

    const courses = await screen.findByTestId('start-courses');
    expect(within(courses).getByTestId('course-card-c1')).toHaveAttribute('href', '/my/courses/c1');
    expect(within(courses).getByTestId('course-progress-c1')).toHaveTextContent('25%');
    expect(screen.queryByTestId('start-spaces')).not.toBeInTheDocument();
  });

  it('shows the empty state with a route to purchased products', async () => {
    server.use(okCourses([]), okNavigation(), noNotifications());

    await renderStart();

    const empty = await screen.findByTestId('start-empty-state');
    expect(within(empty).getByTestId('empty-library-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(pl.start.emptyTitle);
    expect(empty).toHaveTextContent(pl.start.emptyBody);
    expect(within(empty).getByRole('link', { name: pl.student.myProducts })).toHaveAttribute(
      'href',
      '/my/products',
    );
  });
});
