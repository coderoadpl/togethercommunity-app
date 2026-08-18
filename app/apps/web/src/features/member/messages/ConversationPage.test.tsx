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

import type { PublicDmConversation, PublicDmMessage } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ConversationPage } from './ConversationPage.js';

const conversation: PublicDmConversation = {
  id: 'c1',
  otherParticipant: { display: 'Ola', avatarUrl: null, isStaff: false },
  lastMessageAt: '2026-08-17T09:00:00.000Z',
  lastMessageSnippet: 'Cześć',
  lastMessageIsOwn: false,
  hasMessages: true,
  unread: true,
};

const message = (input: { id: string; body: string; own?: boolean; at?: string }): PublicDmMessage => ({
  id: input.id,
  conversationId: 'c1',
  body: input.body,
  createdAt: input.at ?? '2026-08-17T09:00:00.000Z',
  isOwn: input.own ?? false,
});

const okThread = (messages: PublicDmMessage[], nextCursor: string | null = null) =>
  http.get('*/api/messages/c1', () =>
    HttpResponse.json({ ok: true, data: { conversation, messages, nextCursor } }),
  );

const okRead = () =>
  http.post('*/api/messages/read', () =>
    HttpResponse.json({
      ok: true,
      data: { conversationId: 'c1', lastReadAt: '2026-08-17T10:00:00.000Z' },
    }),
  );

const renderPage = async () => {
  const rootRoute = createRootRoute();
  const conversationRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/messages/$conversationId',
    component: () => <ConversationPage conversationId="c1" />,
  });
  const messagesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/messages',
    component: () => <p>lista</p>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <p>login</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([conversationRoute, messagesRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ['/messages/c1'] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('ConversationPage', () => {
  it('renders the thread oldest first and marks it read on mount', async () => {
    let readBody: unknown;
    server.use(
      okThread([
        message({ id: 'm2', body: 'Druga', own: true, at: '2026-08-17T09:05:00.000Z' }),
        message({ id: 'm1', body: 'Pierwsza' }),
      ]),
      http.post('*/api/messages/read', async ({ request }) => {
        readBody = await request.json();
        return HttpResponse.json({
          ok: true,
          data: { conversationId: 'c1', lastReadAt: '2026-08-17T10:00:00.000Z' },
        });
      }),
    );

    await renderPage();

    const list = await screen.findByTestId('conversation-messages');
    expect([...list.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      'message-m1',
      'message-m2',
    ]);
    await waitFor(() => expect(readBody).toEqual({ conversationId: 'c1' }));
  });

  it('sends a message and clears the composer', async () => {
    let sendBody: unknown;
    server.use(
      okThread([message({ id: 'm1', body: 'Pierwsza' })]),
      okRead(),
      http.post('*/api/messages/send', async ({ request }) => {
        sendBody = await request.json();
        return HttpResponse.json({
          ok: true,
          data: { message: message({ id: 'm2', body: 'Odpowiedź', own: true }) },
        });
      }),
    );

    await renderPage();

    const input = await screen.findByTestId('message-composer-input');
    await userEvent.type(input, 'Odpowiedź');
    await userEvent.click(screen.getByTestId('message-composer-submit'));

    await waitFor(() => expect(sendBody).toEqual({ conversationId: 'c1', body: 'Odpowiedź' }));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('translates a rate-limited send into the throttling notice', async () => {
    server.use(
      okThread([message({ id: 'm1', body: 'Pierwsza' })]),
      okRead(),
      http.post('*/api/messages/send', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'rate_limited', message: 'Too fast' } },
          { status: 429 },
        ),
      ),
    );

    await renderPage();

    await userEvent.type(await screen.findByTestId('message-composer-input'), 'Znowu');
    await userEvent.click(screen.getByTestId('message-composer-submit'));

    expect(await screen.findByText(pl.messages.rateLimited)).toBeInTheDocument();
  });

  it('shows the empty conversation state before the first message', async () => {
    server.use(okThread([]), okRead());

    await renderPage();

    expect(await screen.findByTestId('conversation-empty')).toHaveTextContent(
      pl.messages.emptyConversation,
    );
  });
});
