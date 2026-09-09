import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { Course, MemberNavigation } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
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
  publiclyVisible: false,
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

const okResume = (courseId: string, id: string, name: string, isReview = false) =>
  http.get('/api/student/progress', () => HttpResponse.json({
    ok: true,
    data: { progress: { courseId, completedLessonIds: [], resume: {
      target: { id, name }, firstIncomplete: isReview ? null : { id, name }, isReview,
    } } },
  }));

const okHomeFeed = () =>
  http.get('/api/member/home-feed', () =>
    HttpResponse.json({ ok: true, data: { feed: { items: [], nextCursor: null } } }));

const noNotifications = () =>
  http.get('/api/notifications/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread: 0 } }));

const space = (id: string, name: string, unread = false) => ({
  id,
  slug: id,
  name,
  visibility: 'members' as const,
  position: 0,
  isFollowing: false,
  unread,
  courseIds: [],
});

const renderStart = async () => {
  const rootRoute = createRootRoute();
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    component: StartPage,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p>Guest preview</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([startRoute, homeRoute]),
    history: createMemoryHistory({ initialEntries: ['/start'] }),
  });
  await router.load();
  return { ...renderWithProviders(<RouterProvider router={router} />), router };
};

describe('StartPage', () => {
  it('points the continue bar at the last active course and its unfinished lesson', async () => {
    server.use(
      okCourses([course('c1', 'JavaScript from scratch'), course('c2', 'CSS w praktyce')]),
      okNavigation({
        courses: [
          {
            courseId: 'c1',
            courseName: 'JavaScript from scratch',
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
      okResume('c1', 'l2', 'Zmienne'),
      noNotifications(),
    );

    await renderStart();

    const card = await screen.findByTestId('start-continue');
    expect(within(card).getByTestId('start-continue-cta')).toHaveAttribute(
      'href',
      '/my/courses/c1/lessons/l2',
    );
    expect(within(card).getByTestId('start-continue-cta')).toHaveTextContent(en.start.continueCta);
    expect(card).toHaveTextContent('JavaScript from scratch');
    expect(card).toHaveTextContent(en.start.continueLabel({ lesson: 'Zmienne' }));
    expect(card).toHaveTextContent('33%');
    expect(within(card).getAllByText('33%')).toHaveLength(1);
    expect(within(card).queryByTestId('progress-ring')).not.toBeInTheDocument();
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
      okResume('c2', 'l9', 'Selektory', true),
      noNotifications(),
    );

    await renderStart();

    const card = await screen.findByTestId('start-continue');
    expect(within(card).getByTestId('start-continue-cta')).toHaveAttribute(
      'href',
      '/my/courses/c2/lessons/l9',
    );
    expect(within(card).getByTestId('start-continue-cta')).toHaveTextContent(en.start.reviewCta);
    expect(card).toHaveTextContent(en.start.reviewLabel({ lesson: 'Selektory' }));
  });

  it('hides the continue bar when no course is entitled', async () => {
    server.use(
      okCourses([]),
      okNavigation({ spaces: [space('s1', 'General')] }),
      okHomeFeed(),
      noNotifications(),
    );

    await renderStart();

    expect(await screen.findByTestId('start-spaces')).toBeInTheDocument();
    expect(screen.queryByTestId('start-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('start-courses')).not.toBeInTheDocument();
  });

  it('keeps locked-space visibility below the purchase row and stays quiet without a product', async () => {
    server.use(
      okCourses([]),
      okNavigation({
        lockedSpaces: [
          {
            id: 's9',
            slug: 'premium',
            name: 'Premium',
            description: 'Students only.',
            productIds: ['p1'],
            products: [{ id: 'p1', title: 'Kompletny program dla zaawansowanych' }],
          },
          { id: 's8', slug: 'orphan', name: 'Bez produktu', description: null, productIds: [] },
        ],
      }),
      noNotifications(),
    );

    await renderStart();

    const sold = await screen.findByTestId('locked-space-card-s9');
    expect(sold).toHaveTextContent('Students only.');
    const cta = within(sold).getByTestId('locked-space-cta-s9');
    expect(cta).toHaveAttribute('href', '/checkout/p1');
    expect(cta).toHaveTextContent(en.courseTree.unlockAccess);
    const visibility = within(sold).getByTestId('space-visibility-s9');
    expect(visibility).toHaveTextContent(
      en.community.productGatedFor({ product: 'Kompletny program dla zaawansowanych' }),
    );
    expect(cta.parentElement).toContainElement(within(sold).getByRole('heading', { name: 'Premium' }));
    expect(cta.parentElement).not.toContainElement(visibility);

    const orphan = screen.getByTestId('locked-space-card-s8');
    expect(within(orphan).queryByTestId('locked-space-cta-s8')).not.toBeInTheDocument();
  });

  it('renders course tiles with navigation-fed progress and no space section', async () => {
    server.use(
      okCourses([course('c1', 'JavaScript from scratch')]),
      okNavigation({
        courses: [
          {
            courseId: 'c1',
            courseName: 'JavaScript from scratch',
            completedLessonCount: 1,
            accessibleLessonCount: 4,
            lastActivityAt: null,
          },
        ],
      }),
      okResume('c1', 'l1', 'Introduction'),
      noNotifications(),
    );

    await renderStart();

    const courses = await screen.findByTestId('start-courses');
    expect(within(courses).getByTestId('course-card-c1')).toHaveAttribute('href', '/my/courses/c1');
    expect(within(courses).getByTestId('course-progress-c1')).toHaveTextContent('25%');
    expect(within(courses).getByTestId('start-courses-link')).toHaveAttribute('href', '/my');
    expect(screen.queryByTestId('start-spaces')).not.toBeInTheDocument();
  });

  it('marks a space tile with an unread dot only while it carries new posts', async () => {
    server.use(
      okCourses([]),
      okNavigation({ spaces: [space('s1', 'General', true), space('s2', 'Quiet')] }),
      okHomeFeed(),
      noNotifications(),
    );

    await renderStart();

    const loud = await screen.findByTestId('space-card-s1');
    expect(within(loud).getByTestId('space-unread-s1')).toHaveAccessibleName(
      en.shell.spaceUnreadLabel({ name: 'General' }),
    );
    expect(within(screen.getByTestId('space-card-s2')).queryByTestId('space-unread-s2')).not.toBeInTheDocument();
  });

  it('uses the visibility chip on start space cards', async () => {
    server.use(
      okCourses([]),
      okNavigation({
        spaces: [
          {
            ...space('s-public', en.spacesPanel.publicChip),
            publicReadOnly: true,
          },
          {
            ...space('s1', 'Premium'),
            visibility: 'product',
            products: [{ id: 'p1', title: 'Program Pro' }],
          },
        ],
      }),
      okHomeFeed(),
      noNotifications(),
    );

    await renderStart();

    expect(await screen.findByTestId('space-visibility-s-public')).toHaveTextContent(
      en.community.publicReadOnly,
    );
    expect(await screen.findByTestId('space-visibility-s1')).toHaveTextContent(
      en.community.productGatedFor({ product: 'Program Pro' }),
    );
  });

  it('sends the space section header to the community list', async () => {
    server.use(
      okCourses([]),
      okNavigation({ spaces: [space('s1', 'General')] }),
      okHomeFeed(),
      noNotifications(),
    );

    await renderStart();

    const spaces = await screen.findByTestId('start-spaces');
    expect(within(spaces).getByTestId('start-spaces-link')).toHaveAttribute('href', '/community');
  });

  it('places the home feed between the continue bar and the tile sections', async () => {
    server.use(
      okCourses([course('c1', 'JavaScript from scratch')]),
      okNavigation({
        spaces: [space('s1', 'General')],
        courses: [
          {
            courseId: 'c1',
            courseName: 'JavaScript from scratch',
            completedLessonCount: 1,
            accessibleLessonCount: 3,
            lastViewedLessonId: 'l2',
            lastActivityAt: '2026-08-11T10:00:00.000Z',
          },
        ],
      }),
      okResume('c1', 'l2', 'Zmienne'),
      okHomeFeed(),
      noNotifications(),
    );

    await renderStart();

    await screen.findByTestId('start-continue');
    const feed = screen.getByTestId('start-feed');
    expect(feed).toHaveTextContent(en.start.feedSection);
    expect([...(feed.parentElement?.children ?? [])].map((child) => child.getAttribute('data-testid')))
      .toEqual(['start-continue', 'start-feed', 'start-spaces', 'start-courses']);
  });

  it('hides the home feed when no space is accessible', async () => {
    server.use(
      okCourses([course('c1', 'JavaScript from scratch')]),
      okNavigation({
        courses: [
          {
            courseId: 'c1',
            courseName: 'JavaScript from scratch',
            completedLessonCount: 0,
            accessibleLessonCount: 2,
            lastActivityAt: null,
          },
        ],
      }),
      okResume('c1', 'l1', 'Introduction'),
      noNotifications(),
    );

    await renderStart();

    expect(await screen.findByTestId('start-courses')).toBeInTheDocument();
    expect(screen.queryByTestId('start-feed')).not.toBeInTheDocument();
  });

  it('shows the empty state with a route to purchased products', async () => {
    server.use(okCourses([]), okNavigation(), noNotifications());

    await renderStart();

    const empty = await screen.findByTestId('start-empty-state');
    expect(within(empty).getByTestId('empty-library-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(en.start.emptyTitle);
    expect(empty).toHaveTextContent(en.start.emptyBody);
    expect(within(empty).getByRole('link', { name: en.student.myProducts })).toHaveAttribute(
      'href',
      '/my/products',
    );
  });

  it('sends an anonymous visitor to the tenant home instead of the login page', async () => {
    server.use(
      http.get('/api/student/courses', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
          { status: 401 },
        ),
      ),
      http.get('/api/member/navigation', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
          { status: 401 },
        ),
      ),
    );

    const { router } = await renderStart();

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
