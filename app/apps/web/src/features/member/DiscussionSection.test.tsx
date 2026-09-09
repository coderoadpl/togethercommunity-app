import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createPostInputSchema, type DiscussionPost, type PublicPost } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
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
  authorDisplay: 'Olivia Author',
  authorIsStaff: false,
  authorAvatarUrl: null,
  body: 'Post body',
  createdAt: '2026-07-15T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  ...input,
  bodyFormat: input.bodyFormat ?? 'plain',
  bodyHtml: input.bodyHtml ?? input.body ?? 'Post body',
  bodyPlainText: input.bodyPlainText ?? input.body ?? 'Post body',
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
        name: 'John Participant',
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
  it('labels moderator tombstones and keeps their replies readable without write actions', async () => {
    server.use(okMe('owner'), okDiscussion([asThread(post({ id: 'deleted', deletedAt: '2026-07-15T09:00:00.000Z', deletedBy: 'moderator' }), [asThread(post({ id: 'reply', parentPostId: 'deleted', rootPostId: 'deleted' }))])]));
    renderWithProviders(<DiscussionSection lessonId="l1" />);
    expect(await screen.findByTestId('deleted-post-deleted')).toHaveTextContent(en.discussion.moderatorDeletedPost);
    expect(screen.getByTestId('post-body-reply')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-button-deleted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-button-deleted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-post-deleted')).not.toBeInTheDocument();
  });

  it('spaces post bodies and safely links URLs in roots and replies', async () => {
    const body = '<img src=x onerror=alert(1)> Read https://courses.example.org/guide?a=1&b=2.\njavascript:alert(1)';
    const bodyHtml = `&lt;img src=x onerror=alert(1)&gt; Read <a href="https://courses.example.org/guide?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow ugc">https://courses.example.org/guide?a=1&amp;b=2</a>.<br>javascript:alert(1)`;
    server.use(okMe(), okDiscussion([
      asThread(post({ id: 'root', body, bodyHtml }), [
        asThread(post({ id: 'reply', body: 'See www.courses.example.org/notes.', bodyHtml: `See <a href="https://www.courses.example.org/notes" target="_blank" rel="noopener noreferrer nofollow ugc">www.courses.example.org/notes</a>.`, parentPostId: 'root', rootPostId: 'root' })),
      ]),
    ]));
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    const root = await screen.findByTestId('post-body-root');
    expect(root.textContent).toBe(body.replace('\n', ''));
    expect(root.querySelector('br')).not.toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root).toHaveStyle({ marginTop: '0.75rem', whiteSpace: 'pre-wrap' });
    expect(within(root).getAllByRole('link')).toHaveLength(1);
    const link = within(root).getByRole('link');
    expect(link).toHaveAttribute('href', 'https://courses.example.org/guide?a=1&b=2');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(link).toHaveStyle({ textDecoration: 'underline' });
    const reply = screen.getByTestId('post-body-reply');
    expect(reply).toHaveStyle({ marginTop: '0.75rem' });
    expect(within(reply).getByRole('link')).toHaveAttribute('href', 'https://www.courses.example.org/notes');
  });

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
    expect(error).toHaveTextContent(en.discussion.errorTitle);
    expect(error).toHaveTextContent(en.discussion.errorBody);
    await userEvent.setup().click(within(error).getByRole('button', { name: en.discussion.retry }));

    expect(await screen.findByTestId('discussion-empty')).toHaveTextContent(en.discussion.empty);
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
      en.discussion.lockedNote,
    );
    expect(screen.queryByTestId(/^discussion-composer/u)).not.toBeInTheDocument();
    expect(screen.queryByTestId('discussion-search-input')).not.toBeInTheDocument();
  });

  it('shows the composer and empty state when the discussion is accessible', async () => {
    server.use(okMe(), okDiscussion([]));

    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('discussion-composer-input')).toHaveAttribute('placeholder', en.discussion.composerPlaceholder);
    expect(screen.getByTestId('discussion-composer-submit')).toBeDisabled();
    expect(screen.getByTestId('discussion-empty')).toHaveTextContent(en.discussion.empty);
  });

  it('keeps the lesson input and send button visible before focus and after blur', async () => {
    server.use(okMe(), okDiscussion([]));

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    await user.click(await screen.findByTestId('discussion-composer-input'));

    expect(await screen.findByTestId('discussion-composer-submit')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-composer-input')).toHaveFocus();

    await user.tab();

    expect(await screen.findByTestId('discussion-composer-input')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-composer-submit')).toBeDisabled();
  });

  it('leaves no empty composer card and no invitation to write while viewing as a member', async () => {
    server.use(impersonatedMe(), okDiscussion([]));

    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('discussion-empty')).toHaveTextContent(
      en.discussion.emptyReadOnly,
    );
    expect(screen.queryByTestId('discussion-composer-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('discussion-composer')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('discussion-section').querySelectorAll('.MuiPaper-root'),
    ).toHaveLength(0);
  });

  it('disables the post write actions while viewing as a member', async () => {
    server.use(
      impersonatedMe(),
      okDiscussion([asThread(post({ id: 'r1', isOwn: true, body: 'My post' }))]),
    );

    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('reply-button-r1')).toBeDisabled();
    expect(screen.getByTestId('edit-button-r1')).toBeDisabled();
    expect(screen.getByTestId('delete-button-r1')).toBeDisabled();
  });

  it('renders three nesting levels with indentation, author chip and deleted placeholder', async () => {
    const level3 = asThread(
      post({ id: 'c2', parentPostId: 'c1', rootPostId: 'r1', body: 'Third level' }),
    );
    const level2 = asThread(
      post({ id: 'c1', parentPostId: 'r1', rootPostId: 'r1', body: 'Second level' }),
      [level3],
    );
    const deleted = asThread(
      post({
        id: 'c3',
        parentPostId: 'r1',
        rootPostId: 'r1',
        body: 'Deleted post body',
        deletedAt: '2026-07-15T09:00:00.000Z',
      }),
    );
    const root = asThread(
      post({
        id: 'r1',
        body: 'First level',
        authorIsStaff: true,
        authorDisplay: 'Martha Creator',
        authorAvatarUrl: 'https://cdn.test/martha.png',
      }),
      [level2, deleted],
    );
    server.use(okMe(), okDiscussion([root]));

    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('post-body-r1')).toHaveTextContent('First level');
    expect(screen.getByTestId('author-chip-r1')).toHaveTextContent(en.discussion.authorChip);
    expect(screen.queryByTestId('author-chip-c1')).not.toBeInTheDocument();

    const level2Container = within(screen.getByTestId('replies-of-r1'));
    expect(level2Container.getByTestId('post-body-c1')).toHaveTextContent('Second level');
    const level3Container = within(screen.getByTestId('replies-of-c1'));
    expect(level3Container.getByTestId('post-body-c2')).toHaveTextContent('Third level');

    expect(screen.getByTestId('deleted-post-c3')).toHaveTextContent(en.discussion.deletedPost);

    expect(screen.getByTestId('reply-button-r1')).toBeInTheDocument();
    expect(screen.getByTestId('reply-button-c1')).toBeInTheDocument();
    expect(screen.getByTestId('reply-button-c2')).toBeInTheDocument();
    expect(screen.getByTestId('reply-button-r1')).not.toHaveStyle({ padding: '0px' });
    expect(screen.getByTestId('start-message-r1')).not.toHaveStyle({ padding: '0px' });

    expect(screen.getByTestId('reply-count-r1')).toHaveTextContent(
      en.discussion.replyCount({ count: 2 }),
    );

    const rootPost = within(screen.getByTestId('discussion-post-r1'));
    expect(rootPost.getAllByTestId('user-avatar-image')[0]).toHaveAttribute(
      'src',
      'https://cdn.test/martha.png',
    );
    expect(level2Container.queryByTestId('user-avatar-image')).toBeNull();
    expect(level2Container.getAllByTestId('user-avatar')[0]).toHaveTextContent('OA');
  });

  it('collapses replies deeper than five levels behind a continue-thread link with a re-rooted subthread', async () => {
    const bodies: unknown[] = [];
    const chain = (id: string, parentPostId: string, body: string, replies: DiscussionPost[] = []) =>
      asThread(post({ id, parentPostId, rootPostId: 'r1', body }), replies);
    const c7 = chain('c7', 'c6', 'Seventh level');
    const c6 = chain('c6', 'c5', 'Sixth level', [c7]);
    const c5 = chain('c5', 'c4', 'Fifth level', [c6]);
    const c4 = chain('c4', 'c3', 'Fourth level', [c5]);
    const c3 = chain('c3', 'c2', 'Third level', [c4]);
    const c2 = chain('c2', 'r1', 'Second level', [c3]);
    const root = asThread(post({ id: 'r1', body: 'First level' }), [c2]);
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

    expect(await screen.findByTestId('post-body-c5')).toHaveTextContent('Fifth level');
    expect(screen.queryByTestId('post-body-c6')).not.toBeInTheDocument();
    const continueLink = screen.getByTestId('continue-thread-c5');
    expect(continueLink).toHaveTextContent(en.discussion.continueThread);

    await user.click(continueLink);

    expect(screen.getByTestId('back-to-discussion')).toHaveTextContent(
      en.discussion.backToDiscussion,
    );
    expect(screen.getByTestId('discussion-subthread-c5')).toBeInTheDocument();
    expect(screen.getByTestId('post-body-c6')).toHaveTextContent('Sixth level');
    expect(screen.getByTestId('post-body-c7')).toHaveTextContent('Seventh level');
    expect(screen.queryByTestId('post-body-r1')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('reply-button-c7'));
    await user.type(screen.getByTestId('reply-composer-c7-input'), 'Deeper reply');
    await user.click(screen.getByTestId('reply-composer-c7-submit'));

    await waitFor(() =>
      expect(bodies).toEqual([
        { contextKind: 'lesson', contextId: 'l1', parentPostId: 'c7', body: 'Deeper reply', bodyFormat: 'plain' },
      ]),
    );

    await user.click(screen.getByTestId('back-to-discussion'));
    expect(await screen.findByTestId('post-body-r1')).toHaveTextContent('First level');
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
    const root = asThread(post({ id: 'r1', body: 'Question about the engine' }));
    const reply = asThread(
      post({ id: 'n1', parentPostId: 'r1', rootPostId: 'r1', body: 'My reply', isOwn: true, authorDisplay: 'John Participant' }),
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
    await user.type(screen.getByTestId('reply-composer-r1-input'), 'My reply');
    const readsBefore = discussionReads;
    await user.click(screen.getByTestId('reply-composer-r1-submit'));

    expect(await screen.findByTestId('pending-post')).toHaveTextContent('My reply');
    releasePost?.(undefined);

    expect(await screen.findByTestId('post-body-n1')).toHaveTextContent('My reply');
    expect(screen.queryByTestId('pending-post')).not.toBeInTheDocument();
    expect(bodies).toEqual([
      { contextKind: 'lesson', contextId: 'l1', parentPostId: 'r1', body: 'My reply', bodyFormat: 'plain' },
    ]);
    expect(discussionReads).toBeGreaterThan(readsBefore);
  });

  it('toggles thread follow and mute with a clear state', async () => {
    const muteCalls: unknown[] = [];
    const subscribeCalls: unknown[] = [];
    const followed = asThread(post({ id: 'r1', body: 'Followed thread' }));
    const fresh = asThread(post({ id: 'r2', rootPostId: 'r2', body: 'New thread' }));
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
    expect(followedToggle).toHaveTextContent(en.discussion.following);
    expect(followedToggle).toHaveAttribute('aria-pressed', 'true');

    const freshToggle = screen.getByTestId('follow-toggle-r2');
    expect(freshToggle).toHaveTextContent(en.discussion.follow);
    expect(freshToggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(followedToggle);
    await waitFor(() => expect(muteCalls).toEqual([{ rootPostId: 'r1' }]));
    expect(screen.getByTestId('follow-toggle-r1')).toHaveTextContent(en.discussion.mutedState);

    await user.click(freshToggle);
    await waitFor(() => expect(subscribeCalls).toEqual([{ rootPostId: 'r2' }]));
    expect(screen.getByTestId('follow-toggle-r2')).toHaveTextContent(en.discussion.following);
  });

  it('lets staff delete any post after a confirmation dialog', async () => {
    const deletedIds: string[] = [];
    let removed = false;
    const root = asThread(post({ id: 'r1', body: 'Needs moderation', isOwn: false }));
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
    expect(await screen.findByText(en.discussion.deleteConfirmTitle)).toBeInTheDocument();

    await user.click(screen.getByTestId('confirm-delete-post'));

    await waitFor(() => expect(deletedIds).toEqual(['r1']));
    expect(await screen.findByTestId('deleted-post-r1')).toHaveTextContent(
      en.discussion.deletedPost,
    );
  });

  it('searches within this lesson and highlights matches', async () => {
    const requestedUrls: string[] = [];
    const root = asThread(post({ id: 'r1', body: 'Base thread' }));
    server.use(
      okMe(),
      okDiscussion([root]),
      http.get('/api/posts/search', ({ request }) => {
        requestedUrls.push(request.url);
        return HttpResponse.json({
          ok: true,
          data: {
            hits: [
              { post: post({ id: 'h1', body: 'The engine runs full throttle' }), lessonId: 'l1', snippet: 'The engine runs full throttle' },
            ],
          },
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection lessonId="l1" />);

    expect(await screen.findByTestId('discussion-search-hint')).toHaveTextContent(
      en.discussion.searchHint,
    );
    await user.type(await screen.findByTestId('discussion-search-input'), 'engine');

    const hit = await screen.findByTestId('search-hit-h1');
    expect(hit).toHaveTextContent('The engine runs full throttle');
    expect(within(hit).getByText('engine').tagName).toBe('MARK');

    const url = new URL(requestedUrls[requestedUrls.length - 1] ?? '');
    expect(url.searchParams.get('query')).toBe('engine');
    expect(url.searchParams.getAll('lessonId')).toEqual(['l1']);
  });
});
