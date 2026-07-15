import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import type { DiscussionPost, ThreadSubscriptionState } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { useDebouncedValue } from '../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatRelativeTime } from '../../lib/format.js';
import {
  AuthorChip,
  CardTitle,
  DeletedPostText,
  DiscussionHitSnippet,
  DiscussionThread,
  Eyebrow,
  NotificationDot,
  PendingPostBox,
  PostAuthorName,
  PostBody,
  PostMetaText,
  ReplyIndent,
} from '../../theme.js';
import { Highlighted } from './highlight.js';

const PAGE_SIZE = 20;
const MAX_INDENT = 5;
const MIN_SEARCH_LENGTH = 2;

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

interface Viewer {
  userId: string;
  name: string;
  canModerate: boolean;
}

const PostComposer = ({
  label,
  placeholder,
  submitLabel,
  pendingLabel,
  initialValue = '',
  focusOnMount = false,
  busy,
  onSubmit,
  onCancel,
  testId,
}: {
  label: string;
  placeholder?: string;
  submitLabel: string;
  pendingLabel: string;
  initialValue?: string;
  focusOnMount?: boolean;
  busy: boolean;
  onSubmit: (body: string, reset: () => void) => void;
  onCancel?: () => void;
  testId: string;
}) => {
  const t = useTranslations();
  const [body, setBody] = useState(initialValue);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed, () => setBody(''));
  };

  return (
    <Stack component="form" useFlexGap spacing="0.75rem" onSubmit={handleSubmit} data-testid={testId}>
      <TextField
        label={label}
        placeholder={placeholder}
        multiline
        minRows={3}
        value={body}
        inputRef={inputRef}
        onChange={(event) => setBody(event.target.value)}
        slotProps={{ htmlInput: { 'data-testid': `${testId}-input` } }}
      />
      <Stack direction="row" useFlexGap sx={{ columnGap: '0.75rem' }}>
        <Button
          type="submit"
          variant="contained"
          disabled={busy || body.trim().length === 0}
          data-testid={`${testId}-submit`}
        >
          {busy ? pendingLabel : submitLabel}
        </Button>
        {onCancel !== undefined && (
          <Button variant="text" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        )}
      </Stack>
    </Stack>
  );
};

interface ThreadActions {
  viewer: Viewer | null;
  language: string;
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  submitReply: (parent: DiscussionPost, body: string, reset: () => void) => void;
  submitEdit: (post: DiscussionPost, body: string, reset: () => void) => void;
  requestDelete: (post: DiscussionPost) => void;
  openSubthread: (id: string) => void;
  replyBusy: boolean;
  editBusy: boolean;
  pendingReply: { parentId: string; author: string; body: string } | null;
}

const PendingPostView = ({ author, body }: { author: string; body: string }) => (
  <PendingPostBox data-testid="pending-post">
    <PostAuthorName component="span">{author}</PostAuthorName>
    <PostBody variant="body1" component="p">
      {body}
    </PostBody>
  </PendingPostBox>
);

const PostView = ({ post, depth, actions: a }: { post: DiscussionPost; depth: number; actions: ThreadActions }) => {
  const t = useTranslations();
  const deleted = post.deletedAt !== null;
  const own = a.viewer !== null && a.viewer.userId === post.authorUserId;
  const canReply = a.viewer !== null && !deleted;
  const canEdit = own && !deleted;
  const canDelete = (own || (a.viewer?.canModerate ?? false)) && !deleted;

  return (
    <Box data-testid={`discussion-post-${post.id}`}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '0.6rem', flexWrap: 'wrap' }}>
        <PostAuthorName component="span">{post.authorDisplay}</PostAuthorName>
        {post.authorIsStaff && (
          <AuthorChip data-testid={`author-chip-${post.id}`}>{t.discussion.authorChip}</AuthorChip>
        )}
        <PostMetaText component="time" dateTime={post.createdAt}>
          {formatRelativeTime(post.createdAt, a.language)}
        </PostMetaText>
        {post.editedAt !== null && !deleted && (
          <PostMetaText component="span">{t.discussion.edited}</PostMetaText>
        )}
      </Stack>

      {deleted ? (
        <DeletedPostText variant="body2" component="p" data-testid={`deleted-post-${post.id}`}>
          {t.discussion.deletedPost}
        </DeletedPostText>
      ) : a.editingId === post.id ? (
        <Box sx={{ mt: '0.5rem' }}>
          <PostComposer
            label={t.discussion.editLabel}
            submitLabel={t.common.save}
            pendingLabel={t.discussion.saving}
            initialValue={post.body}
            focusOnMount
            busy={a.editBusy}
            onSubmit={(body, reset) => a.submitEdit(post, body, reset)}
            onCancel={() => a.setEditingId(null)}
            testId={`edit-composer-${post.id}`}
          />
        </Box>
      ) : (
        <PostBody variant="body1" component="p" data-testid={`post-body-${post.id}`}>
          {post.body}
        </PostBody>
      )}

      {(canReply || canEdit || canDelete) && (
        <Stack direction="row" useFlexGap sx={{ columnGap: '0.75rem', mt: '0.25rem' }}>
          {canReply && (
            <Button
              size="small"
              variant="text"
              data-testid={`reply-button-${post.id}`}
              onClick={() => {
                a.setEditingId(null);
                a.setReplyingTo(post.id);
              }}
            >
              {t.discussion.reply}
            </Button>
          )}
          {canEdit && (
            <Button
              size="small"
              variant="text"
              data-testid={`edit-button-${post.id}`}
              onClick={() => {
                a.setReplyingTo(null);
                a.setEditingId(post.id);
              }}
            >
              {t.discussion.edit}
            </Button>
          )}
          {canDelete && (
            <Button
              size="small"
              variant="text"
              data-testid={`delete-button-${post.id}`}
              onClick={() => a.requestDelete(post)}
            >
              {t.discussion.delete}
            </Button>
          )}
        </Stack>
      )}

      {a.replyingTo === post.id && (
        <Box sx={{ mt: '0.75rem' }}>
          <PostComposer
            label={t.discussion.replyLabel}
            submitLabel={t.discussion.send}
            pendingLabel={t.discussion.sending}
            focusOnMount
            busy={a.replyBusy}
            onSubmit={(body, reset) => a.submitReply(post, body, reset)}
            onCancel={() => a.setReplyingTo(null)}
            testId={`reply-composer-${post.id}`}
          />
        </Box>
      )}

      {depth < MAX_INDENT ? (
        (post.replies.length > 0 || a.pendingReply?.parentId === post.id) && (
          <ReplyIndent data-testid={`replies-of-${post.id}`} sx={{ mt: '0.75rem' }}>
            <Stack useFlexGap sx={{ rowGap: '1rem' }}>
              {post.replies.map((reply) => (
                <PostView key={reply.id} post={reply} depth={depth + 1} actions={a} />
              ))}
              {a.pendingReply?.parentId === post.id && (
                <PendingPostView author={a.pendingReply.author} body={a.pendingReply.body} />
              )}
            </Stack>
          </ReplyIndent>
        )
      ) : (
        <>
          {a.pendingReply?.parentId === post.id && (
            <ReplyIndent sx={{ mt: '0.75rem' }}>
              <PendingPostView author={a.pendingReply.author} body={a.pendingReply.body} />
            </ReplyIndent>
          )}
          {post.replies.length > 0 && (
            <Box sx={{ mt: '0.5rem' }}>
              <Button
                size="small"
                variant="text"
                data-testid={`continue-thread-${post.id}`}
                onClick={() => a.openSubthread(post.id)}
              >
                {t.discussion.continueThread}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

const threadsContain = (threads: DiscussionPost[], id: string | undefined): boolean =>
  id !== undefined &&
  threads.some((post) => post.id === id || threadsContain(post.replies, id));

const findPost = (threads: DiscussionPost[], id: string): DiscussionPost | null => {
  for (const candidate of threads) {
    if (candidate.id === id) return candidate;
    const nested = findPost(candidate.replies, id);
    if (nested !== null) return nested;
  }
  return null;
};

const LessonDiscussionSearch = ({ lessonId }: { lessonId: string }) => {
  const t = useTranslations();
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term).trim();
  const enabled = debounced.length >= MIN_SEARCH_LENGTH;
  const search = useQuery({
    ...actions.postsSearch({ query: debounced, lessonIds: [lessonId] }),
    enabled,
  });

  return (
    <Stack useFlexGap sx={{ rowGap: '0.75rem' }}>
      <TextField
        type="search"
        size="small"
        label={t.discussion.searchLabel}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        slotProps={{ htmlInput: { 'data-testid': 'discussion-search-input' } }}
      />
      {enabled && (
        <Box data-testid="discussion-search-results">
          {search.isPending ? (
            <Typography variant="body2">{t.discussion.searching}</Typography>
          ) : search.isError ? (
            <Alert>{localizeError(search.error, t)}</Alert>
          ) : search.data.hits.length === 0 ? (
            <Typography variant="body2" data-testid="discussion-search-empty">
              {t.discussion.searchEmpty}
            </Typography>
          ) : (
            <Stack useFlexGap sx={{ rowGap: '0.5rem' }}>
              {search.data.hits.map((hit) => (
                <DiscussionThread key={hit.post.id} sx={{ p: '0.6rem 0.9rem' }} data-testid={`search-hit-${hit.post.id}`}>
                  <PostAuthorName component="span">{hit.post.authorDisplay}</PostAuthorName>
                  <DiscussionHitSnippet variant="body2" component="p">
                    <Highlighted text={hit.snippet} query={debounced} />
                  </DiscussionHitSnippet>
                </DiscussionThread>
              ))}
            </Stack>
          )}
        </Box>
      )}
    </Stack>
  );
};

export const DiscussionSection = ({ lessonId }: { lessonId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const headingId = useId();

  const me = useQuery(actions.me);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const discussion = useQuery({
    ...actions.discussion({ contextKind: 'lesson', contextId: lessonId, limit }),
    placeholderData: (previous) => previous,
  });

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DiscussionPost | null>(null);
  const [subthreadRootId, setSubthreadRootId] = useState<string | null>(null);
  const [subOverride, setSubOverride] = useState<Record<string, ThreadSubscriptionState>>({});

  const invalidate = () => queryClient.invalidateQueries(actions.discussionInvalidates());
  const create = useMutation({ ...actions.createPost, onSettled: invalidate });
  const update = useMutation({ ...actions.updatePost, onSettled: invalidate });
  const remove = useMutation({ ...actions.deletePost, onSettled: invalidate });
  const subscribe = useMutation({ ...actions.subscribeThread, onSettled: invalidate });
  const mute = useMutation({ ...actions.muteThread, onSettled: invalidate });

  const viewer: Viewer | null =
    me.data === undefined
      ? null
      : {
          userId: me.data.userId,
          name: me.data.name,
          canModerate: me.data.tenant !== null && me.data.tenant.staffRole !== null,
        };

  const threads = discussion.data?.discussion.threads ?? [];
  const viewerSubscriptions = discussion.data?.discussion.viewerSubscriptions ?? {};
  const subthreadRoot = subthreadRootId === null ? null : findPost(threads, subthreadRootId);

  const optimisticVariables =
    create.variables !== undefined &&
    !create.isIdle &&
    !create.isError &&
    !threadsContain(threads, create.data?.post.id)
      ? create.variables
      : undefined;

  const pendingReply =
    optimisticVariables?.parentPostId !== undefined && viewer !== null
      ? { parentId: optimisticVariables.parentPostId, author: viewer.name, body: optimisticVariables.body }
      : null;

  const pendingThread =
    optimisticVariables !== undefined && optimisticVariables.parentPostId === undefined && viewer !== null
      ? { author: viewer.name, body: optimisticVariables.body }
      : null;

  const subscriptionStateFor = (rootPostId: string): ThreadSubscriptionState | 'none' =>
    subOverride[rootPostId] ?? viewerSubscriptions[rootPostId] ?? 'none';

  const clearOverride = (rootPostId: string) =>
    setSubOverride((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => key !== rootPostId)),
    );

  const toggleSubscription = (rootPostId: string) => {
    const current = subscriptionStateFor(rootPostId);
    if (current === 'subscribed') {
      setSubOverride((previous) => ({ ...previous, [rootPostId]: 'muted' }));
      mute.mutate({ rootPostId }, { onError: () => clearOverride(rootPostId) });
    } else {
      setSubOverride((previous) => ({ ...previous, [rootPostId]: 'subscribed' }));
      subscribe.mutate({ rootPostId }, { onError: () => clearOverride(rootPostId) });
    }
  };

  const threadActions: ThreadActions = {
    viewer,
    language,
    replyingTo,
    setReplyingTo,
    editingId,
    setEditingId,
    submitReply: (parent, body, reset) => {
      create.mutate(
        { contextKind: 'lesson', contextId: lessonId, parentPostId: parent.id, body },
        {
          onSuccess: () => {
            reset();
            setReplyingTo(null);
          },
        },
      );
    },
    submitEdit: (post, body, reset) => {
      update.mutate(
        { id: post.id, body },
        {
          onSuccess: () => {
            reset();
            setEditingId(null);
          },
        },
      );
    },
    requestDelete: setDeleting,
    openSubthread: setSubthreadRootId,
    replyBusy: create.isPending,
    editBusy: update.isPending,
    pendingReply,
  };

  const forbidden = isForbidden(discussion.error);
  const mutationError = [create, update, remove].find((mutation) => mutation.isError)?.error ?? null;

  return (
    <Box component="section" aria-labelledby={headingId} data-testid="discussion-section" sx={{ mt: '2.5rem' }}>
      <Stack useFlexGap sx={{ rowGap: '0.25rem', mb: '1rem' }}>
        <CardTitle variant="h2" id={headingId}>
          {t.discussion.heading}
        </CardTitle>
        <Eyebrow variant="overline" component="p">
          {t.discussion.eyebrow}
        </Eyebrow>
      </Stack>

      {forbidden ? (
        <Paper elevation={1} sx={{ p: '1.5rem' }} data-testid="discussion-locked-note">
          <Typography variant="body1">{t.discussion.lockedNote}</Typography>
        </Paper>
      ) : discussion.isPending ? (
        <Typography variant="body2">{t.discussion.loading}</Typography>
      ) : discussion.isError ? (
        <Alert>{localizeError(discussion.error, t)}</Alert>
      ) : subthreadRoot !== null ? (
        <Stack useFlexGap sx={{ rowGap: '1rem' }}>
          <Box>
            <Button
              variant="text"
              data-testid="back-to-discussion"
              onClick={() => setSubthreadRootId(null)}
            >
              {t.discussion.backToDiscussion}
            </Button>
          </Box>
          {mutationError !== null && <Alert>{localizeError(mutationError, t)}</Alert>}
          <DiscussionThread
            sx={{ p: '1rem 1.25rem' }}
            data-testid={`discussion-subthread-${subthreadRoot.id}`}
          >
            <PostView post={subthreadRoot} depth={1} actions={threadActions} />
          </DiscussionThread>
        </Stack>
      ) : (
        <Stack useFlexGap sx={{ rowGap: '1.5rem' }}>
          <LessonDiscussionSearch lessonId={lessonId} />

          {viewer !== null && (
            <Paper elevation={1} sx={{ p: '1.25rem' }}>
              <PostComposer
                label={t.discussion.composerLabel}
                placeholder={t.discussion.composerPlaceholder}
                submitLabel={t.discussion.post}
                pendingLabel={t.discussion.posting}
                busy={create.isPending}
                onSubmit={(body, reset) => {
                  create.mutate(
                    { contextKind: 'lesson', contextId: lessonId, body },
                    { onSuccess: () => reset() },
                  );
                }}
                testId="discussion-composer"
              />
            </Paper>
          )}

          {mutationError !== null && <Alert>{localizeError(mutationError, t)}</Alert>}

          {threads.length === 0 && pendingThread === null ? (
            <Typography variant="body1" data-testid="discussion-empty">
              {t.discussion.empty}
            </Typography>
          ) : (
            <Stack useFlexGap sx={{ rowGap: '1rem' }}>
              {threads.map((thread) => {
                const state = subscriptionStateFor(thread.rootPostId);
                return (
                  <DiscussionThread key={thread.id} sx={{ p: '1rem 1.25rem' }} data-testid={`discussion-thread-${thread.id}`}>
                    <Stack useFlexGap sx={{ rowGap: '0.5rem' }}>
                      <PostView post={thread} depth={1} actions={threadActions} />
                      <Stack
                        direction="row"
                        useFlexGap
                        sx={{ alignItems: 'center', columnGap: '1rem', flexWrap: 'wrap' }}
                      >
                        <PostMetaText component="span" data-testid={`reply-count-${thread.id}`}>
                          {t.discussion.replyCount({ count: thread.replyCount })}
                        </PostMetaText>
                        {viewer !== null && (
                          <Button
                            size="small"
                            variant="text"
                            aria-pressed={state === 'subscribed'}
                            data-testid={`follow-toggle-${thread.rootPostId}`}
                            onClick={() => toggleSubscription(thread.rootPostId)}
                            startIcon={<NotificationDot active={state === 'subscribed'} aria-hidden />}
                          >
                            {state === 'subscribed'
                              ? t.discussion.following
                              : state === 'muted'
                                ? t.discussion.mutedState
                                : t.discussion.follow}
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </DiscussionThread>
                );
              })}
              {pendingThread !== null && (
                <DiscussionThread sx={{ p: '1rem 1.25rem' }}>
                  <PendingPostView author={pendingThread.author} body={pendingThread.body} />
                </DiscussionThread>
              )}
            </Stack>
          )}

          {discussion.data.discussion.nextCursor !== null && (
            <Box>
              <Button
                variant="outlined"
                data-testid="discussion-load-more"
                disabled={discussion.isFetching}
                onClick={() => setLimit((previous) => previous + PAGE_SIZE)}
              >
                {t.discussion.loadMore}
              </Button>
            </Box>
          )}
        </Stack>
      )}

      {deleting !== null && (
        <Dialog open onClose={() => setDeleting(null)} aria-labelledby="post-delete-title">
          <DialogTitle id="post-delete-title">{t.discussion.deleteConfirmTitle}</DialogTitle>
          <DialogContent>
            <Typography variant="body1">{t.discussion.deleteConfirmBody}</Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={() => setDeleting(null)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="contained"
              data-testid="confirm-delete-post"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate({ id: deleting.id }, { onSuccess: () => setDeleting(null) })
              }
            >
              {remove.isPending ? t.discussion.deleting : t.discussion.deleteConfirm}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};
