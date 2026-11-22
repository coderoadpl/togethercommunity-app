import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createPostInputSchema, updatePostInputSchema, type DiscussionPost, type PublicPost } from '#core/domain/index.js';
import type { ReactNode } from 'react';

import { en } from '../../i18n/en.js';
import { stylesAt } from '../../lib/stylesheet.js';
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

const renderInRouter = async (node: ReactNode) => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const okSearch = (hits: { post: PublicPost; lessonId: string; snippet: string }[], requestedUrls: string[] = []) =>
  http.get('/api/posts/search', ({ request }) => {
    requestedUrls.push(request.url);
    return HttpResponse.json({ ok: true, data: { hits } });
  });

describe('DiscussionSection', () => {
  it('labels moderator tombstones and keeps their replies readable without write actions', async () => {
    server.use(okMe('owner'), okDiscussion([asThread(post({ id: 'deleted', deletedAt: '2026-07-15T09:00:00.000Z', deletedBy: 'moderator' }), [asThread(post({ id: 'reply', parentPostId: 'deleted', rootPostId: 'deleted' }))])]));
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);
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
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

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

    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

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

    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('discussion-locked-note')).toHaveTextContent(
      en.discussion.lockedNote,
    );
    expect(screen.queryByTestId(/^discussion-composer/u)).not.toBeInTheDocument();
    expect(screen.queryByTestId('discussion-search-input')).not.toBeInTheDocument();
  });

  it('shows the composer and empty state when the discussion is accessible', async () => {
    server.use(okMe(), okDiscussion([]));

    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    expect((await screen.findByTestId('discussion-composer-input')).querySelector('p'))
      .toHaveAttribute('data-placeholder', en.discussion.composerPlaceholder);
    expect(screen.getByTestId('discussion-composer-submit')).toBeDisabled();
    expect(screen.getByTestId('discussion-empty')).toHaveTextContent(en.discussion.empty);
  });

  it('saves a plain thread edit as plain text', async () => {
    const root = asThread(post({ id: 'r1', isOwn: true, body: '# Original', bodyFormat: 'plain' }));
    let submittedFormat: string | undefined;
    server.use(
      okMe(),
      okDiscussion([root]),
      http.post('/api/posts/update', async ({ request }) => {
        const input = updatePostInputSchema.parse(await request.json());
        submittedFormat = input.bodyFormat;
        return HttpResponse.json({
          ok: true,
          data: {
            post: {
              ...root,
              body: input.body,
              bodyHtml: input.body,
              bodyPlainText: input.body,
              editedAt: '2026-10-02T10:00:00.000Z',
            },
          },
        });
      }),
    );
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await userEvent.click(await screen.findByTestId('edit-button-r1'));
    const input = screen.getByTestId('edit-composer-r1-input');
    expect(input).toHaveValue('# Original');
    await userEvent.clear(input);
    await userEvent.type(input, '# Changed');
    await userEvent.click(screen.getByTestId('edit-composer-r1-submit'));

    await waitFor(() => expect(submittedFormat).toBe('plain'));
  });

  it('keeps the lesson input and send button visible before focus and after blur', async () => {
    server.use(okMe(), okDiscussion([]));

    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.click(await screen.findByTestId('discussion-composer-input'));

    expect(await screen.findByTestId('discussion-composer-submit')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-composer-input')).toHaveFocus();

    await user.tab();

    expect(await screen.findByTestId('discussion-composer-input')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-composer-submit')).toBeDisabled();
  });

  it('leaves no empty composer card and no invitation to write while viewing as a member', async () => {
    server.use(impersonatedMe(), okDiscussion([]));

    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

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

    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('reply-button-r1')).toBeDisabled();
    expect(screen.getByTestId('edit-button-r1')).toBeDisabled();
    expect(screen.getByTestId('delete-button-r1')).toBeDisabled();
  });

  it('renders three nesting levels with indentation and author chip, without a childless deleted reply', async () => {
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

    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('post-body-r1')).toHaveTextContent('First level');
    expect(screen.getByTestId('author-chip-r1')).toHaveTextContent(en.discussion.authorChip);
    expect(screen.queryByTestId('author-chip-c1')).not.toBeInTheDocument();

    const level2Container = within(screen.getByTestId('replies-of-r1'));
    expect(level2Container.getByTestId('post-body-c1')).toHaveTextContent('Second level');
    const level3Container = within(screen.getByTestId('replies-of-c1'));
    expect(level3Container.getByTestId('post-body-c2')).toHaveTextContent('Third level');

    expect(screen.queryByTestId('deleted-post-c3')).not.toBeInTheDocument();

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
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

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
        { contextKind: 'lesson', contextId: 'l1', parentPostId: 'c7', body: 'Deeper reply', bodyFormat: 'markdown' },
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
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.click(await screen.findByTestId('reply-button-r1'));
    await user.type(screen.getByTestId('reply-composer-r1-input'), 'My reply');
    const readsBefore = discussionReads;
    await user.click(screen.getByTestId('reply-composer-r1-submit'));

    expect(await screen.findByTestId('pending-post')).toHaveTextContent('My reply');
    releasePost?.(undefined);

    expect(await screen.findByTestId('post-body-n1')).toHaveTextContent('My reply');
    expect(screen.queryByTestId('pending-post')).not.toBeInTheDocument();
    expect(bodies).toEqual([
      { contextKind: 'lesson', contextId: 'l1', parentPostId: 'r1', body: 'My reply', bodyFormat: 'markdown' },
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
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

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
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.click(await screen.findByTestId('delete-button-r1'));
    expect(await screen.findByText(en.discussion.deleteConfirmTitle)).toBeInTheDocument();

    await user.click(screen.getByTestId('confirm-delete-post'));

    await waitFor(() => expect(deletedIds).toEqual(['r1']));
    expect(await screen.findByTestId('deleted-post-r1')).toHaveTextContent(
      en.discussion.deletedPost,
    );
  });

  it('shows a failed reply inside the reply composer and clears it on cancel', async () => {
    server.use(
      okMe(),
      okDiscussion([asThread(post({ id: 'r1', body: 'Question' })), asThread(post({ id: 'r2', body: 'Other question' }))]),
      http.post('/api/posts', () =>
        HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Slow down' } }, { status: 429 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.click(await screen.findByTestId('reply-button-r1'));
    await user.type(screen.getByTestId('reply-composer-r1-input'), 'My reply');
    await user.click(screen.getByTestId('reply-composer-r1-submit'));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(en.community.postTooFast);
    expect(screen.getByTestId('reply-composer-r1')).toContainElement(error);
    expect(screen.getByTestId('discussion-composer')).not.toContainElement(error);
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    await user.click(within(screen.getByTestId('reply-composer-r1')).getByRole('button', { name: en.common.cancel }));
    await user.click(screen.getByTestId('reply-button-r1'));
    expect(screen.queryByTestId('reply-composer-r1-error')).not.toBeInTheDocument();
  });

  it('shows a failed edit inside the edit composer of that post', async () => {
    server.use(
      okMe(),
      okDiscussion([asThread(post({ id: 'r1', isOwn: true, body: 'Original', bodyFormat: 'plain' }))]),
      http.post('/api/posts/update', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Write failed' } }, { status: 500 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.click(await screen.findByTestId('edit-button-r1'));
    await user.type(screen.getByTestId('edit-composer-r1-input'), ' changed');
    await user.click(screen.getByTestId('edit-composer-r1-submit'));

    const error = await screen.findByTestId('edit-composer-r1-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('edit-composer-r1')).toContainElement(error);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows a failed new thread inside the main composer', async () => {
    server.use(
      okMe(),
      okDiscussion([asThread(post({ id: 'r1', body: 'Question' }))]),
      http.post('/api/posts', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Write failed' } }, { status: 500 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.type(await screen.findByTestId('discussion-composer-input'), 'New thread');
    await user.click(screen.getByTestId('discussion-composer-submit'));

    const error = await screen.findByTestId('discussion-composer-error');
    expect(screen.getByTestId('discussion-composer')).toContainElement(error);
    expect(screen.queryByTestId('reply-composer-r1-error')).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('drops a failed reply or edit once another Reply or Edit closes its composer', async () => {
    server.use(
      okMe(),
      okDiscussion([
        asThread(post({ id: 'r1', isOwn: true, body: 'Own question', bodyFormat: 'plain' })),
        asThread(post({ id: 'r2', body: 'Other question' })),
      ]),
      http.post('/api/posts', () =>
        HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Slow down' } }, { status: 429 })),
      http.post('/api/posts/update', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Write failed' } }, { status: 500 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.click(await screen.findByTestId('reply-button-r1'));
    await user.type(screen.getByTestId('reply-composer-r1-input'), 'My reply');
    await user.click(screen.getByTestId('reply-composer-r1-submit'));
    expect(await screen.findByTestId('reply-composer-r1-error')).toBeInTheDocument();

    await user.click(screen.getByTestId('reply-button-r2'));
    await user.click(screen.getByTestId('reply-button-r1'));
    expect(screen.getByTestId('reply-composer-r1')).toBeInTheDocument();
    expect(screen.queryByTestId('reply-composer-r1-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('edit-button-r1'));
    await user.type(screen.getByTestId('edit-composer-r1-input'), ' changed');
    await user.click(screen.getByTestId('edit-composer-r1-submit'));
    expect(await screen.findByTestId('edit-composer-r1-error')).toBeInTheDocument();

    await user.click(screen.getByTestId('reply-button-r1'));
    await user.click(screen.getByTestId('edit-button-r1'));
    expect(screen.getByTestId('edit-composer-r1')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-composer-r1-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a reply that fails after the member switched composers in the discussion alert', async () => {
    let releasePost: ((value: undefined) => void) | undefined;
    const postResponse = new Promise<undefined>((resolve) => {
      releasePost = resolve;
    });
    server.use(
      okMe(),
      okDiscussion([asThread(post({ id: 'r1', body: 'Question' })), asThread(post({ id: 'r2', body: 'Other question' }))]),
      http.post('/api/posts', async () => {
        await postResponse;
        return HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Slow down' } }, { status: 429 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.click(await screen.findByTestId('reply-button-r1'));
    await user.type(screen.getByTestId('reply-composer-r1-input'), 'My reply');
    await user.click(screen.getByTestId('reply-composer-r1-submit'));
    await screen.findByTestId('pending-post');

    await user.click(screen.getByTestId('reply-button-r2'));
    expect(screen.queryByTestId('reply-composer-r1')).not.toBeInTheDocument();
    releasePost?.(undefined);

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(en.community.postTooFast);
    expect(screen.getByTestId('reply-composer-r2')).not.toContainElement(error);
    expect(screen.getByTestId('discussion-composer')).not.toContainElement(error);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('hides a childless deleted reply from members and counts only the replies on screen', async () => {
    const deletedAt = '2026-07-15T09:00:00.000Z';
    server.use(okMe(), okDiscussion([{
      ...asThread(post({ id: 'r1', body: 'Question' }), [
        asThread(post({ id: 'gone', rootPostId: 'r1', parentPostId: 'r1', deletedAt })),
        asThread(post({ id: 'kept', rootPostId: 'r1', parentPostId: 'r1', deletedAt }), [
          asThread(post({ id: 'live', rootPostId: 'r1', parentPostId: 'kept', body: 'Still here' })),
        ]),
      ]),
      replyCount: 1,
    }]));
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('post-body-live')).toHaveTextContent('Still here');
    expect(screen.queryByTestId('deleted-post-gone')).not.toBeInTheDocument();
    expect(screen.getByTestId('deleted-post-kept')).toBeInTheDocument();
    expect(screen.getByTestId('reply-count-r1')).toHaveTextContent(en.discussion.replyCount({ count: 2 }));
  });

  it('keeps Reply in the row and moves Message author and Report into a menu below sm', async () => {
    server.use(okMe(), okDiscussion([asThread(post({ id: 'r1', body: 'Question' }))]));
    const user = userEvent.setup();
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    const reply = await screen.findByTestId('reply-button-r1');
    const inline = screen.getByTestId('post-contact-actions-r1');
    const menuButton = screen.getByTestId('post-contact-menu-r1');
    expect(stylesAt(reply, 375).display).not.toBe('none');
    expect(stylesAt(inline, 375)).toMatchObject({ display: 'none' });
    expect(stylesAt(inline, 900)).toMatchObject({ display: 'contents' });
    expect(stylesAt(menuButton.parentElement, 375)).toMatchObject({ display: 'inline-flex' });
    expect(stylesAt(menuButton.parentElement, 900)).toMatchObject({ display: 'none' });
    expect(within(inline).getByTestId('start-message-r1')).toHaveTextContent(en.messages.messageAuthor);
    expect(within(inline).getByRole('button', { name: en.community.report })).toBeInTheDocument();

    await user.click(menuButton);
    expect(screen.getByTestId('menu-start-message-r1')).toHaveTextContent(en.messages.messageAuthor);
    await user.click(screen.getByTestId('menu-report-post-r1'));
    expect(await screen.findByText(en.community.reportTitle)).toBeInTheDocument();
  });

  it('gives the follow toggle an outlined button with a bell icon', async () => {
    server.use(okMe(), okDiscussion([asThread(post({ id: 'r1', body: 'Question' }))], { r1: 'subscribed' }));
    renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);

    const toggle = await screen.findByTestId('follow-toggle-r1');
    expect(toggle).toHaveClass('MuiButton-outlined');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(toggle).getByTestId('follow-icon-active')).toBeInTheDocument();
  });

  it('searches within this lesson, highlights matches and links each hit to its thread', async () => {
    const requestedUrls: string[] = [];
    const root = asThread(post({ id: 'r1', body: 'Base thread' }));
    server.use(
      okMe(),
      okDiscussion([root]),
      okSearch([
        { post: post({ id: 'h1', rootPostId: 'r1', parentPostId: 'r1', body: 'The engine runs full throttle' }), lessonId: 'l1', snippet: 'The engine runs full throttle' },
      ], requestedUrls),
    );

    const user = userEvent.setup();
    await renderInRouter(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.type(await screen.findByTestId('discussion-search-input'), 'engine');

    const hit = await screen.findByTestId('search-hit-h1');
    expect(hit).toHaveTextContent('The engine runs full throttle');
    expect(within(hit).getByText('engine').tagName).toBe('MARK');
    const link = within(hit).getByRole('link', { name: 'Olivia Author The engine runs full throttle' });
    expect(link).toHaveAttribute('href', '/my/courses/course-1/lessons/l1?thread=r1');
    expect(within(link).getByText('engine').tagName).toBe('MARK');
    expect(within(link).getByTestId('search-hit-chevron')).toBeInTheDocument();
    expect(within(hit).getAllByRole('link')).toHaveLength(1);
    expect(within(link).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('discussion-search-hint')).not.toBeInTheDocument();

    const url = new URL(requestedUrls[requestedUrls.length - 1] ?? '');
    expect(url.searchParams.get('query')).toBe('engine');
    expect(url.searchParams.getAll('lessonId')).toEqual(['l1']);
  });

  it('keeps the edition in a search hit link on an older edition', async () => {
    server.use(
      okMe(),
      okDiscussion([]),
      okSearch([{ post: post({ id: 'h1', rootPostId: 'r7', body: 'Engine notes' }), lessonId: 'l1', snippet: 'Engine notes' }]),
    );
    const user = userEvent.setup();
    await renderInRouter(<DiscussionSection courseId="course-1" lessonId="l1" editionNumber="2" />);

    await user.type(await screen.findByTestId('discussion-search-input'), 'engine');

    const link = await screen.findByTestId('search-hit-link-h1');
    expect(link).toHaveAttribute('href', '/my/courses/course-1/lessons/l1/editions/2?thread=r7');
    expect(link).toHaveAccessibleName('Olivia Author Engine notes');
  });

  it('names two hits by one author apart by their snippets', async () => {
    server.use(
      okMe(),
      okDiscussion([]),
      okSearch([
        { post: post({ id: 'h1', rootPostId: 'r1', body: 'Engine notes' }), lessonId: 'l1', snippet: 'Engine notes' },
        { post: post({ id: 'h2', rootPostId: 'r2', body: 'Engine questions' }), lessonId: 'l1', snippet: 'Engine questions' },
      ]),
    );
    const user = userEvent.setup();
    await renderInRouter(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.type(await screen.findByTestId('discussion-search-input'), 'engine');

    expect(await screen.findByRole('link', { name: 'Olivia Author Engine notes' })).toHaveAttribute('href', '/my/courses/course-1/lessons/l1?thread=r1');
    expect(screen.getByRole('link', { name: 'Olivia Author Engine questions' })).toHaveAttribute('href', '/my/courses/course-1/lessons/l1?thread=r2');
  });

  it('shows the search hint only with an empty result', async () => {
    server.use(okMe(), okDiscussion([]), okSearch([]));
    const user = userEvent.setup();
    await renderInRouter(<DiscussionSection courseId="course-1" lessonId="l1" />);

    await user.type(await screen.findByTestId('discussion-search-input'), 'xyz');
    expect(screen.queryByTestId('discussion-search-hint')).not.toBeInTheDocument();

    const empty = await screen.findByTestId('discussion-search-empty');
    expect(within(empty).getByTestId('discussion-search-hint')).toHaveTextContent(`${en.discussion.searchHint} ${en.search.stemHint}`);
  });

  it('places the search field below the composer and above the thread list', async () => {
    server.use(okMe(), okDiscussion([asThread(post({ id: 'r1', body: 'Base thread' }))]));
    await renderInRouter(<DiscussionSection courseId="course-1" lessonId="l1" />);

    const thread = await screen.findByTestId('discussion-thread-r1');
    const search = screen.getByTestId('discussion-search-input');
    const composer = screen.getByTestId('discussion-composer');
    expect(composer.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(search.compareDocumentPosition(thread)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

it.each(['owner', null] as const)('shows tombstone menus on roots and replies only to staff: %s', async (role) => {
  const deletedAt = '2026-07-15T09:00:00.000Z';
  server.use(okMe(role), okDiscussion([asThread(post({ id: 'root', deletedAt }), [
    asThread(post({ id: 'reply', rootPostId: 'root', parentPostId: 'root', deletedAt })),
  ])]));
  renderWithProviders(<DiscussionSection courseId="course-1" lessonId="l1" />);
  await screen.findByTestId('deleted-post-root');
  if (role === null) {
    expect(screen.queryByTestId('post-menu-root')).not.toBeInTheDocument();
    expect(screen.queryByTestId('deleted-post-reply')).not.toBeInTheDocument();
    expect(screen.getByTestId('reply-count-root')).toHaveTextContent(en.discussion.replyCount({ count: 0 }));
  } else {
    expect(screen.getByTestId('deleted-post-reply')).toBeInTheDocument();
    expect(screen.getByTestId('reply-count-root')).toHaveTextContent(en.discussion.replyCount({ count: 1 }));
    expect(screen.getByTestId('post-menu-root')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('post-menu-reply'));
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('purge-button-reply'));
    expect(await screen.findByText(en.discussion.purgeConfirmBody)).toBeInTheDocument();
  }
});
