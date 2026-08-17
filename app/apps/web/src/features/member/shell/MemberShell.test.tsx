import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { CourseStructureWithAccess, MemberNavigation } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ThemeModeProvider } from '../../../theme-mode.js';
import { memberHomePath } from './member-nav.js';
import { MemberShell } from './MemberShell.js';

const stubViewport = (isDesktop: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const okMe = (overrides: { memberId?: string | null; banned?: boolean; tenant?: null } = {}) =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'jan@example.com',
        emailVerified: true,
        name: 'Jan Uczestnik',
        tenant: overrides.tenant === null
          ? null
          : {
              id: 't1',
              slug: 'acme',
              name: 'Acme',
              staffRole: null,
              memberId: overrides.memberId ?? 'm1',
              banned: overrides.banned ?? false,
            },
      },
    }),
  );

const navigation = (overrides: Partial<MemberNavigation> = {}): MemberNavigation => ({
  spaces: [
    { id: 's1', slug: 'ogolna', name: 'Ogólna', visibility: 'members', position: 0, isFollowing: true },
  ],
  courses: [
    {
      courseId: 'c1',
      courseName: 'JavaScript od zera',
      completedLessonCount: 1,
      accessibleLessonCount: 3,
      lastActivityAt: '2026-08-10T10:00:00.000Z',
    },
    {
      courseId: 'c2',
      courseName: 'CSS w praktyce',
      completedLessonCount: 4,
      accessibleLessonCount: 4,
      lastActivityAt: '2026-08-09T10:00:00.000Z',
    },
  ],
  lockedSpaces: [
    { id: 's9', slug: 'premium', name: 'Premium', description: 'Tylko dla kursantów.', productIds: ['p1'] },
  ],
  ...overrides,
});

const okNavigation = (value: MemberNavigation = navigation()) =>
  http.get('/api/member/navigation', () =>
    HttpResponse.json({ ok: true, data: { navigation: value } }));

const courseStructure: CourseStructureWithAccess = {
  courseId: 'c1',
  name: 'JavaScript od zera',
  accessStatus: 'fully-accessible',
  completionStatus: 'partially-completed',
  modules: [
    {
      id: 'm1',
      name: 'Podstawy',
      accessStatus: 'fully-accessible',
      completionStatus: 'partially-completed',
      chapters: [
        {
          id: 'ch1',
          name: 'Start',
          accessStatus: 'fully-accessible',
          completionStatus: 'partially-completed',
          lessons: [
            {
              contentId: 'ct1',
              lessonId: 'l1',
              name: 'Zmienne',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
            },
          ],
        },
      ],
    },
  ],
};

const okStructure = () =>
  http.get('/api/student/courses/:courseId/structure', () =>
    HttpResponse.json({ ok: true, data: { structure: courseStructure } }));

const okOffer = () =>
  http.get('/api/public/offer', () =>
    HttpResponse.json({
      ok: true,
      data: {
        tenant: {
          slug: 'acme',
          name: 'Acme',
          branding: { logoUrl: null, accentColor: null, faviconUrl: null },
          socialLinks: [],
        },
        contentVersion: 1,
        products: [],
      },
    }),
  );

const noNotifications = () =>
  http.get('/api/notifications/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread: 0 } }));

const renderShell = async (path: string) => {
  const rootRoute = createRootRoute();
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: 'member-shell',
    component: MemberShell,
  });
  const page = (label: string) => () => <p>{label}</p>;
  const routeTree = rootRoute.addChildren([
    shellRoute.addChildren([
      createRoute({ getParentRoute: () => shellRoute, path: '/start', component: page('Start') }),
      createRoute({ getParentRoute: () => shellRoute, path: '/my', component: page('Biblioteka') }),
      createRoute({ getParentRoute: () => shellRoute, path: '/my/products', component: page('Produkty') }),
      createRoute({
        getParentRoute: () => shellRoute,
        path: '/my/courses/$courseId',
        component: page('Kurs'),
      }),
      createRoute({
        getParentRoute: () => shellRoute,
        path: '/my/courses/$courseId/lessons/$lessonId',
        component: page('Lekcja'),
      }),
      createRoute({
        getParentRoute: () => shellRoute,
        path: '/community/$spaceId',
        component: page('Przestrzeń'),
      }),
    ]),
  ]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  return renderWithProviders(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
};

describe('MemberShell', () => {
  it('renders spaces, course rings and locked upsells in one sidebar list', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell('/my');

    const space = await screen.findByTestId('sidebar-space-s1');
    const sidebar = screen.getByTestId('member-sidebar');
    expect(sidebar).toContainElement(space);
    expect(space).toHaveAttribute('href', '/community/s1');
    expect(space).toHaveTextContent('Ogólna');

    const inProgress = within(sidebar).getByTestId('sidebar-course-c1');
    expect(inProgress).toHaveAttribute('href', '/my/courses/c1');
    expect(inProgress).toHaveTextContent('33%');
    expect(within(inProgress).getByTestId('progress-ring')).toHaveAttribute('data-done', 'false');

    const done = within(sidebar).getByTestId('sidebar-course-c2');
    expect(done).not.toHaveTextContent('%');
    expect(within(done).getByTestId('progress-ring')).toHaveAttribute('data-done', 'true');

    expect(within(sidebar).getByTestId('sidebar-locked-s9')).toHaveAttribute('href', '/checkout/p1');
    expect(within(sidebar).getByText(pl.shell.spacesSection)).toBeInTheDocument();
  });

  it('renders a locked space without a product as a non-interactive row', async () => {
    stubViewport(true);
    server.use(
      okMe(),
      okNavigation(navigation({
        lockedSpaces: [{ id: 's9', slug: 'premium', name: 'Premium', description: null, productIds: [] }],
      })),
      okOffer(),
      noNotifications(),
    );

    await renderShell('/my');

    const locked = await screen.findByTestId('sidebar-locked-s9');
    expect(locked).not.toHaveAttribute('href');
    expect(locked).toHaveAttribute('aria-disabled', 'true');
  });

  it('marks the open space as the current page and leaves the others unmarked', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell('/community/s1');

    expect(await screen.findByTestId('sidebar-space-s1')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('sidebar-course-c1')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('sidebar-start')).not.toHaveAttribute('aria-current');
  });

  it('marks Start as the current page on the member home path', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell(memberHomePath());

    expect(await screen.findByTestId('sidebar-start')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Start highlighted on the course library it links to', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell('/my');

    expect(await screen.findByTestId('sidebar-start')).toHaveAttribute('aria-current', 'page');
  });

  it('offers the colour scheme toggle in the member topbar', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell(memberHomePath());

    expect(await screen.findByTestId('color-scheme-switcher')).toBeInTheDocument();
  });

  it('shows the member identity block linking to the account page', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell('/my');

    const identity = await screen.findByTestId('member-identity');
    expect(identity).toHaveAttribute('href', '/account');
    expect(identity).toHaveTextContent('Jan Uczestnik');
    expect(identity).toHaveTextContent('jan@example.com');
    expect(identity).toHaveTextContent('JU');
  });

  it('renders the banned banner once, above the page outlet', async () => {
    stubViewport(true);
    server.use(okMe({ banned: true }), okNavigation(), okOffer(), noNotifications());

    await renderShell('/my');

    expect(await screen.findAllByText(pl.community.bannedBanner)).toHaveLength(1);
  });

  it('hands the bar over to the course while a course page is open', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okStructure(), okOffer(), noNotifications());

    await renderShell('/my/courses/c1');

    const overview = await screen.findByTestId('course-sidebar-overview');
    const courseSidebar = screen.getByTestId('course-sidebar');
    expect(courseSidebar).toContainElement(overview);
    expect(overview).toHaveAttribute('aria-current', 'page');
    expect(within(courseSidebar).getByTestId('course-sidebar-back')).toHaveAttribute(
      'href',
      memberHomePath(),
    );
    expect(screen.queryByTestId('member-sidebar')).not.toBeInTheDocument();
  });

  it('keeps the course bar with the open lesson highlighted', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okStructure(), okOffer(), noNotifications());

    await renderShell('/my/courses/c1/lessons/l1');

    const currentLesson = await screen.findByTestId('lesson-button-l1');
    expect(screen.getByTestId('course-sidebar')).toContainElement(currentLesson);
    expect(currentLesson).toHaveClass('Mui-selected');
  });

  it('restores the member bar outside course pages', async () => {
    stubViewport(true);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell('/community/s1');

    expect(await screen.findByTestId('member-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('course-sidebar')).not.toBeInTheDocument();
  });

  it('swaps the sidebar for the bottom bar below md', async () => {
    stubViewport(false);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell(memberHomePath());

    const bar = await screen.findByTestId('member-bottom-nav');
    expect(within(bar).getByTestId('member-tab-start')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('member-sidebar')).not.toBeInTheDocument();
  });

  it('opens the menu sheet with the same navigation list and no second bell', async () => {
    stubViewport(false);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());
    const user = userEvent.setup();

    await renderShell('/my');
    await user.click(await screen.findByTestId('member-tab-menu'));

    const sheet = await screen.findByTestId('member-menu-sheet');
    expect(within(sheet).getByTestId('member-sidebar')).toBeInTheDocument();
    expect(await within(sheet).findByTestId('sidebar-space-s1')).toHaveTextContent('Ogólna');
    expect(within(sheet).getByTestId('sidebar-products')).toHaveAttribute('href', '/my/products');
    expect(within(sheet).getByTestId('member-identity')).toHaveTextContent('Jan Uczestnik');
    expect(within(sheet).getByTestId('color-scheme-switcher')).toBeInTheDocument();
    expect(within(sheet).queryByTestId('notification-nav')).not.toBeInTheDocument();
  });

  it('carries the course program in a sheet opened from the app bar', async () => {
    stubViewport(false);
    server.use(okMe(), okNavigation(), okStructure(), okOffer(), noNotifications());
    const user = userEvent.setup();

    await renderShell('/my/courses/c1/lessons/l1');
    await user.click(await screen.findByTestId('program-button'));

    const sheet = await screen.findByTestId('course-program-sheet');
    expect(await within(sheet).findByTestId('lesson-button-l1')).toHaveClass('Mui-selected');
    expect(within(sheet).getByTestId('course-sidebar-back')).toHaveAttribute(
      'href',
      memberHomePath(),
    );
  });

  it('closes an open sheet once navigation lands on the next page', async () => {
    stubViewport(false);
    server.use(okMe(), okNavigation(), okStructure(), okOffer(), noNotifications());
    const user = userEvent.setup();

    await renderShell('/my/courses/c1');
    await user.click(await screen.findByTestId('program-button'));
    await user.click(await screen.findByTestId('lesson-button-l1'));

    expect(await screen.findByText('Lekcja')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId('course-program-sheet')).not.toBeInTheDocument());
  });

  it('offers the program button only in course context', async () => {
    stubViewport(false);
    server.use(okMe(), okNavigation(), okOffer(), noNotifications());

    await renderShell('/community/s1');

    expect(await screen.findByTestId('member-bottom-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('program-button')).not.toBeInTheDocument();
  });

  it('serves the public tier without a sidebar and with a sign-in link', async () => {
    stubViewport(true);
    server.use(okMe({ tenant: null }), okOffer());

    await renderShell('/my');

    expect(await screen.findByRole('link', { name: pl.auth.signInLink })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByTestId('member-sidebar')).not.toBeInTheDocument();
    expect(screen.getByText('Biblioteka')).toBeInTheDocument();
  });
});
