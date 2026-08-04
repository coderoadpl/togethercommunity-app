import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { notificationMarkReadInputSchema } from '#core/domain/index.js';

import { pl } from './i18n/pl.js';
import { renderWithProviders } from './test/render.js';
import { server } from './test/server.js';
import { NotificationBell } from './NotificationBell.js';

const notification = (input: { id: string; read: boolean }) => ({
  id: input.id,
  tenantId: 't1',
  recipientUserId: 'u1',
  kind: 'thread-reply',
  payload: {
    rootPostId: 'p1',
    postId: 'p2',
    contextKind: 'lesson',
    contextId: 'l1',
    courseId: null,
    lessonName: 'Hamaki w kamperze',
    authorDisplay: 'Ola',
    snippet: 'Świetne pytanie, już odpowiadam!',
  },
  readAt: input.read ? '2026-07-15T09:00:00.000Z' : null,
  createdAt: '2026-07-15T08:00:00.000Z',
});

const renderBell = async ({ tabLabel, live = true }: { tabLabel?: string; live?: boolean } = {}) => {
  const rootRoute = createRootRoute({
    component: () => <NotificationBell {...(tabLabel === undefined ? {} : { tabLabel })} live={live} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('NotificationBell', () => {
  it('adds an ellipsis and native title to the narrow notification tab label', async () => {
    await renderBell({ tabLabel: pl.notifications.mobileTab, live: false });

    const label = screen.getByTitle(pl.notifications.mobileTab);
    expect(label).toHaveClass('MuiTypography-noWrap');
    expect(label).toHaveAttribute('title', pl.notifications.mobileTab);
  });

  it('shows the unread badge and marks a notification read on open', async () => {
    const readIds: string[] = [];
    server.use(
      http.get('/api/notifications/unread-count', () =>
        HttpResponse.json({ ok: true, data: { unread: 2 } }),
      ),
      http.get('/api/notifications', () =>
        HttpResponse.json({
          ok: true,
          data: {
            notifications: [
              notification({ id: 'n1', read: false }),
              notification({ id: 'n2', read: true }),
            ],
            nextCursor: null,
          },
        }),
      ),
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

    expect(await screen.findByText('2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.notifications.bell }));

    const items = await screen.findAllByText(
      pl.notifications.threadReply({ author: 'Ola', lesson: 'Hamaki w kamperze' }),
    );
    expect(items).toHaveLength(2);
    expect(screen.getAllByText('Świetne pytanie, już odpowiadam!')).toHaveLength(2);

    await userEvent.click(screen.getByTestId('notification-n1'));

    await waitFor(() => expect(readIds).toEqual(['n1']));
  });

  it('marks all notifications read from the dropdown', async () => {
    let readAllCalls = 0;
    server.use(
      http.get('/api/notifications/unread-count', () =>
        HttpResponse.json({ ok: true, data: { unread: 1 } }),
      ),
      http.get('/api/notifications', () =>
        HttpResponse.json({
          ok: true,
          data: { notifications: [notification({ id: 'n1', read: false })], nextCursor: null },
        }),
      ),
      http.post('/api/notifications/read-all', () => {
        readAllCalls += 1;
        return HttpResponse.json({ ok: true, data: { read: 1 } });
      }),
    );

    await renderBell();

    await userEvent.click(await screen.findByRole('button', { name: pl.notifications.bell }));
    await userEvent.click(await screen.findByTestId('notifications-mark-all-read'));

    await waitFor(() => expect(readAllCalls).toBe(1));
  });

  it('shows the empty state when there are no notifications', async () => {
    server.use(
      http.get('/api/notifications/unread-count', () =>
        HttpResponse.json({ ok: true, data: { unread: 0 } }),
      ),
      http.get('/api/notifications', () =>
        HttpResponse.json({ ok: true, data: { notifications: [], nextCursor: null } }),
      ),
    );

    await renderBell();

    await userEvent.click(screen.getByRole('button', { name: pl.notifications.bell }));

    expect(await screen.findByText(pl.notifications.empty)).toBeInTheDocument();
  });
});
