import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  createPostInputSchema,
  reactToPostInputSchema,
  type DiscussionPost,
  type MemberSpace,
  type SpaceFeedItem,
} from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { SpaceFeedPage } from './SpaceFeedPage.js';
import { SpaceThreadPage } from './SpaceThreadPage.js';
import { SpacesListPage } from './SpacesListPage.js';

const okMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'user@example.com',
        name: 'Jan Uczestnik',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'm1' },
      },
    }),
  );

const noNotifications = () =>
  http.get('/api/notifications/unread-count', () => HttpResponse.json({ ok: true, data: { unread: 0 } }));

const space = (input: Partial<MemberSpace> & { id: string }): MemberSpace => ({
  tenantId: 't1',
  slug: input.id,
  name: 'Strefa Społeczność',
  description: 'Rozmowy o kamperze.',
  visibility: 'members',
  productIds: [],
  position: 0,
  archivedAt: null,
  createdAt: '2026-07-20T08:00:00.000Z',
  isFollowing: false,
  ...input,
});

const feedItem = (input: Partial<SpaceFeedItem> & { id: string }): SpaceFeedItem => ({
  tenantId: 't1',
  contextKind: 'space',
  contextId: 's1',
  parentPostId: null,
  rootPostId: input.id,
  isOwn: false,
  authorDisplay: 'Ola Autorka',
  authorIsStaff: false,
  body: 'Pierwszy wpis w strefie',
  createdAt: '2026-07-20T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  replyCount: 0,
  reactions: [],
  ...input,
});

const okSpaces = (spaces: MemberSpace[]) =>
  http.get('/api/spaces', () => HttpResponse.json({ ok: true, data: { spaces } }));

const okFeed = (spaceId: string, items: SpaceFeedItem[], isFollowing = false) =>
  http.get('/api/spaces/:spaceId/feed', () =>
    HttpResponse.json({
      ok: true,
      data: { feed: { spaceId, items, nextCursor: null, isFollowing } },
    }),
  );

const okDiscussion = (
  threads: DiscussionPost[],
  viewerSubscriptions: Record<string, 'subscribed' | 'muted'> = {},
) =>
  http.get('/api/discussion', () =>
    HttpResponse.json({
      ok: true,
      data: { discussion: { threads, nextCursor: null, viewerSubscriptions } },
    }),
  );

const renderPage = async (component: () => ReactNode, path: string) => {
  const rootRoute = createRootRoute({ component });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('community pages', () => {
  it('lists visibility-filtered spaces with the community tab present', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'Ogólna', isFollowing: true })]),
    );

    await renderPage(SpacesListPage, '/community');

    expect(await screen.findByTestId('space-card-s1')).toHaveTextContent('Ogólna');
    expect(screen.getByTestId('space-following-s1')).toHaveTextContent(pl.community.followingChip);
    expect(screen.getAllByRole('link', { name: pl.community.tab }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('space-card-gated')).not.toBeInTheDocument();
  });

  it('renders the space feed with root posts, reply counts and reaction chips', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'Ogólna' })]),
      okFeed('s1', [
        feedItem({
          id: 'p1',
          body: 'Cześć wszystkim',
          replyCount: 3,
          reactions: [{ emoji: '👍', count: 2, viewerReacted: false }],
        }),
        feedItem({ id: 'p2', body: 'Drugi wpis' }),
      ]),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByRole('heading', { name: 'Ogólna' })).toBeInTheDocument();
    expect(screen.getByTestId('post-body-p1')).toHaveTextContent('Cześć wszystkim');
    expect(screen.getByTestId('reply-count-p1')).toHaveTextContent(pl.discussion.replyCount({ count: 3 }));
    expect(screen.getByTestId('reaction-p1-👍')).toHaveTextContent('2');
    expect(screen.getByTestId('open-thread-p1')).toHaveAttribute('href', '/community/s1/posts/p1');
    expect(screen.getByTestId('feed-post-p2')).toBeInTheDocument();
  });

  it('publishes a root post through the composer', async () => {
    const bodies: unknown[] = [];
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', []),
      http.post('/api/posts', async ({ request }) => {
        const body = createPostInputSchema.parse(await request.json());
        bodies.push(body);
        return HttpResponse.json({
          ok: true,
          data: { post: feedItem({ id: 'new1', body: body.body, isOwn: true }) },
        });
      }),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    await user.type(await screen.findByTestId('space-composer-input'), 'Mój nowy wpis');
    await user.click(screen.getByTestId('space-composer-submit'));

    await waitFor(() =>
      expect(bodies).toEqual([{ contextKind: 'space', contextId: 's1', body: 'Mój nowy wpis' }]),
    );
  });

  it('toggles the viewer reaction on a post', async () => {
    const reactCalls: unknown[] = [];
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', [feedItem({ id: 'p1', reactions: [{ emoji: '👍', count: 1, viewerReacted: false }] })]),
      http.post('/api/posts/react', async ({ request }) => {
        const body = reactToPostInputSchema.parse(await request.json());
        reactCalls.push(body);
        return HttpResponse.json({
          ok: true,
          data: { postId: body.postId, reactions: [{ emoji: '👍', count: 2, viewerReacted: true }] },
        });
      }),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    const chip = await screen.findByTestId('reaction-p1-👍');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);

    await waitFor(() => expect(reactCalls).toEqual([{ postId: 'p1', emoji: '👍' }]));
    await waitFor(() => expect(screen.getByTestId('reaction-p1-👍')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('reaction-p1-👍')).toHaveTextContent('2');
  });

  it('mutes a followed thread from the space thread surface', async () => {
    const muteCalls: unknown[] = [];
    const root: DiscussionPost = {
      ...feedItem({ id: 'p1', body: 'Obserwowany wątek' }),
      replies: [],
    };
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'Ogólna' })]),
      okDiscussion([root], { p1: 'subscribed' }),
      http.post('/api/discussion/mute', async ({ request }) => {
        muteCalls.push(await request.json());
        return HttpResponse.json({ ok: true, data: { rootPostId: 'p1' } });
      }),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceThreadPage spaceId="s1" postId="p1" />, '/community/s1/posts/p1');

    const toggle = await screen.findByTestId('follow-toggle-p1');
    expect(toggle).toHaveTextContent(pl.discussion.following);
    await user.click(toggle);

    await waitFor(() => expect(muteCalls).toEqual([{ rootPostId: 'p1' }]));
    expect(screen.getByTestId('follow-toggle-p1')).toHaveTextContent(pl.discussion.mutedState);
  });

  it('hides a gated space the member cannot access behind a not-found state', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'Ogólna' })]),
    );

    await renderPage(() => <SpaceFeedPage spaceId="gated" />, '/community/gated');

    expect((await screen.findAllByText(pl.community.spaceNotFoundTitle)).length).toBeGreaterThan(0);
    expect(screen.getByText(pl.community.spaceNotFoundBody)).toBeInTheDocument();
    expect(screen.queryByTestId('space-composer-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-post-p1')).not.toBeInTheDocument();
  });
});
