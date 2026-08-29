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
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  createPostInputSchema,
  reactToPostInputSchema,
  type DiscussionPost,
  type MemberNavigation,
  type MemberSpace,
  type PublicNavigation,
  type SpaceFeedItem,
} from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { MemberShell } from './shell/MemberShell.js';
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
        emailVerified: true,
        name: 'Jan Uczestnik',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'm1', banned: false },
      },
    }),
  );

const anonMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    ),
  );

const publicNavigation = (overrides: Partial<PublicNavigation> = {}): PublicNavigation => ({
  defaultHomeSpaceId: 's1',
  spaces: [{ id: 's1', slug: 's1', name: 'Ogólna', description: 'Rozmowy o kamperze.', position: 0 }],
  courses: [],
  lockedSpaces: [
    { id: 'gated', slug: 'premium', name: 'Premium', description: null, productIds: ['p1'] },
  ],
  ...overrides,
});

const okPublicNavigation = (value: PublicNavigation = publicNavigation()) =>
  http.get('/api/public/navigation', () =>
    HttpResponse.json({ ok: true, data: { navigation: value } }));

const okPublicFeed = (spaceId: string, items: SpaceFeedItem[]) =>
  http.get('/api/public/spaces/:spaceId/feed', () =>
    HttpResponse.json({
      ok: true,
      data: { feed: { spaceId, items, pinned: [], nextCursor: null, isFollowing: false } },
    }),
  );

const okPublicThread = (threads: DiscussionPost[]) =>
  http.get('/api/public/spaces/:spaceId/posts/:postId', () =>
    HttpResponse.json({
      ok: true,
      data: { discussion: { threads, nextCursor: null, viewerSubscriptions: {} } },
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
  publicReadOnly: false,
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
  authorAvatarUrl: null,
  body: 'Pierwszy wpis w strefie',
  createdAt: '2026-07-20T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  replyCount: 0,
  reactions: [],
  ...input,
});

const okMemberNavigation = (lockedSpaces: MemberNavigation['lockedSpaces']) =>
  http.get('/api/member/navigation', () =>
    HttpResponse.json({
      ok: true,
      data: { navigation: { spaces: [], courses: [], lockedSpaces } },
    }),
  );

const okSpaces = (spaces: MemberSpace[]) =>
  http.get('/api/spaces', () => HttpResponse.json({ ok: true, data: { spaces } }));

const okFeed = (spaceId: string, items: SpaceFeedItem[], isFollowing = false) =>
  http.get('/api/spaces/:spaceId/feed', () =>
    HttpResponse.json({
      ok: true,
      data: { feed: { spaceId, items, nextCursor: null, isFollowing } },
    }),
  );

const forbiddenFeed = () =>
  http.get('/api/spaces/:spaceId/feed', () =>
    HttpResponse.json(
      { ok: false, error: { code: 'forbidden', message: 'Brak dostępu' } },
      { status: 403 },
    ),
  );

const okSeen = (calls: string[] = []) =>
  http.post('/api/spaces/:spaceId/seen', ({ params }) => {
    const spaceId = String(params.spaceId);
    calls.push(spaceId);
    return HttpResponse.json({ ok: true, data: { spaceId, seenAt: '2026-07-20T09:00:00.000Z' } });
  });

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

const countedAnonMe = (counter: { calls: number }) =>
  http.get('/api/me', () => {
    counter.calls += 1;
    return HttpResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    );
  });

const okOffer = () =>
  http.get('/api/public/offer', () =>
    HttpResponse.json({
      ok: true,
      data: {
        tenant: {
          slug: 'acme',
          name: 'Acme',
          branding: { logoUrl: null, accentColor: null, faviconUrl: null },
          socialLinks: [],
        },
        contentVersion: 1,
        products: [],
      },
    }),
  );

const renderShellPage = async (component: () => ReactNode, path: string) => {
  const rootRoute = createRootRoute();
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: 'member-shell',
    component: MemberShell,
  });
  const spaceRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: '/community/$spaceId',
    component,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([shellRoute.addChildren([spaceRoute])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderWithProviders(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
};

describe('community pages', () => {
  it('lists visibility-filtered spaces', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'Ogólna', isFollowing: true })]),
    );

    await renderPage(SpacesListPage, '/community');

    expect(await screen.findByTestId('space-card-s1')).toHaveTextContent('Ogólna');
    expect(screen.getByTestId('space-following-s1')).toHaveTextContent(pl.community.followingChip);
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
          authorAvatarUrl: 'https://cdn.test/ola.png',
        }),
        feedItem({ id: 'p2', body: 'Drugi wpis' }),
      ]),
      okSeen(),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByRole('heading', { name: 'Ogólna' })).toBeInTheDocument();
    expect(screen.getByTestId('post-body-p1')).toHaveTextContent('Cześć wszystkim');
    expect(screen.getByTestId('reply-count-p1')).toHaveTextContent(pl.discussion.replyCount({ count: 3 }));
    expect(screen.getByTestId('reaction-p1-👍')).toHaveTextContent('2');
    expect(screen.getByTestId('open-thread-p1')).toHaveAttribute('href', '/community/s1/posts/p1');
    expect(screen.getByTestId('feed-post-p2')).toBeInTheDocument();
    expect(within(screen.getByTestId('feed-post-p1')).getByTestId('member-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/ola.png',
    );
    const plainPost = within(screen.getByTestId('feed-post-p2'));
    expect(plainPost.queryByTestId('member-avatar-image')).toBeNull();
    expect(plainPost.getByTestId('member-avatar')).toHaveTextContent('OA');
  });

  it('publishes a root post through the composer', async () => {
    const bodies: unknown[] = [];
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', []),
      okSeen(),
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
      okSeen(),
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

  it('marks the space seen once it opens and again after posting', async () => {
    const seenCalls: string[] = [];
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', []),
      okSeen(seenCalls),
      http.post('/api/posts', async ({ request }) => {
        const body = createPostInputSchema.parse(await request.json());
        return HttpResponse.json({
          ok: true,
          data: { post: feedItem({ id: 'new1', body: body.body, isOwn: true }) },
        });
      }),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    await waitFor(() => expect(seenCalls).toEqual(['s1']));

    await user.type(await screen.findByTestId('space-composer-input'), 'Mój nowy wpis');
    await user.click(screen.getByTestId('space-composer-submit'));

    await waitFor(() => expect(seenCalls).toEqual(['s1', 's1']));
  });

  it('hides a gated space the member cannot access behind a not-found state', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'Ogólna' })]),
      forbiddenFeed(),
      okMemberNavigation([]),
    );

    await renderPage(() => <SpaceFeedPage spaceId="gated" />, '/community/gated');

    expect((await screen.findAllByText(pl.community.spaceNotFoundTitle)).length).toBeGreaterThan(0);
    expect(screen.getByText(pl.community.spaceNotFoundBody)).toBeInTheDocument();
    expect(screen.queryByTestId('space-composer-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-post-p1')).not.toBeInTheDocument();
  });

  it('sells a gated space the member cannot access instead of a not-found dead end', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'Ogólna' })]),
      forbiddenFeed(),
      okMemberNavigation([
        { id: 'gated', slug: 'premium', name: 'Premium', description: 'Tylko dla kursantów.', productIds: ['p1'] },
      ]),
    );

    await renderPage(() => <SpaceFeedPage spaceId="gated" />, '/community/gated');

    expect(await screen.findByTestId('locked-space-view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Premium' })).toBeInTheDocument();
    expect(screen.getByTestId('locked-space-cta-gated')).toHaveAttribute('href', '/checkout/p1');
    expect(screen.queryByText(pl.community.spaceNotFoundTitle)).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-breadcrumbs')).not.toBeInTheDocument();
  });

  it('serves an anonymous visitor a read-only feed with a sign-in CTA and no composer', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicFeed('s1', [feedItem({ id: 'p1', body: 'Publiczny wpis', replyCount: 2 })]),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('public-feed-post-p1')).toHaveTextContent('Publiczny wpis');
    expect(screen.getByTestId('public-open-thread-p1')).toHaveAttribute(
      'href',
      '/community/s1/posts/p1',
    );
    expect(screen.getByTestId('anon-read-only')).toHaveTextContent(pl.anon.readOnlyBanner);
    expect(screen.getByTestId('anon-join-cta')).toHaveAttribute('href', '/login');
    expect(screen.queryByTestId('space-composer-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('space-follow-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reaction-p1-👍')).not.toBeInTheDocument();
  });

  it('points an anonymous visitor at checkout for a product-gated space', async () => {
    server.use(anonMe(), okPublicNavigation());

    await renderPage(() => <SpaceFeedPage spaceId="gated" />, '/community/gated');

    expect(await screen.findByTestId('anon-space-unlock')).toHaveAttribute('href', '/checkout/p1');
    expect(screen.queryByTestId('space-composer-input')).not.toBeInTheDocument();
  });

  it('renders an anonymous thread read-only with its replies', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicThread([
        {
          ...feedItem({ id: 'p1', body: 'Wątek publiczny' }),
          replies: [{ ...feedItem({ id: 'r1', body: 'Odpowiedź' }), replies: [], replyCount: 0 }],
          replyCount: 1,
        },
      ]),
    );

    await renderPage(
      () => <SpaceThreadPage spaceId="s1" postId="p1" />,
      '/community/s1/posts/p1',
    );

    expect(await screen.findByTestId('public-post-p1')).toHaveTextContent('Wątek publiczny');
    expect(screen.getByTestId('public-reply-r1')).toHaveTextContent('Odpowiedź');
    expect(screen.getByTestId('anon-join-cta')).toHaveAttribute('href', '/login');
    expect(screen.queryByTestId('reply-composer-input')).not.toBeInTheDocument();
  });

  it('settles an anonymous visitor inside the shell without refetching the identity in a loop', async () => {
    const counter = { calls: 0 };
    server.use(
      countedAnonMe(counter),
      okOffer(),
      okPublicNavigation(),
      okPublicFeed('s1', [feedItem({ id: 'p1', body: 'Publiczny wpis' })]),
    );

    await renderShellPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('public-feed-post-p1')).toHaveTextContent('Publiczny wpis');
    expect(screen.getByTestId('anon-read-only')).toHaveTextContent(pl.anon.readOnlyBanner);

    const settledCalls = counter.calls;
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    expect(counter.calls).toBe(settledCalls);
  });
});
