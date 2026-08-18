import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { StartMessageButton } from './StartMessageButton.js';

const stubMe = (tenant: Record<string, unknown> | null = {}) =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'user-1',
        email: 'member@together.dev',
        name: 'Member',
        emailVerified: true,
        tenant:
          tenant === null
            ? null
            : {
                id: 't1',
                slug: 'acme',
                name: 'Acme',
                staffRole: null,
                memberId: 'm1',
                banned: false,
                ...tenant,
              },
      },
    }),
  );

const renderButton = async () => {
  const rootRoute = createRootRoute();
  const spaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/community/$spaceId',
    component: () => <StartMessageButton postId="post-1" />,
  });
  const conversationRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/messages/$conversationId',
    component: () => <p>rozmowa</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([spaceRoute, conversationRoute]),
    history: createMemoryHistory({ initialEntries: ['/community/s1'] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('StartMessageButton', () => {
  it('starts a conversation with the post author and opens it', async () => {
    let startBody: unknown;
    server.use(
      stubMe(),
      http.post('*/api/messages/start', async ({ request }) => {
        startBody = await request.json();
        return HttpResponse.json({
          ok: true,
          data: {
            conversation: {
              id: 'c9',
              otherParticipant: { display: 'Ola', avatarUrl: null, isStaff: false },
              lastMessageAt: '2026-08-17T09:00:00.000Z',
              lastMessageSnippet: '',
              lastMessageIsOwn: false,
              hasMessages: false,
              unread: false,
            },
          },
        });
      }),
    );

    const { router } = await renderButton();

    await userEvent.click(await screen.findByTestId('start-message-post-1'));

    expect(startBody).toEqual({ recipient: { kind: 'post-author', postId: 'post-1' } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/messages/c9'));
  });

  it('reports an unreachable recipient instead of navigating', async () => {
    server.use(
      stubMe(),
      http.post('*/api/messages/start', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'forbidden', message: 'Opted out' } },
          { status: 403 },
        ),
      ),
    );

    const { router } = await renderButton();

    await userEvent.click(await screen.findByTestId('start-message-post-1'));

    expect(await screen.findByText(pl.messages.recipientUnavailable)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/community/s1');
  });

  it('stays hidden for viewers without a community membership', async () => {
    server.use(stubMe(null));

    await renderButton();

    await waitFor(() =>
      expect(screen.queryByTestId('start-message-post-1')).not.toBeInTheDocument(),
    );
  });
});
