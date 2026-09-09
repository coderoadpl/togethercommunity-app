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
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPostInputSchema,
  reactToPostInputSchema,
  type DiscussionPost,
  type MemberNavigation,
  type MemberSpace,
  type PublicNavigation,
  type SpaceFeedItem,
} from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { MemberShell } from './shell/MemberShell.js';
import { SpaceFeedPage } from './SpaceFeedPage.js';
import { SpaceThreadPage } from './SpaceThreadPage.js';
import { SpacesListPage } from './SpacesListPage.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const okMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'user@example.com',
        emailVerified: true,
        name: 'John Participant',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'm1', banned: false },
      },
    }),
  );

const impersonatedMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'user@example.com',
        emailVerified: true,
        name: 'John Participant',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'm1', banned: false },
        impersonation: {
          id: 'imp-1',
          subjectMemberId: 'm1',
          subjectName: 'John Participant',
          actorName: 'Olivia Operator',
          expiresAt: '2026-07-20T10:00:00.000Z',
        },
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
  spaces: [{ id: 's1', slug: 's1', name: 'General', description: 'Camper conversations.', position: 0 }],
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
  name: 'Community Space',
  description: 'Camper conversations.',
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
  authorDisplay: 'Olivia Author',
  authorIsStaff: false,
  authorAvatarUrl: null,
  body: 'First post in the space',
  createdAt: '2026-07-20T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  replyCount: 0,
  reactions: [],
  ...input,
});

const markupLikeBody = 'Generic<T> plus <script>alert(1)</script> https://courses.example.org/guide.';

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
      { ok: false, error: { code: 'forbidden', message: 'No access' } },
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

const stubNarrowViewport = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

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
      okSpaces([space({ id: 's1', name: 'General', isFollowing: true })]),
    );

    await renderPage(SpacesListPage, '/community');

    expect(await screen.findByTestId('space-card-s1')).toHaveTextContent('General');
    expect(screen.getByTestId('space-following-s1')).toHaveTextContent(en.community.followingChip);
    expect(screen.queryByTestId('space-card-gated')).not.toBeInTheDocument();
  });

  it('labels space cards from public-read, members and product visibility data', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([
        space({ id: 'public', name: 'Public', publicReadOnly: true }),
        space({ id: 'members', name: 'Club' }),
        space({
          id: 'buyers',
          name: 'Buyers',
          visibility: 'product',
          productIds: ['p1'],
          products: [{ id: 'p1', title: 'Pro Program' }],
        }),
        space({
          id: 'buyers-fallback',
          name: 'Buyers without product',
          visibility: 'product',
          productIds: ['p2'],
        }),
      ]),
    );

    await renderPage(SpacesListPage, '/community');

    const publicChip = await screen.findByTestId('space-visibility-public');
    expect(publicChip).toHaveTextContent(en.community.publicReadOnly);
    expect(publicChip.querySelector('svg')).toHaveClass('MuiChip-icon');

    const membersChip = screen.getByTestId('space-visibility-members');
    expect(membersChip).toHaveTextContent(en.community.membersOnly);
    expect(membersChip.querySelector('svg')).toHaveClass('MuiChip-icon');

    const buyersChip = screen.getByTestId('space-visibility-buyers');
    expect(buyersChip).toHaveTextContent(en.community.productGatedFor({ product: 'Pro Program' }));
    expect(buyersChip.querySelector('svg')).toHaveClass('MuiChip-icon');

    const fallbackChip = screen.getByTestId('space-visibility-buyers-fallback');
    expect(fallbackChip).toHaveTextContent(en.community.productGated);
    expect(fallbackChip.querySelector('svg')).toHaveClass('MuiChip-icon');
  });

  it('renders the space feed with root posts, reply counts and reaction chips', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'General' })]),
      okFeed('s1', [
        feedItem({
          id: 'p1',
          body: 'Hello everyone',
          replyCount: 3,
          reactions: [{ emoji: '👍', count: 2, viewerReacted: false }],
          authorAvatarUrl: 'https://cdn.test/olivia.png',
        }),
        feedItem({ id: 'p2', body: 'Second post' }),
      ]),
      okSeen(),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByTestId('post-body-p1')).toHaveTextContent('Hello everyone');
    expect(screen.getByTestId('reply-count-p1')).toHaveTextContent(en.discussion.replyCount({ count: 3 }));
    expect(screen.getByTestId('reaction-p1-👍')).toHaveTextContent('2');
    expect(screen.queryByTestId('reaction-p1-🎉')).not.toBeInTheDocument();
    expect(screen.getByTestId('open-thread-p1')).toHaveAttribute('href', '/community/s1/posts/p1');
    expect(screen.getByTestId('feed-post-p2')).toBeInTheDocument();
    expect(within(screen.getByTestId('feed-post-p1')).getByTestId('user-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/olivia.png',
    );
    const plainPost = within(screen.getByTestId('feed-post-p2'));
    expect(plainPost.queryByTestId('user-avatar-image')).toBeNull();
    expect(plainPost.getByTestId('user-avatar')).toHaveTextContent('OA');
  });

  it('renders angle-bracketed post bodies as literal text in the feed', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'General' })]),
      okFeed('s1', [feedItem({ id: 'p1', body: markupLikeBody })]),
      okSeen(),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    const body = await screen.findByTestId('post-body-p1');
    expect(body.textContent).toBe(markupLikeBody);
    expect(body.querySelector('script')).toBeNull();
    expect(body.innerHTML).toContain('&lt;script&gt;');
    expect(body).toHaveStyle({ marginTop: '0.75rem' });
    expect(within(body).getByRole('link')).toHaveAttribute('href', 'https://courses.example.org/guide');
    expect(within(body).getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(within(body).getByRole('link')).toHaveAttribute('target', '_blank');
  });

  it('renders angle-bracketed post bodies as literal text in the thread view', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'General' })]),
      okDiscussion([
        {
          ...feedItem({ id: 'p1', body: markupLikeBody }),
          replies: [{ ...feedItem({ id: 'p2', parentPostId: 'p1', rootPostId: 'p1', body: markupLikeBody }), replies: [] }],
        },
      ]),
    );

    await renderPage(() => <SpaceThreadPage spaceId="s1" postId="p1" />, '/community/s1/posts/p1');

    for (const postId of ['p1', 'p2']) {
      const body = await screen.findByTestId(`post-body-${postId}`);
      expect(body.textContent).toBe(markupLikeBody);
      expect(body.querySelector('script')).toBeNull();
      expect(body.innerHTML).toContain('&lt;script&gt;');
    }
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

    await user.click(await screen.findByTestId('space-composer-open'));
    await user.type(await screen.findByTestId('space-composer-input'), 'My new post');
    await user.click(screen.getByTestId('space-composer-submit'));

    await waitFor(() =>
      expect(bodies).toEqual([{ contextKind: 'space', contextId: 's1', body: 'My new post' }]),
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

  it('keeps the parent space link in the thread breadcrumbs on a narrow viewport', async () => {
    stubNarrowViewport();
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'General' })]),
      okDiscussion([{ ...feedItem({ id: 'p1', body: 'Followed thread' }), replies: [] }]),
    );

    await renderPage(() => <SpaceThreadPage spaceId="s1" postId="p1" />, '/community/s1/posts/p1');

    const crumbs = await screen.findByTestId('member-breadcrumbs');
    expect(within(crumbs).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/community/s1');
    expect(within(crumbs).getByRole('link', { name: en.community.heading })).toBeVisible();
    expect(within(crumbs).queryByText(en.community.threadTitle)).toBeNull();
  });

  it('adds an unused reaction through the picker popover', async () => {
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
          data: {
            postId: body.postId,
            reactions: [
              { emoji: '👍', count: 1, viewerReacted: false },
              { emoji: '🎉', count: 1, viewerReacted: true },
            ],
          },
        });
      }),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    await user.click(await screen.findByTestId('reaction-picker-p1'));
    await user.click(await screen.findByTestId('reaction-option-p1-🎉'));

    await waitFor(() => expect(reactCalls).toEqual([{ postId: 'p1', emoji: '🎉' }]));
    await waitFor(() => expect(screen.getByTestId('reaction-p1-🎉')).toHaveTextContent('1'));
  });

  it('keeps the space composer collapsed behind a prompt until it is opened', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', []),
      okSeen(),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    const prompt = await screen.findByTestId('space-composer-open');
    expect(prompt).toHaveTextContent(en.community.composerPrompt);
    expect(screen.queryByTestId('space-composer-input')).not.toBeInTheDocument();

    await user.click(prompt);

    expect(await screen.findByTestId('space-composer-submit')).toBeDisabled();
    expect(screen.getByTestId('space-composer-input')).toHaveFocus();

    await user.tab();

    await waitFor(() => expect(screen.queryByTestId('space-composer-submit')).not.toBeInTheDocument());
    expect(screen.getByTestId('space-composer-open')).toBeInTheDocument();
  });

  it('copies a post permalink from the feed overflow menu', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', [feedItem({ id: 'p1' })]),
      okSeen(),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    await user.click(await screen.findByTestId('post-menu-p1'));
    await user.click(await screen.findByTestId('copy-link-p1'));

    expect(await screen.findByText(en.community.copyLinkDone)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/community/s1/posts/p1`,
    );
  });

  it('opens the report dialog from the feed overflow menu', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', [feedItem({ id: 'p1' })]),
      okSeen(),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    await user.click(await screen.findByTestId('post-menu-p1'));
    expect(screen.getByTestId('start-message-p1')).toBeInTheDocument();
    await user.click(screen.getByTestId('report-post-p1'));

    expect(await screen.findByRole('dialog')).toHaveTextContent(en.community.reportTitle);
  });

  it('mutes a followed thread from the space thread surface', async () => {
    const muteCalls: unknown[] = [];
    const root: DiscussionPost = {
      ...feedItem({ id: 'p1', body: 'Followed thread' }),
      replies: [],
    };
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'General' })]),
      okDiscussion([root], { p1: 'subscribed' }),
      http.post('/api/discussion/mute', async ({ request }) => {
        muteCalls.push(await request.json());
        return HttpResponse.json({ ok: true, data: { rootPostId: 'p1' } });
      }),
    );

    const user = userEvent.setup();
    await renderPage(() => <SpaceThreadPage spaceId="s1" postId="p1" />, '/community/s1/posts/p1');

    const toggle = await screen.findByTestId('follow-toggle-p1');
    expect(toggle).toHaveTextContent(en.discussion.following);
    await user.click(toggle);

    await waitFor(() => expect(muteCalls).toEqual([{ rootPostId: 'p1' }]));
    expect(screen.getByTestId('follow-toggle-p1')).toHaveTextContent(en.discussion.mutedState);
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

    await user.click(await screen.findByTestId('space-composer-open'));
    await user.type(await screen.findByTestId('space-composer-input'), 'My new post');
    await user.click(screen.getByTestId('space-composer-submit'));

    await waitFor(() => expect(seenCalls).toEqual(['s1', 's1']));
  });

  it('keeps space seen failures silent on the feed page', async () => {
    let seenCalls = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', [feedItem({ id: 'p1', body: 'Visible post' })]),
      http.post('/api/spaces/:spaceId/seen', () => {
        seenCalls += 1;
        return HttpResponse.json(
          { ok: false, error: { code: 'internal', message: 'Write failed' } },
          { status: 500 },
        );
      }),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByText('Visible post')).toBeInTheDocument();
    await waitFor(() => expect(seenCalls).toBe(1));
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to mark space seen', expect.any(Error)));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('never marks the space seen while viewing as a member', async () => {
    const seenCalls: string[] = [];
    server.use(
      impersonatedMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', [feedItem({ id: 'p1', body: 'Hi' })]),
      okSeen(seenCalls),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByText('Hi')).toBeInTheDocument();
    expect(seenCalls).toEqual([]);
    expect(screen.queryByTestId('space-composer-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('space-composer-open')).not.toBeInTheDocument();
  });

  it('drops the composer card and the invitation from an empty feed viewed as a member', async () => {
    server.use(
      impersonatedMe(),
      noNotifications(),
      okSpaces([space({ id: 's1' })]),
      okFeed('s1', []),
      okSeen(),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('feed-empty-state')).toHaveTextContent(
      en.community.emptyFeedReadOnly,
    );
    expect(screen.queryByTestId(/^space-composer/u)).not.toBeInTheDocument();
    expect(screen.queryByText(en.community.emptyFeed)).not.toBeInTheDocument();
  });

  it('hides a gated space the member cannot access behind a not-found state', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'General' })]),
      forbiddenFeed(),
      okMemberNavigation([]),
    );

    await renderPage(() => <SpaceFeedPage spaceId="gated" />, '/community/gated');

    expect((await screen.findAllByText(en.community.spaceNotFoundTitle)).length).toBeGreaterThan(0);
    expect(screen.getByText(en.community.spaceNotFoundBody)).toBeInTheDocument();
    expect(screen.queryByTestId(/^space-composer/u)).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-post-p1')).not.toBeInTheDocument();
  });

  it('sells a gated space the member cannot access instead of a not-found dead end', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces([space({ id: 's1', name: 'General' })]),
      forbiddenFeed(),
      okMemberNavigation([
        { id: 'gated', slug: 'premium', name: 'Premium', description: 'Only for students.', productIds: ['p1'] },
      ]),
    );

    await renderPage(() => <SpaceFeedPage spaceId="gated" />, '/community/gated');

    expect(await screen.findByTestId('locked-space-view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Premium' })).toBeInTheDocument();
    expect(screen.getByTestId('locked-space-cta-gated')).toHaveAttribute('href', '/checkout/p1');
    expect(screen.queryByText(en.community.spaceNotFoundTitle)).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-breadcrumbs')).not.toBeInTheDocument();
  });

  it('serves an anonymous visitor a read-only feed pointing at the offer and no composer', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicFeed('s1', [feedItem({ id: 'p1', body: 'Public post https://courses.example.org/guide.', replyCount: 2 })]),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('public-feed-post-p1')).toHaveTextContent('Public post');
    const body = screen.getByTestId('public-post-body-p1');
    expect(body).toHaveStyle({ marginTop: '0.75rem' });
    expect(within(body).getByRole('link')).toHaveAttribute('href', 'https://courses.example.org/guide');
    expect(within(body).getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(within(body).getByRole('link')).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId('public-open-thread-p1')).toHaveAttribute(
      'href',
      '/community/s1/posts/p1',
    );
    expect(screen.getByTestId('anon-read-only')).toHaveTextContent(en.anon.readOnlyBanner);
    const cta = screen.getByTestId('anon-join-cta');
    expect(cta).toHaveAttribute('href', '/#offer');
    expect(cta).toHaveTextContent(en.anon.joinOfferCta);
    expect(cta).toHaveStyle({ width: '100%', minHeight: '44px' });
    expect(screen.queryByTestId(/^space-composer/u)).not.toBeInTheDocument();
    expect(screen.queryByTestId('space-follow-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reaction-p1-👍')).not.toBeInTheDocument();
  });

  it('sends a guest to the plain home page when the space is not the visitors start space', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(publicNavigation({ defaultHomeSpaceId: null })),
      okPublicFeed('s1', []),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('anon-join-cta')).toHaveAttribute('href', '/');
  });

  it('renders the space description under the public heading', async () => {
    server.use(anonMe(), okPublicNavigation(), okPublicFeed('s1', []));

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('anon-space-description')).toHaveTextContent(
      'Camper conversations.',
    );
  });

  it('tells a guest the creator has published nothing instead of inviting a post', async () => {
    server.use(anonMe(), okPublicNavigation(), okPublicFeed('s1', []));

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('public-feed-empty-state')).toHaveTextContent(
      en.anon.emptyFeed,
    );
  });

  it('points an anonymous visitor at checkout for a product-gated space', async () => {
    server.use(anonMe(), okPublicNavigation());

    await renderPage(() => <SpaceFeedPage spaceId="gated" />, '/community/gated');

    expect(await screen.findByTestId('anon-space-unlock')).toHaveAttribute('href', '/checkout/p1');
    expect(screen.queryByTestId(/^space-composer/u)).not.toBeInTheDocument();
  });

  it('renders an anonymous thread read-only with its replies', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicThread([
        {
          ...feedItem({ id: 'p1', body: 'Public thread' }),
          replies: [{ ...feedItem({ id: 'r1', body: 'Reply' }), replies: [], replyCount: 0 }],
          replyCount: 1,
        },
      ]),
    );

    await renderPage(
      () => <SpaceThreadPage spaceId="s1" postId="p1" />,
      '/community/s1/posts/p1',
    );

    expect(await screen.findByTestId('public-post-p1')).toHaveTextContent('Public thread');
    expect(screen.getByTestId('public-reply-r1')).toHaveTextContent('Reply');
    expect(screen.getByTestId('anon-join-cta')).toHaveAttribute('href', '/#offer');
    expect(screen.queryByTestId('reply-composer-input')).not.toBeInTheDocument();
  });

  it('settles an anonymous visitor inside the shell without refetching the identity in a loop', async () => {
    const counter = { calls: 0 };
    server.use(
      countedAnonMe(counter),
      okOffer(),
      okPublicNavigation(),
      okPublicFeed('s1', [feedItem({ id: 'p1', body: 'Public post' })]),
    );

    await renderShellPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('public-feed-post-p1')).toHaveTextContent('Public post');
    expect(screen.getByTestId('anon-read-only')).toHaveTextContent(en.anon.readOnlyBanner);

    const settledCalls = counter.calls;
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    expect(counter.calls).toBe(settledCalls);
  });
});
