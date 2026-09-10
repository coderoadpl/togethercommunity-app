import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useSearch,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { notificationMarkReadInputSchema, type Notification } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { NotificationsPage } from './NotificationsPage.js';

const notification = (input: {
  id: string;
  kind?: Notification['kind'];
  contextKind?: 'lesson' | 'space';
  contextId?: string;
  courseId?: string | null;
  read?: boolean;
  authorAvatarUrl?: string | null;
}): Notification => ({
  id: input.id,
  tenantId: 't1',
  recipientUserId: 'u1',
  kind: input.kind ?? 'thread-reply',
  payload: {
    rootPostId: `root-${input.id}`,
    postId: `reply-${input.id}`,
    contextKind: input.contextKind ?? 'lesson',
    contextId: input.contextId ?? 'l1',
    courseId: input.courseId === undefined ? 'c1' : input.courseId,
    eventId: null,
    domain: null,
    lessonName: 'Hamaki w kamperze',
    authorDisplay: 'Ola',
    authorAvatarUrl: input.authorAvatarUrl ?? null,
    snippet: `Content ${input.id}`,
  },
  sourceKey: null,
  readAt: input.read === true ? '2026-08-15T09:00:00.000Z' : null,
  createdAt: '2026-08-15T08:00:00.000Z',
});

const okUnread = (unread: number) =>
  http.get('/api/notifications/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread } }),
  );

const okList = (notifications: Notification[], nextCursor: string | null = null) =>
  http.get('/api/notifications', () =>
    HttpResponse.json({ ok: true, data: { notifications, nextCursor } }),
  );

const impersonatedMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'user@example.com',
        emailVerified: true,
        name: 'John Member',
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
          subjectName: 'John Member',
          actorName: 'Ola Operatorka',
          expiresAt: '2026-08-15T09:00:00.000Z',
        },
      },
    }),
  );

const unauthorizedList = () =>
  http.get('/api/notifications', () =>
    HttpResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    ),
  );

const NotificationsRouteComponent = () => {
  const { filter } = useSearch({ strict: false });
  return <NotificationsPage filter={filter === 'unread' ? 'unread' : 'all'} />;
};

const renderPage = async () => {
  const rootRoute = createRootRoute();
  const notificationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notifications',
    validateSearch: (search: Record<string, unknown>): { filter?: 'unread' } =>
      search['filter'] === 'unread' ? { filter: 'unread' } : {},
    component: NotificationsRouteComponent,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <p>login</p>,
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
      notificationsRoute,
      loginRoute,
      spaceThreadRoute,
      lessonRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/notifications'] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('NotificationsPage', () => {
  it('lists notifications by day, marks unread ones and clears them all', async () => {
    let readAllCalls = 0;
    server.use(
      okUnread(1),
      okList([notification({ id: 'n1' }), notification({ id: 'n2', read: true })]),
      http.post('/api/notifications/read-all', () => {
        readAllCalls += 1;
        return HttpResponse.json({ ok: true, data: { read: 1 } });
      }),
    );

    await renderPage();

    expect(await screen.findByTestId('notification-n1')).toHaveTextContent(
      en.notifications.threadReply({ author: 'Ola', lesson: 'Hamaki w kamperze' }),
    );
    expect(screen.getByTestId('notification-group-earlier')).toHaveTextContent(
      en.notifications.groupEarlier,
    );
    expect(screen.getByTestId('notification-n1')).toHaveTextContent('Content n1');
    expect(screen.getByTestId('notification-n1')).toHaveTextContent(en.notifications.unreadLabel);
    expect(screen.getByTestId('notification-n2')).not.toHaveTextContent(
      en.notifications.unreadLabel,
    );

    await userEvent.click(screen.getByTestId('notifications-mark-all-read'));

    await waitFor(() => expect(readAllCalls).toBe(1));
    expect(await screen.findByText(en.notifications.markedAllRead)).toBeInTheDocument();
  });

  it('shows the empty state without a mark-all-read action', async () => {
    server.use(okUnread(0), okList([]));

    await renderPage();

    expect(await screen.findByTestId('notifications-page-empty')).toHaveTextContent(
      en.notifications.empty,
    );
    expect(screen.queryByTestId('notifications-mark-all-read')).not.toBeInTheDocument();
  });

  it('follows the server cursor instead of growing the page size', async () => {
    const cursors: Array<string | null> = [];
    server.use(
      okUnread(0),
      http.get('/api/notifications', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json({
          ok: true,
          data: {
            notifications: [notification({ id: cursor === null ? 'n1' : 'n2', read: true })],
            nextCursor: cursor === null ? '2026-08-15T08:00:00.000Z|n1' : null,
          },
        });
      }),
    );

    await renderPage();

    await userEvent.click(await screen.findByTestId('notifications-load-more'));

    await waitFor(() => expect(screen.getByTestId('notification-n2')).toBeInTheDocument());
    expect(screen.getByTestId('notification-n1')).toBeInTheDocument();
    expect(cursors).toEqual([null, '2026-08-15T08:00:00.000Z|n1']);
    await waitFor(() =>
      expect(screen.queryByTestId('notifications-load-more')).not.toBeInTheDocument(),
    );
  });

  it('asks the server for unread notifications only when the filter is on', async () => {
    const requested: Array<string | null> = [];
    server.use(
      okUnread(0),
      http.get('/api/notifications', ({ request }) => {
        const unread = new URL(request.url).searchParams.get('unread');
        requested.push(unread);
        return HttpResponse.json({
          ok: true,
          data: { notifications: unread === 'true' ? [] : [notification({ id: 'n1' })], nextCursor: null },
        });
      }),
    );

    const { router } = await renderPage();

    await screen.findByTestId('notification-n1');
    await userEvent.click(screen.getByTestId('notifications-filter-unread'));

    await waitFor(() => expect(router.state.location.searchStr).toBe('?filter=unread'));
    expect(await screen.findByTestId('notifications-page-all-read')).toHaveTextContent(
      en.notifications.allRead,
    );
    expect(requested).toEqual([null, 'true']);
    expect(screen.getByTestId('notifications-filter')).toBeInTheDocument();
  });

  it('opens a space notification on its thread page and marks it read', async () => {
    const readIds: string[] = [];
    server.use(
      okUnread(1),
      okList([notification({ id: 'n1', kind: 'space-post', contextKind: 'space', contextId: 's1', courseId: null })]),
      http.post('/api/notifications/read', async ({ request }) => {
        const body = notificationMarkReadInputSchema.parse(await request.json());
        readIds.push(body.id);
        return HttpResponse.json({
          ok: true,
          data: { notification: notification({ id: body.id, read: true }) },
        });
      }),
    );

    const { router } = await renderPage();

    await userEvent.click(await screen.findByTestId('notification-n1'));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/community/s1/posts/root-n1'),
    );
    expect(readIds).toEqual(['n1']);
  });

  it('opens a notification without a read receipt while viewing as a member', async () => {
    let readCalls = 0;
    server.use(
      impersonatedMe(),
      okUnread(1),
      okList([notification({ id: 'n1' })]),
      http.post('/api/notifications/read', () => {
        readCalls += 1;
        return HttpResponse.json({
          ok: true,
          data: { notification: notification({ id: 'n1', read: true }) },
        });
      }),
    );

    const { router } = await renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('notifications-mark-all-read')).toBeDisabled(),
    );
    await userEvent.click(await screen.findByTestId('notification-n1'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/c1/lessons/l1'));
    expect(readCalls).toBe(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens a lesson notification on its lesson with the thread in the URL', async () => {
    server.use(okUnread(0), okList([notification({ id: 'n1', read: true })]));

    const { router } = await renderPage();

    await userEvent.click(await screen.findByTestId('notification-n1'));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/my/courses/c1/lessons/l1'),
    );
    expect(router.state.location.searchStr).toBe('?thread=root-n1');
  });

  it('leaves a legacy lesson notification without a course unclickable', async () => {
    server.use(okUnread(0), okList([notification({ id: 'n1', courseId: null, read: true })]));

    await renderPage();

    const row = await screen.findByTestId('notification-n1');
    expect(row.tagName).toBe('DIV');
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('shows the author picture when the payload carries one and initials otherwise', async () => {
    server.use(
      okUnread(0),
      okList([
        notification({ id: 'n1', read: true, authorAvatarUrl: 'https://cdn.test/ola.png' }),
        notification({ id: 'n2', read: true }),
      ]),
    );

    await renderPage();

    const withPicture = within(await screen.findByTestId('notification-n1'));
    expect(withPicture.getByTestId('user-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/ola.png',
    );
    const withInitials = within(screen.getByTestId('notification-n2'));
    expect(withInitials.queryByTestId('user-avatar-image')).toBeNull();
    expect(withInitials.getByTestId('user-avatar')).toHaveTextContent('O');
  });

  it('leaves out the avatar of a workspace notification that has no author', async () => {
    const domainNotification: Notification = {
      ...notification({ id: 'n1', kind: 'tenant-domain-verified', read: true }),
      payload: {
        rootPostId: null,
        postId: null,
        contextKind: 'tenant',
        contextId: null,
        courseId: null,
        eventId: null,
        domain: 'course.acme.example',
        lessonName: '',
        authorDisplay: null,
        authorAvatarUrl: null,
        snippet: '',
      },
    };
    server.use(okUnread(0), okList([domainNotification]));

    await renderPage();

    const row = await screen.findByTestId('notification-n1');

    expect(within(row).queryByTestId('user-avatar')).toBeNull();
    expect(row).toHaveTextContent(
      en.notifications.tenantDomainVerified({ domain: 'course.acme.example' }),
    );
  });

  it('sends an unauthenticated visitor to the login page', async () => {
    server.use(okUnread(0), unauthorizedList());

    const { router } = await renderPage();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ returnTo: '/notifications' });
  });
});
