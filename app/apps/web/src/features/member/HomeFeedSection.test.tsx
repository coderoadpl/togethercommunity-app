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

import { updatePostInputSchema, type MemberHomeFeedItem } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
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
  body: `Content ${id}`,
  createdAt: '2026-08-12T10:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  isOwn: false,
  replyCount: 0,
  reactions: [],
  spaceId: 's1',
  spaceName: 'General',
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

const okMe = (staffRole: 'owner' | 'admin' | null = null) =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'member@example.com',
        emailVerified: true,
        name: 'Member',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole, memberId: 'm1', banned: false },
      },
    }),
  );

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
  it.each([
    { staffRole: null, isOwn: true, canDelete: true, canEdit: true },
    { staffRole: 'owner', isOwn: false, canDelete: true, canEdit: false },
    { staffRole: 'admin', isOwn: false, canDelete: true, canEdit: false },
    { staffRole: null, isOwn: false, canDelete: false, canEdit: false },
  ] as const)('offers feed actions for $staffRole, own=$isOwn', async ({ staffRole, isOwn, canDelete, canEdit }) => {
    server.use(okMe(staffRole), okFeed({ '10': { items: [item('p1', { isOwn })], nextCursor: null } }));

    await renderSection();

    await userEvent.click(await screen.findByTestId('post-menu-p1'));
    expect(screen.queryByTestId('delete-button-p1') !== null).toBe(canDelete);
    expect(screen.queryByTestId('edit-button-p1') !== null).toBe(canEdit);
  });

  it('confirms deletion and removes an empty own root from the feed without reloading', async () => {
    let post = item('p1', { isOwn: true });
    const deletedIds: string[] = [];
    server.use(
      okMe(),
      http.get('/api/member/home-feed', () => HttpResponse.json({
        ok: true,
        data: { feed: { items: post.deletedAt === null ? [post] : [], nextCursor: null } },
      })),
      http.delete('/api/posts/:postId', ({ params }) => {
        deletedIds.push(String(params['postId']));
        post = { ...post, body: 'Deleted post', deletedAt: '2026-08-12T11:00:00.000Z', deletedBy: 'author' };
        return HttpResponse.json({ ok: true, data: { post } });
      }),
    );

    await renderSection();

    await userEvent.click(await screen.findByTestId('post-menu-p1'));
    await userEvent.click(screen.getByTestId('delete-button-p1'));
    expect(await screen.findByText(en.discussion.deleteConfirmTitle)).toBeInTheDocument();
    expect(screen.getByText(en.discussion.deleteConfirmBody)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.common.cancel }));
    expect(deletedIds).toEqual([]);
    expect(screen.getByTestId('home-feed-post-p1')).toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('post-menu-p1'));
    await userEvent.click(screen.getByTestId('delete-button-p1'));
    await userEvent.click(screen.getByTestId('confirm-delete-post'));
    await waitFor(() => expect(screen.queryByTestId('home-feed-post-p1')).not.toBeInTheDocument());
    expect(deletedIds).toEqual(['p1']);
    expect(screen.getByTestId('start-feed-empty')).toBeInTheDocument();
  });

  it.each(['author', 'moderator'] as const)('keeps a %s tombstone readable with only a permanent-delete menu', async (deletedBy) => {
    server.use(okMe('admin'), okFeed({ '10': {
      items: [item('p1', { isOwn: true, replyCount: 2, deletedAt: '2026-08-12T11:00:00.000Z', deletedBy })],
      nextCursor: null,
    } }));

    await renderSection();

    expect(await screen.findByTestId('home-feed-deleted-p1')).toHaveTextContent(
      deletedBy === 'moderator' ? en.discussion.moderatorDeletedPost : en.discussion.deletedPost,
    );
    expect(screen.queryByTestId('home-feed-body-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('home-feed-reply-count-p1')).toHaveTextContent(en.discussion.replyCount({ count: 2 }));
    await userEvent.click(await screen.findByTestId('post-menu-p1'));
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByTestId('purge-button-p1')).toHaveTextContent(en.discussion.purge);
    await userEvent.click(screen.getByTestId('purge-button-p1'));
    expect(await screen.findByText(en.discussion.purgeConfirmBody)).toBeInTheDocument();
  });

  it('edits an own feed post and refreshes its body', async () => {
    let post = item('p1', { isOwn: true });
    server.use(
      okMe(),
      http.get('/api/member/home-feed', () => HttpResponse.json({
        ok: true,
        data: { feed: { items: [post], nextCursor: null } },
      })),
      http.post('/api/posts/update', async ({ request }) => {
        const input = updatePostInputSchema.parse(await request.json());
        expect(input.id).toBe('p1');
        post = { ...post, body: input.body, editedAt: '2026-08-12T11:00:00.000Z' };
        return HttpResponse.json({ ok: true, data: { post } });
      }),
    );

    await renderSection();

    await userEvent.click(await screen.findByTestId('post-menu-p1'));
    await userEvent.click(screen.getByTestId('edit-button-p1'));
    const input = screen.getByTestId('edit-composer-p1-input');
    expect(input).toHaveValue(post.body);
    await userEvent.clear(input);
    await userEvent.type(input, 'Updated post');
    await userEvent.click(screen.getByTestId('edit-composer-p1-submit'));
    expect(await screen.findByTestId('home-feed-body-p1')).toHaveTextContent('Updated post');
  });

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
            item('p2', { spaceId: 's2', spaceName: 'Club', contextId: 's2', body: 'See https://courses.example.org/guide.' }),
          ],
          nextCursor: null,
        },
      }),
    );

    await renderSection();

    const card = await screen.findByTestId('home-feed-post-p1');
    expect(card).toHaveTextContent('Ada Nowak');
    expect(within(card).getByTestId('home-feed-author-chip-p1')).toHaveTextContent(
      en.discussion.authorChip,
    );
    expect(within(card).getByTestId('home-feed-space-p1')).toHaveAttribute('href', '/community/s1');
    expect(within(card).getByTestId('home-feed-space-p1')).toHaveTextContent('General');
    expect(within(card).getByTestId('home-feed-body-p1')).toHaveTextContent('Content p1');
    expect(within(card).getByTestId('home-feed-reaction-p1-👍')).toHaveTextContent('👍 2');
    expect(within(card).queryByTestId('reaction-picker-p1')).toBeNull();
    expect(within(card).getByTestId('post-menu-p1')).toBeInTheDocument();
    expect(within(card).getByTestId('home-feed-reply-count-p1')).toHaveTextContent(
      en.discussion.replyCount({ count: 3 }),
    );
    expect(within(card).getByTestId('home-feed-open-p1')).toHaveAttribute(
      'href',
      '/community/s1/posts/p1',
    );

    expect(within(card).getByTestId('user-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/ada.png',
    );

    const other = screen.getByTestId('home-feed-post-p2');
    const bodyLink = within(within(other).getByTestId('home-feed-body-p2')).getByRole('link', {
      name: 'https://courses.example.org/guide',
    });
    expect(bodyLink).toHaveAttribute('href', 'https://courses.example.org/guide');
    expect(bodyLink).toHaveAttribute('target', '_blank');
    expect(bodyLink).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(within(other).queryByTestId('user-avatar-image')).toBeNull();
    expect(within(other).getByTestId('user-avatar')).toHaveTextContent('AN');
    expect(within(other).getByTestId('home-feed-space-p2')).toHaveAttribute('href', '/community/s2');
    expect(within(other).getByTestId('home-feed-open-p2')).toHaveAttribute(
      'href',
      '/community/s2/posts/p2',
    );
    expect(screen.queryByTestId('start-feed-load-more')).not.toBeInTheDocument();
  });

  it('spaces the wrapped author line and keeps the post menu on the meta row', async () => {
    server.use(okFeed({ '10': { items: [item('p1', { replyCount: 1 })], nextCursor: null } }));

    await renderSection();

    const card = await screen.findByTestId('home-feed-post-p1');
    const authorRow = within(card).getByTestId('home-feed-space-p1').parentElement;
    expect(authorRow).toHaveStyle({ rowGap: '0.375rem' });

    const metaRow = within(card).getByTestId('home-feed-reply-count-p1').parentElement;
    expect(metaRow).toHaveStyle({ alignItems: 'center' });
    expect(metaRow).toContainElement(within(card).getByTestId('post-menu-p1'));
    expect(within(card).getByTestId('post-menu-p1').parentElement).toHaveStyle({
      marginLeft: 'auto',
    });
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
    expect(loadMore).toHaveTextContent(en.discussion.loadMore);

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

    expect(await screen.findByTestId('start-feed-empty')).toHaveTextContent(en.start.feedEmpty);
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

    expect(await screen.findByRole('button', { name: en.common.retry })).toBeInTheDocument();
  });
});

it('hides tombstone menus from members, including the author', async () => {
  server.use(okMe(), okFeed({ '10': {
    items: [item('p1', { isOwn: true, deletedAt: '2026-08-12T11:00:00.000Z', replyCount: 1 })], nextCursor: null,
  } }));
  await renderSection();
  await screen.findByTestId('home-feed-deleted-p1');
  expect(screen.queryByTestId('post-menu-p1')).not.toBeInTheDocument();
});

it('purges a tombstone only after confirmation and refreshes the feed', async () => {
  const purged: string[] = [];
  server.use(okMe('admin'),
    http.get('/api/member/home-feed', () => HttpResponse.json({ ok: true, data: { feed: {
      items: purged.length === 0 ? [item('p1', { deletedAt: '2026-08-12T11:00:00.000Z', replyCount: 1 })] : [], nextCursor: null,
    } } })),
    http.delete('/api/posts/:postId/permanent', ({ params }) => {
      purged.push(String(params['postId']));
      return HttpResponse.json({ ok: true, data: { id: params['postId'] } });
    }),
  );
  await renderSection();
  await userEvent.click(await screen.findByTestId('post-menu-p1'));
  await userEvent.click(screen.getByTestId('purge-button-p1'));
  expect(purged).toEqual([]);
  await userEvent.click(screen.getByRole('button', { name: en.common.cancel }));
  expect(purged).toEqual([]);
  await userEvent.click(await screen.findByTestId('post-menu-p1'));
  await userEvent.click(screen.getByTestId('purge-button-p1'));
  await userEvent.click(screen.getByTestId('confirm-purge-post'));
  await screen.findByTestId('start-feed-empty');
  expect(purged).toEqual(['p1']);
});
