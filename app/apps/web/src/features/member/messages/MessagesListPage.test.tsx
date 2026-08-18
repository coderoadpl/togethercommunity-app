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

import type { PublicDmConversation } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { MessagesListPage } from './MessagesListPage.js';

const conversation = (input: {
  id: string;
  display?: string;
  unread?: boolean;
  own?: boolean;
  isStaff?: boolean;
}): PublicDmConversation => ({
  id: input.id,
  otherParticipant: {
    display: input.display ?? 'Ola',
    avatarUrl: null,
    isStaff: input.isStaff ?? false,
  },
  lastMessageAt: '2026-08-17T09:00:00.000Z',
  lastMessageSnippet: `Wiadomość ${input.id}`,
  lastMessageIsOwn: input.own ?? false,
  hasMessages: true,
  unread: input.unread ?? false,
});

const okConversations = (conversations: PublicDmConversation[], nextCursor: string | null = null) =>
  http.get('*/api/messages', () =>
    HttpResponse.json({ ok: true, data: { conversations, nextCursor } }),
  );

const renderPage = async () => {
  const rootRoute = createRootRoute();
  const messagesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/messages',
    component: MessagesListPage,
  });
  const conversationRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/messages/$conversationId',
    component: () => <p>rozmowa</p>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <p>login</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([messagesRoute, conversationRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ['/messages'] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('MessagesListPage', () => {
  it('lists conversations with unread marks, own-message prefix and deep links', async () => {
    server.use(
      okConversations([
        conversation({ id: 'c1', display: 'Ola', unread: true, isStaff: true }),
        conversation({ id: 'c2', display: 'Jan', own: true }),
      ]),
    );

    await renderPage();

    const first = await screen.findByTestId('conversation-row-c1');
    expect(first).toHaveAttribute('href', '/messages/c1');
    expect(first).toHaveTextContent('Ola');
    expect(first).toHaveTextContent('Wiadomość c1');
    expect(within(first).getByText(pl.notifications.unreadLabel)).toBeInTheDocument();
    expect(first).toHaveTextContent(pl.discussion.authorChip);

    const second = screen.getByTestId('conversation-row-c2');
    expect(second).toHaveTextContent(`${pl.messages.ownPrefix} Wiadomość c2`);
    expect(within(second).queryByText(pl.notifications.unreadLabel)).not.toBeInTheDocument();
  });

  it('shows the empty state with the discovery hint', async () => {
    server.use(okConversations([]));

    await renderPage();

    expect(await screen.findByTestId('conversations-empty')).toHaveTextContent(
      pl.messages.emptyList,
    );
    expect(screen.getByText(pl.messages.emptyListHint)).toBeInTheDocument();
  });

  it('sends an unauthenticated viewer to the sign-in page', async () => {
    server.use(
      http.get('*/api/messages', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
          { status: 401 },
        ),
      ),
    );

    const { router } = await renderPage();

    expect(await screen.findByText('login')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
