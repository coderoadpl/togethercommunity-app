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
import { describe, expect, it } from 'vitest';

import type { MemberHomeFeedItem } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { HomeFeedSection } from './HomeFeedSection.js';

const item = (
  id: string,
  overrides: Partial<MemberHomeFeedItem> = {},
): MemberHomeFeedItem => ({
  id,
  tenantId: 't1',
  contextKind: 'space',
  contextId: 's1',
  parentPostId: null,
  rootPostId: id,
  authorDisplay: 'Ada Nowak',
  authorIsStaff: false,
  authorAvatarUrl: null,
  body: `Treść ${id}`,
  createdAt: '2026-08-12T10:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  isOwn: false,
  replyCount: 0,
  reactions: [],
  spaceId: 's1',
  spaceName: 'Ogólna',
  ...overrides,
});

const okFeed = (
  pageByLimit: Record<string, { items: MemberHomeFeedItem[]; nextCursor: string | null }>,
) =>
  http.get('/api/member/home-feed', ({ request }) => {
    const limit = new URL(request.url).searchParams.get('limit') ?? '10';
    const page = pageByLimit[limit] ?? { items: [], nextCursor: null };
    return HttpResponse.json({ ok: true, data: { feed: page } });
  });

const renderSection = async () => {
  const rootRoute = createRootRoute();
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    component: HomeFeedSection,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([startRoute]),
    history: createMemoryHistory({ initialEntries: ['/start'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('HomeFeedSection', () => {
  it('renders a card per root post with its room, reply count and thread link', async () => {
    server.use(
      okFeed({
        '10': {
          items: [
            item('p1', {
              authorIsStaff: true,
              replyCount: 3,
              reactions: [{ emoji: '👍', count: 2, viewerReacted: false }],
              authorAvatarUrl: 'https://cdn.test/ada.png',
            }),
            item('p2', { spaceId: 's2', spaceName: 'Klub', contextId: 's2' }),
          ],
          nextCursor: null,
        },
      }),
    );

    await renderSection();

    const card = await screen.findByTestId('home-feed-post-p1');
    expect(card).toHaveTextContent('Ada Nowak');
    expect(within(card).getByTestId('home-feed-author-chip-p1')).toHaveTextContent(
      pl.discussion.authorChip,
    );
    expect(within(card).getByTestId('home-feed-space-p1')).toHaveAttribute('href', '/community/s1');
    expect(within(card).getByTestId('home-feed-space-p1')).toHaveTextContent('Ogólna');
    expect(within(card).getByTestId('home-feed-body-p1')).toHaveTextContent('Treść p1');
    expect(within(card).getByTestId('home-feed-reaction-p1-👍')).toHaveTextContent('👍 2');
    expect(within(card).queryByTestId('reaction-picker-p1')).toBeNull();
    expect(within(card).getByTestId('post-menu-p1')).toBeInTheDocument();
    expect(within(card).getByTestId('home-feed-reply-count-p1')).toHaveTextContent(
      pl.discussion.replyCount({ count: 3 }),
    );
    expect(within(card).getByTestId('home-feed-open-p1')).toHaveAttribute(
      'href',
      '/community/s1/posts/p1',
    );

    expect(within(card).getByTestId('member-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/ada.png',
    );

    const other = screen.getByTestId('home-feed-post-p2');
    expect(within(other).queryByTestId('member-avatar-image')).toBeNull();
    expect(within(other).getByTestId('member-avatar')).toHaveTextContent('AN');
    expect(within(other).getByTestId('home-feed-space-p2')).toHaveAttribute('href', '/community/s2');
    expect(within(other).getByTestId('home-feed-open-p2')).toHaveAttribute(
      'href',
      '/community/s2/posts/p2',
    );
    expect(screen.queryByTestId('start-feed-load-more')).not.toBeInTheDocument();
  });

  it('grows the page on load more without dropping the rendered cards', async () => {
    server.use(
      okFeed({
        '10': { items: [item('p1')], nextCursor: '2026-08-12T10:00:00.000Z|p1' },
        '20': { items: [item('p1'), item('p2')], nextCursor: null },
      }),
    );

    await renderSection();

    const loadMore = await screen.findByTestId('start-feed-load-more');
    expect(loadMore).toHaveTextContent(pl.discussion.loadMore);

    await userEvent.click(loadMore);

    await waitFor(() => {
      expect(screen.getByTestId('home-feed-post-p2')).toBeInTheDocument();
    });
    expect(screen.getByTestId('home-feed-post-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('start-feed-load-more')).not.toBeInTheDocument();
  });

  it('states quietly that the accessible spaces have no posts yet', async () => {
    server.use(okFeed({ '10': { items: [], nextCursor: null } }));

    await renderSection();

    expect(await screen.findByTestId('start-feed-empty')).toHaveTextContent(pl.start.feedEmpty);
  });

  it('offers a retry when the feed fails', async () => {
    server.use(
      http.get('/api/member/home-feed', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'internal', message: 'boom' } },
          { status: 500 },
        ),
      ),
    );

    await renderSection();

    expect(await screen.findByRole('button', { name: pl.common.retry })).toBeInTheDocument();
  });
});
