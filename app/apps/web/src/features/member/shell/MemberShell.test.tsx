import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { MemberNavigation } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
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
      createRoute({ getParentRoute: () => shellRoute, path: '/my', component: page('Biblioteka') }),
      createRoute({ getParentRoute: () => shellRoute, path: '/my/products', component: page('Produkty') }),
      createRoute({
        getParentRoute: () => shellRoute,
        path: '/my/courses/$courseId',
        component: page('Kurs'),
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
  return renderWithProviders(<RouterProvider router={router} />);
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

    await renderShell('/my');

    expect(await screen.findByTestId('sidebar-start')).toHaveAttribute('aria-current', 'page');
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
