import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { notificationMarkReadInputSchema } from '#core/domain/index.js';

import { pl } from './i18n/pl.js';
import { renderWithProviders } from './test/render.js';
import { server } from './test/server.js';
import { NotificationBell } from './NotificationBell.js';

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

const notification = (input: {
  id: string;
  read: boolean;
  kind?: 'thread-reply' | 'space-post';
  contextKind?: 'lesson' | 'space';
  contextId?: string;
  courseId?: string | null;
  authorAvatarUrl?: string | null;
}) => ({
  id: input.id,
  tenantId: 't1',
  recipientUserId: 'u1',
  kind: input.kind ?? 'thread-reply',
  payload: {
    rootPostId: 'p1',
    postId: 'p2',
    contextKind: input.contextKind ?? 'lesson',
    contextId: input.contextId ?? 'l1',
    courseId: input.courseId ?? null,
    lessonName: 'Hamaki w kamperze',
    authorDisplay: 'Ola',
    authorAvatarUrl: input.authorAvatarUrl ?? null,
    snippet: 'Świetne pytanie, już odpowiadam!',
  },
  readAt: input.read ? '2026-07-15T09:00:00.000Z' : null,
  createdAt: '2026-07-15T08:00:00.000Z',
});

const okUnread = (unread: number) =>
  http.get('/api/notifications/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread } }),
  );

const okList = (notifications: ReturnType<typeof notification>[]) =>
  http.get('/api/notifications', () =>
    HttpResponse.json({ ok: true, data: { notifications, nextCursor: null } }),
  );

const impersonatedMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'user@example.com',
        emailVerified: true,
        name: 'Jan Uczestnik',
        tenant: {
          id: 't1',
          slug: 'acme',
          name: 'Acme',
          staffRole: null,
          memberId: 'mem-1',
          banned: false,
        },
        impersonation: {
          id: 'imp-1',
          subjectMemberId: 'mem-1',
          subjectName: 'Jan Uczestnik',
          actorName: 'Ola Operatorka',
          expiresAt: '2026-08-15T09:00:00.000Z',
        },
      },
    }),
  );

const renderBell = async ({ desktop = true }: { desktop?: boolean } = {}) => {
  stubViewport(desktop);
  const rootRoute = createRootRoute({
    component: () => <NotificationBell />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const renderRoutedBell = async () => {
  stubViewport(true);
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <NotificationBell />
        <Outlet />
      </>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  });
  const notificationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notifications',
    component: () => <p>all notifications</p>,
  });
  const spaceThreadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/community/$spaceId/posts/$postId',
    component: () => <p>thread</p>,
  });
  const lessonRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/my/courses/$courseId/lessons/$lessonId',
    validateSearch: (search: Record<string, unknown>): { thread?: string } =>
      typeof search['thread'] === 'string' ? { thread: search['thread'] } : {},
    component: () => <p>lesson</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      notificationsRoute,
      spaceThreadRoute,
      lessonRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('NotificationBell', () => {
  it('counts unread notifications in the badge and in the button label', async () => {
    server.use(okUnread(3));

    await renderBell();

    expect(await screen.findByText('3')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('notification-bell')).toHaveAttribute(
        'aria-label',
        pl.notifications.unreadAria({ count: 3 }),
      ),
    );
  });

  it('caps the badge at 99+ and hides it when nothing is unread', async () => {
    server.use(okUnread(150));

    const many = await renderBell();
    expect(await screen.findByText('99+')).toBeInTheDocument();
    many.unmount();

    server.use(okUnread(0));
    await renderBell();

    const bell = await screen.findByTestId('notification-bell');
    await waitFor(() => expect(bell).toHaveAttribute('aria-label', pl.notifications.bell));
    expect(bell.querySelector('.MuiBadge-badge')).toHaveClass('MuiBadge-invisible');
  });

  it('opens a grouped panel and marks a notification read on open', async () => {
    const readIds: string[] = [];
    server.use(
      okUnread(2),
      okList([
        notification({ id: 'n1', read: false, courseId: 'c1' }),
        notification({ id: 'n2', read: true, courseId: 'c1' }),
      ]),
      http.post('/api/notifications/read', async ({ request }) => {
        const body = notificationMarkReadInputSchema.parse(await request.json());
        readIds.push(body.id);
        return HttpResponse.json({
          ok: true,
          data: { notification: notification({ id: body.id, read: true }) },
        });
      }),
    );

    await renderBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));

    const panel = await screen.findByTestId('notifications-panel');
    expect(panel).toHaveAttribute('role', 'dialog');
    expect(screen.getByTestId('notification-group-earlier')).toHaveTextContent(
      pl.notifications.groupEarlier,
    );
    expect(screen.getByTestId('notification-n1')).toHaveTextContent(
      pl.notifications.threadReply({ author: 'Ola', lesson: 'Hamaki w kamperze' }),
    );
    expect(screen.queryByTestId('notifications-panel-close')).toBeNull();

    await userEvent.click(screen.getByTestId('notification-n1'));

    await waitFor(() => expect(readIds).toEqual(['n1']));
  });

  it('opens a notification without a read receipt while viewing as a member', async () => {
    let readCalls = 0;
    server.use(
      impersonatedMe(),
      okUnread(1),
      okList([notification({ id: 'n1', read: false, courseId: 'c1' })]),
      http.post('/api/notifications/read', () => {
        readCalls += 1;
        return HttpResponse.json({
          ok: true,
          data: { notification: notification({ id: 'n1', read: true }) },
        });
      }),
    );

    const { router } = await renderRoutedBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));
    await waitFor(() =>
      expect(screen.getByTestId('notifications-popover-mark-all-read')).toBeDisabled(),
    );
    await userEvent.click(await screen.findByTestId('notification-n1'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/c1/lessons/l1'));
    expect(readCalls).toBe(0);
  });

  it('marks all notifications read from the panel', async () => {
    let readAllCalls = 0;
    server.use(
      okUnread(1),
      okList([notification({ id: 'n1', read: false })]),
      http.post('/api/notifications/read-all', () => {
        readAllCalls += 1;
        return HttpResponse.json({ ok: true, data: { read: 1 } });
      }),
    );

    await renderBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));
    await userEvent.click(await screen.findByTestId('notifications-popover-mark-all-read'));

    await waitFor(() => expect(readAllCalls).toBe(1));
  });

  it('renders an author avatar on every panel row', async () => {
    server.use(
      okUnread(1),
      okList([
        notification({ id: 'n1', read: false, authorAvatarUrl: 'https://cdn.test/ola.png' }),
        notification({ id: 'n2', read: true }),
      ]),
    );

    await renderBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));

    const withPicture = within(await screen.findByTestId('notification-n1'));
    expect(withPicture.getByTestId('member-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/ola.png',
    );
    const withInitials = within(screen.getByTestId('notification-n2'));
    expect(withInitials.queryByTestId('member-avatar-image')).toBeNull();
    expect(withInitials.getByTestId('member-avatar')).toHaveTextContent('O');
  });

  it('leaves out the avatar of a workspace notification that has no author', async () => {
    server.use(
      okUnread(1),
      http.get('/api/notifications', () =>
        HttpResponse.json({
          ok: true,
          data: {
            notifications: [{
              ...notification({ id: 'n1', read: false }),
              kind: 'tenant-domain-verified',
              payload: {
                rootPostId: null,
                postId: null,
                contextKind: 'tenant',
                contextId: null,
                courseId: null,
                eventId: null,
                domain: 'kurs.acme.example',
                lessonName: '',
                authorDisplay: null,
                authorAvatarUrl: null,
                snippet: '',
              },
            }],
            nextCursor: null,
          },
        }),
      ),
    );

    await renderBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));

    const row = await screen.findByTestId('notification-n1');
    expect(within(row).queryByTestId('member-avatar')).toBeNull();
    expect(row).toHaveTextContent(
      pl.notifications.tenantDomainVerified({ domain: 'kurs.acme.example' }),
    );
  });

  it('shows the empty state with its hint when there are no notifications', async () => {
    server.use(okUnread(0), okList([]));

    await renderBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));

    const empty = await screen.findByTestId('notifications-empty');
    expect(empty).toHaveTextContent(pl.notifications.empty);
    expect(empty).toHaveTextContent(pl.notifications.emptyHint);
  });

  it('opens a bottom sheet with a close control below md', async () => {
    server.use(okUnread(0), okList([]));

    await renderBell({ desktop: false });

    await userEvent.click(await screen.findByTestId('notification-bell'));

    expect(await screen.findByTestId('notifications-panel-close')).toBeInTheDocument();
    expect(document.querySelector('.MuiDrawer-root')).not.toBeNull();
  });

  it('opens a space notification on the thread page of its root post', async () => {
    server.use(
      okUnread(0),
      okList([
        notification({ id: 'n1', read: true, kind: 'space-post', contextKind: 'space', contextId: 's1' }),
      ]),
    );

    const { router } = await renderRoutedBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));
    await userEvent.click(await screen.findByTestId('notification-n1'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/community/s1/posts/p1'));
  });

  it('opens a lesson notification with its thread pinned in the URL', async () => {
    server.use(okUnread(0), okList([notification({ id: 'n1', read: true, courseId: 'c1' })]));

    const { router } = await renderRoutedBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));
    await userEvent.click(await screen.findByTestId('notification-n1'));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/my/courses/c1/lessons/l1'),
    );
    expect(router.state.location.searchStr).toBe('?thread=p1');
  });

  it('links from the panel to the full notifications page', async () => {
    server.use(okUnread(0), okList([]));

    const { router } = await renderRoutedBell();

    await userEvent.click(await screen.findByTestId('notification-bell'));

    const viewAll = await screen.findByTestId('notifications-view-all');
    expect(viewAll).toHaveTextContent(pl.notifications.viewAll);

    await userEvent.click(viewAll);

    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
  });
});
