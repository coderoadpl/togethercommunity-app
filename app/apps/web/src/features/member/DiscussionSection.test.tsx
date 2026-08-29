import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createPostInputSchema, type DiscussionPost, type PublicPost } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DiscussionSection } from './DiscussionSection.js';

const post = (input: Partial<PublicPost> & { id: string }): PublicPost => ({
  tenantId: 't1',
  contextKind: 'lesson',
  contextId: 'l1',
  parentPostId: null,
  rootPostId: input.id,
  isOwn: false,
  authorDisplay: 'Ola Autorka',
  authorIsStaff: false,
  authorAvatarUrl: null,
  body: 'Treść wpisu',
  createdAt: '2026-07-15T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  ...input,
});

const asThread = (root: PublicPost, replies: DiscussionPost[] = []): DiscussionPost => ({
  ...root,
  replyCount: replies.length,
  replies,
});

const okMe = (staffRole: 'owner' | null = null) =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'user@example.com',
        emailVerified: true,
        name: 'Jan Uczestnik',
        tenant: {
          id: 't1',
          slug: 'acme',
          name: 'Acme',
          staffRole,
          memberId: staffRole === null ? 'm1' : null,
          banned: false,
        },
      },
    }),
  );

const okDiscussion = (
  threads: DiscussionPost[],
  viewerSubscriptions: Record<string, 'subscribed' | 'muted'> = {},
  nextCursor: string | null = null,
) =>
  http.get('/api/discussion', () =>
    HttpResponse.json({
      ok: true,
      data: { discussion: { threads, nextCursor, viewerSubscriptions } },
    }),
  );

describe('DiscussionSection', () => {
  it('shows a discussion-specific error and retries the failed request', async () => {
    let reads = 0;
    server.use(
      okMe(),
      http.get('/api/discussion', () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json(
              { ok: false, error: { code: 'internal', message: 'Internal error' } },
              { status: 500 },
            )
          : HttpResponse.json({
              ok: true,
              data: { discussion: { threads: [], nextCursor: null, viewerSubscriptions: {} } },
            });
      }),
    );

    renderWithProviders(<DiscussionSection lessonId="l1" />);

    const error = await screen.findByTestId('discussion-error');
    expect(error).toHaveTextContent(pl.discussion.errorTitle);
    expect(error).toHaveTextContent(pl.discussion.errorBody);
    await userEvent.setup().click(within(error).getByRole('button', { name: pl.discussion.retry }));

    expect(await screen.findByTestId('discussion-empty')).toHaveTextContent(pl.discussion.empty);
    expect(reads).toBe(2);
  });

  it('hides the composer behind a friendly note when the lesson discussion is not accessible', async () => {
    server.use(
      okMe(),
      http.get('/api/discussion', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'forbidden', message: 'This lesson is not accessible' } },
          { status: 403 },
        ),
      ),
    );

    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('discussion-locked-note')).toHaveTextContent(
      pl.discussion.lockedNote,
    );
    expect(screen.queryByTestId('discussion-composer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('discussion-search-input')).not.toBeInTheDocument();
  });

  it('shows the composer and empty state when the discussion is accessible', async () => {
    server.use(okMe(), okDiscussion([]));

    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('discussion-composer-input')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-empty')).toHaveTextContent(pl.discussion.empty);
  });

  it('keeps the lesson composer collapsed until it takes focus', async () => {
    server.use(okMe(), okDiscussion([]));

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    const input = await screen.findByTestId('discussion-composer-input');
    expect(screen.queryByTestId('discussion-composer-submit')).not.toBeInTheDocument();

    await user.click(input);

    expect(await screen.findByTestId('discussion-composer-submit')).toBeInTheDocument();
  });

  it('renders three nesting levels with indentation, author chip and deleted placeholder', async () => {
    const level3 = asThread(
      post({ id: 'c2', parentPostId: 'c1', rootPostId: 'r1', body: 'Trzeci poziom' }),
    );
    const level2 = asThread(
      post({ id: 'c1', parentPostId: 'r1', rootPostId: 'r1', body: 'Drugi poziom' }),
      [level3],
    );
    const deleted = asThread(
      post({
        id: 'c3',
        parentPostId: 'r1',
        rootPostId: 'r1',
        body: 'Wpis usunięty',
        deletedAt: '2026-07-15T09:00:00.000Z',
      }),
    );
    const root = asThread(
      post({
        id: 'r1',
        body: 'Pierwszy poziom',
        authorIsStaff: true,
        authorDisplay: 'Marta Twórczyni',
        authorAvatarUrl: 'https://cdn.test/marta.png',
      }),
      [level2, deleted],
    );
    server.use(okMe(), okDiscussion([root]));

    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('post-body-r1')).toHaveTextContent('Pierwszy poziom');
    expect(screen.getByTestId('author-chip-r1')).toHaveTextContent(pl.discussion.authorChip);
    expect(screen.queryByTestId('author-chip-c1')).not.toBeInTheDocument();

    const level2Container = within(screen.getByTestId('replies-of-r1'));
    expect(level2Container.getByTestId('post-body-c1')).toHaveTextContent('Drugi poziom');
    const level3Container = within(screen.getByTestId('replies-of-c1'));
    expect(level3Container.getByTestId('post-body-c2')).toHaveTextContent('Trzeci poziom');

    expect(screen.getByTestId('deleted-post-c3')).toHaveTextContent(pl.discussion.deletedPost);

    expect(screen.getByTestId('reply-button-r1')).toBeInTheDocument();
    expect(screen.getByTestId('reply-button-c1')).toBeInTheDocument();
    expect(screen.getByTestId('reply-button-c2')).toBeInTheDocument();

    expect(screen.getByTestId('reply-count-r1')).toHaveTextContent(
      pl.discussion.replyCount({ count: 2 }),
    );

    const rootPost = within(screen.getByTestId('discussion-post-r1'));
    expect(rootPost.getAllByTestId('member-avatar-image')[0]).toHaveAttribute(
      'src',
      'https://cdn.test/marta.png',
    );
    expect(level2Container.queryByTestId('member-avatar-image')).toBeNull();
    expect(level2Container.getAllByTestId('member-avatar')[0]).toHaveTextContent('OA');
  });

  it('collapses replies deeper than five levels behind a continue-thread link with a re-rooted subthread', async () => {
    const bodies: unknown[] = [];
    const chain = (id: string, parentPostId: string, body: string, replies: DiscussionPost[] = []) =>
      asThread(post({ id, parentPostId, rootPostId: 'r1', body }), replies);
    const c7 = chain('c7', 'c6', 'Poziom siódmy');
    const c6 = chain('c6', 'c5', 'Poziom szósty', [c7]);
    const c5 = chain('c5', 'c4', 'Poziom piąty', [c6]);
    const c4 = chain('c4', 'c3', 'Poziom czwarty', [c5]);
    const c3 = chain('c3', 'c2', 'Poziom trzeci', [c4]);
    const c2 = chain('c2', 'r1', 'Poziom drugi', [c3]);
    const root = asThread(post({ id: 'r1', body: 'Poziom pierwszy' }), [c2]);
    server.use(
      okMe(),
      okDiscussion([root]),
      http.post('/api/posts', async ({ request }) => {
        const body = createPostInputSchema.parse(await request.json());
        bodies.push(body);
        return HttpResponse.json({
          ok: true,
          data: {
            post: post({ id: 'n1', parentPostId: 'c7', rootPostId: 'r1', body: body.body, isOwn: true }),
          },
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('post-body-c5')).toHaveTextContent('Poziom piąty');
    expect(screen.queryByTestId('post-body-c6')).not.toBeInTheDocument();
    const continueLink = screen.getByTestId('continue-thread-c5');
    expect(continueLink).toHaveTextContent(pl.discussion.continueThread);

    await user.click(continueLink);

    expect(screen.getByTestId('back-to-discussion')).toHaveTextContent(
      pl.discussion.backToDiscussion,
    );
    expect(screen.getByTestId('discussion-subthread-c5')).toBeInTheDocument();
    expect(screen.getByTestId('post-body-c6')).toHaveTextContent('Poziom szósty');
    expect(screen.getByTestId('post-body-c7')).toHaveTextContent('Poziom siódmy');
    expect(screen.queryByTestId('post-body-r1')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('reply-button-c7'));
    await user.type(screen.getByTestId('reply-composer-c7-input'), 'Głębsza odpowiedź');
    await user.click(screen.getByTestId('reply-composer-c7-submit'));

    await waitFor(() =>
      expect(bodies).toEqual([
        { contextKind: 'lesson', contextId: 'l1', parentPostId: 'c7', body: 'Głębsza odpowiedź' },
      ]),
    );

    await user.click(screen.getByTestId('back-to-discussion'));
    expect(await screen.findByTestId('post-body-r1')).toHaveTextContent('Poziom pierwszy');
    expect(screen.queryByTestId('post-body-c6')).not.toBeInTheDocument();
  });

  it('sends a reply optimistically and refetches the discussion', async () => {
    const bodies: unknown[] = [];
    let releasePost: ((value: undefined) => void) | undefined;
    const postResponse = new Promise<undefined>((resolve) => {
      releasePost = resolve;
    });
    let replied = false;
    let discussionReads = 0;
    const root = asThread(post({ id: 'r1', body: 'Pytanie o silnik' }));
    const reply = asThread(
      post({ id: 'n1', parentPostId: 'r1', rootPostId: 'r1', body: 'Moja odpowiedź', isOwn: true, authorDisplay: 'Jan Uczestnik' }),
    );
    server.use(
      okMe(),
      http.get('/api/discussion', () => {
        discussionReads += 1;
        return HttpResponse.json({
          ok: true,
          data: {
            discussion: {
              threads: [replied ? { ...root, replyCount: 1, replies: [reply] } : root],
              nextCursor: null,
              viewerSubscriptions: {},
            },
          },
        });
      }),
      http.post('/api/posts', async ({ request }) => {
        const body = createPostInputSchema.parse(await request.json());
        bodies.push(body);
        await postResponse;
        replied = true;
        return HttpResponse.json({ ok: true, data: { post: post({ id: 'n1', parentPostId: 'r1', rootPostId: 'r1', body: body.body, isOwn: true }) } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    await user.click(await screen.findByTestId('reply-button-r1'));
    await user.type(screen.getByTestId('reply-composer-r1-input'), 'Moja odpowiedź');
    const readsBefore = discussionReads;
    await user.click(screen.getByTestId('reply-composer-r1-submit'));

    expect(await screen.findByTestId('pending-post')).toHaveTextContent('Moja odpowiedź');
    releasePost?.(undefined);

    expect(await screen.findByTestId('post-body-n1')).toHaveTextContent('Moja odpowiedź');
    expect(screen.queryByTestId('pending-post')).not.toBeInTheDocument();
    expect(bodies).toEqual([
      { contextKind: 'lesson', contextId: 'l1', parentPostId: 'r1', body: 'Moja odpowiedź' },
    ]);
    expect(discussionReads).toBeGreaterThan(readsBefore);
  });

  it('toggles thread follow and mute with a clear state', async () => {
    const muteCalls: unknown[] = [];
    const subscribeCalls: unknown[] = [];
    const followed = asThread(post({ id: 'r1', body: 'Obserwowany wątek' }));
    const fresh = asThread(post({ id: 'r2', rootPostId: 'r2', body: 'Nowy wątek' }));
    server.use(
      okMe(),
      okDiscussion([followed, fresh], { r1: 'subscribed' }),
      http.post('/api/discussion/mute', async ({ request }) => {
        muteCalls.push(await request.json());
        return HttpResponse.json({ ok: true, data: { rootPostId: 'r1' } });
      }),
      http.post('/api/discussion/subscribe', async ({ request }) => {
        subscribeCalls.push(await request.json());
        return HttpResponse.json({ ok: true, data: { rootPostId: 'r2' } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    const followedToggle = await screen.findByTestId('follow-toggle-r1');
    expect(followedToggle).toHaveTextContent(pl.discussion.following);
    expect(followedToggle).toHaveAttribute('aria-pressed', 'true');

    const freshToggle = screen.getByTestId('follow-toggle-r2');
    expect(freshToggle).toHaveTextContent(pl.discussion.follow);
    expect(freshToggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(followedToggle);
    await waitFor(() => expect(muteCalls).toEqual([{ rootPostId: 'r1' }]));
    expect(screen.getByTestId('follow-toggle-r1')).toHaveTextContent(pl.discussion.mutedState);

    await user.click(freshToggle);
    await waitFor(() => expect(subscribeCalls).toEqual([{ rootPostId: 'r2' }]));
    expect(screen.getByTestId('follow-toggle-r2')).toHaveTextContent(pl.discussion.following);
  });

  it('lets staff delete any post after a confirmation dialog', async () => {
    const deletedIds: string[] = [];
    let removed = false;
    const root = asThread(post({ id: 'r1', body: 'Do moderacji', isOwn: false }));
    server.use(
      okMe('owner'),
      http.get('/api/discussion', () =>
        HttpResponse.json({
          ok: true,
          data: {
            discussion: {
              threads: [
                removed
                  ? { ...root, deletedAt: '2026-07-15T09:30:00.000Z', replyCount: 0, replies: [] }
                  : root,
              ],
              nextCursor: null,
              viewerSubscriptions: {},
            },
          },
        }),
      ),
      http.delete('/api/posts/:postId', ({ params }) => {
        deletedIds.push(String(params['postId']));
        removed = true;
        return HttpResponse.json({
          ok: true,
          data: { post: post({ id: 'r1', deletedAt: '2026-07-15T09:30:00.000Z' }) },
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    await user.click(await screen.findByTestId('delete-button-r1'));
    expect(await screen.findByText(pl.discussion.deleteConfirmTitle)).toBeInTheDocument();

    await user.click(screen.getByTestId('confirm-delete-post'));

    await waitFor(() => expect(deletedIds).toEqual(['r1']));
    expect(await screen.findByTestId('deleted-post-r1')).toHaveTextContent(
      pl.discussion.deletedPost,
    );
  });

  it('searches within this lesson and highlights matches', async () => {
    const requestedUrls: string[] = [];
    const root = asThread(post({ id: 'r1', body: 'Wątek bazowy' }));
    server.use(
      okMe(),
      okDiscussion([root]),
      http.get('/api/posts/search', ({ request }) => {
        requestedUrls.push(request.url);
        return HttpResponse.json({
          ok: true,
          data: {
            hits: [
              { post: post({ id: 'h1', body: 'Pali silnik do dechy' }), lessonId: 'l1', snippet: 'Pali silnik do dechy' },
            ],
          },
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('discussion-search-hint')).toHaveTextContent(
      pl.discussion.searchWholeWordsHint,
    );
    await user.type(await screen.findByTestId('discussion-search-input'), 'silnik');

    const hit = await screen.findByTestId('search-hit-h1');
    expect(hit).toHaveTextContent('Pali silnik do dechy');
    expect(within(hit).getByText('silnik').tagName).toBe('MARK');

    const url = new URL(requestedUrls[requestedUrls.length - 1] ?? '');
    expect(url.searchParams.get('query')).toBe('silnik');
    expect(url.searchParams.getAll('lessonId')).toEqual(['l1']);
  });
});
