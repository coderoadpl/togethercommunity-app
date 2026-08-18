import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { notificationMarkReadInputSchema, type Notification } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
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
    lessonName: 'Hamaki w kamperze',
    authorDisplay: 'Ola',
    authorAvatarUrl: input.authorAvatarUrl ?? null,
    snippet: `Treść ${input.id}`,
  },
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

const unauthorizedList = () =>
  http.get('/api/notifications', () =>
    HttpResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    ),
  );

const renderPage = async () => {
  const rootRoute = createRootRoute();
  const notificationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notifications',
    component: NotificationsPage,
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
  it('lists notifications, marks unread ones and clears them all', async () => {
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

    expect(await screen.findByTestId('notification-row-n1')).toHaveTextContent(
      pl.notifications.threadReply({ author: 'Ola', lesson: 'Hamaki w kamperze' }),
    );
    expect(screen.getByTestId('notification-row-n1')).toHaveTextContent('Treść n1');
    expect(screen.getByTestId('notification-row-n1')).toHaveTextContent(
      pl.notifications.unreadLabel,
    );
    expect(screen.getByTestId('notification-row-n2')).not.toHaveTextContent(
      pl.notifications.unreadLabel,
    );

    await userEvent.click(screen.getByTestId('notifications-mark-all-read'));

    await waitFor(() => expect(readAllCalls).toBe(1));
    expect(await screen.findByText(pl.notifications.markedAllRead)).toBeInTheDocument();
  });

  it('shows the empty state without a mark-all-read action', async () => {
    server.use(okUnread(0), okList([]));

    await renderPage();

    expect(await screen.findByTestId('notifications-page-empty')).toHaveTextContent(
      pl.notifications.empty,
    );
    expect(screen.queryByTestId('notifications-mark-all-read')).not.toBeInTheDocument();
  });

  it('grows the page while the server reports more notifications', async () => {
    const limits: string[] = [];
    server.use(
      okUnread(0),
      http.get('/api/notifications', ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get('limit'));
        limits.push(String(limit));
        return HttpResponse.json({
          ok: true,
          data: {
            notifications: Array.from({ length: limit }, (_unused, index) =>
              notification({ id: `n${String(index)}`, read: true }),
            ),
            nextCursor: '2026-08-15T08:00:00.000Z|n1',
          },
        });
      }),
    );

    await renderPage();

    await userEvent.click(await screen.findByTestId('notifications-load-more'));

    await waitFor(() => expect(screen.getByTestId('notification-row-n20')).toBeInTheDocument());
    expect(limits).toEqual(['20', '40']);
  });

  it('caps the page at the server limit and says so', async () => {
    server.use(
      okUnread(0),
      http.get('/api/notifications', ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get('limit'));
        return HttpResponse.json({
          ok: true,
          data: {
            notifications: Array.from({ length: Math.min(limit, 2) }, (_unused, index) =>
              notification({ id: `n${String(index)}`, read: true }),
            ),
            nextCursor: '2026-08-15T08:00:00.000Z|n1',
          },
        });
      }),
    );

    await renderPage();

    await userEvent.click(await screen.findByTestId('notifications-load-more'));
    await userEvent.click(await screen.findByTestId('notifications-load-more'));
    await userEvent.click(await screen.findByTestId('notifications-load-more'));
    await userEvent.click(await screen.findByTestId('notifications-load-more'));

    expect(await screen.findByTestId('notifications-truncated')).toHaveTextContent(
      pl.notifications.olderTruncated,
    );
    expect(screen.queryByTestId('notifications-load-more')).not.toBeInTheDocument();
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

    await userEvent.click(await screen.findByTestId('notification-open-n1'));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/community/s1/posts/root-n1'),
    );
    expect(readIds).toEqual(['n1']);
  });

  it('opens a lesson notification on its lesson with the thread in the URL', async () => {
    server.use(okUnread(0), okList([notification({ id: 'n1', read: true })]));

    const { router } = await renderPage();

    await userEvent.click(await screen.findByTestId('notification-open-n1'));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/my/courses/c1/lessons/l1'),
    );
    expect(router.state.location.searchStr).toBe('?thread=root-n1');
  });

  it('leaves a legacy lesson notification without a course unclickable', async () => {
    server.use(okUnread(0), okList([notification({ id: 'n1', courseId: null, read: true })]));

    await renderPage();

    expect(await screen.findByTestId('notification-row-n1')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-open-n1')).not.toBeInTheDocument();
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

    const withPicture = within(await screen.findByTestId('notification-row-n1'));
    expect(withPicture.getByTestId('member-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/ola.png',
    );
    const withInitials = within(screen.getByTestId('notification-row-n2'));
    expect(withInitials.queryByTestId('member-avatar-image')).toBeNull();
    expect(withInitials.getByTestId('member-avatar')).toHaveTextContent('O');
  });

  it('sends an unauthenticated visitor to the login page', async () => {
    server.use(okUnread(0), unauthorizedList());

    const { router } = await renderPage();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
