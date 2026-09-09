import { useState } from 'react';
import { Alert, Box, Button, Chip, Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { communityPostPath, communitySpacePath } from '#core/contract/index.js';
import type { MemberHomeFeedItem } from '#core/domain/index.js';

import { translateDeletedContent } from '../../i18n/deleted-content.js';
import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatRelativeTime } from '../../lib/format.js';
import {
  AuthorChip,
  DeletedPostText,
  DiscussionThread,
  PostAuthorName,
  PostBody,
  PostMetaText,
} from '../../theme.js';
import { LinkifiedText } from '../../components/ui/LinkifiedText.js';
import { UserAvatar } from '../../components/ui/UserAvatar.js';
import { FeedPostMenu } from './FeedPostMenu.js';
import { DeletePostDialog } from './DeletePostDialog.js';
import { PostComposer } from './ThreadDiscussion.js';
import { usePostMutations } from './usePostMutations.js';
import { useCanOpenStudio, useImpersonation } from './viewer.js';
import { ReactionBar } from './ReactionBar.js';

const PAGE_SIZE = 10;

const HomeFeedCard = ({ item }: { item: MemberHomeFeedItem }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const deleted = item.deletedAt !== null;
  const canModerate = useCanOpenStudio();
  const impersonating = useImpersonation() !== null;
  const me = useQuery(actions.me);
  const writeDisabled = impersonating || (me.data?.tenant?.banned ?? false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { update, remove } = usePostMutations();
  const mutationError = update.error ?? remove.error;
  return (
    <DiscussionThread sx={{ p: '1rem 1.25rem' }} data-testid={`home-feed-post-${item.id}`}>
      <Stack useFlexGap sx={{ rowGap: '0.6rem' }}>
        <Box>
          <Stack
            direction="row"
            useFlexGap
            sx={{
              alignItems: 'center',
              columnGap: '0.6rem',
              rowGap: '0.375rem',
              flexWrap: 'wrap',
            }}
          >
            <UserAvatar name={translateDeletedContent(item.authorDisplay, t)} imageUrl={item.authorAvatarUrl} size="sm" />
            <PostAuthorName component="span">{translateDeletedContent(item.authorDisplay, t)}</PostAuthorName>
            {item.authorIsStaff && (
              <AuthorChip data-testid={`home-feed-author-chip-${item.id}`}>
                {t.discussion.authorChip}
              </AuthorChip>
            )}
            <Chip
              size="small"
              variant="outlined"
              clickable
              component={Link}
              to={communitySpacePath(item.spaceId)}
              label={item.spaceName}
              data-testid={`home-feed-space-${item.id}`}
            />
            <PostMetaText component="time" dateTime={item.createdAt}>
              {formatRelativeTime(item.createdAt, language)}
            </PostMetaText>
          </Stack>

          {deleted ? (
            <DeletedPostText variant="body2" component="p" sx={{ mt: '0.75rem' }} data-testid={`home-feed-deleted-${item.id}`}>
              {item.deletedBy === 'moderator' ? t.discussion.moderatorDeletedPost : t.discussion.deletedPost}
            </DeletedPostText>
          ) : editing ? (
            <PostComposer
              label={t.discussion.editLabel}
              submitLabel={t.common.save}
              pendingLabel={t.discussion.saving}
              initialValue={item.body}
              focusOnMount
              busy={update.isPending}
              disabled={writeDisabled}
              onSubmit={(body) => update.mutate({ id: item.id, body }, { onSuccess: () => setEditing(false) })}
              onCancel={() => setEditing(false)}
              testId={`edit-composer-${item.id}`}
            />
          ) : (
            <PostBody variant="body1" component="p" sx={{ mt: '0.75rem' }} data-testid={`home-feed-body-${item.id}`}>
              <LinkifiedText text={item.body} />
            </PostBody>
          )}
        </Box>

        {!deleted && <ReactionBar postId={item.id} reactions={item.reactions} testIdPrefix="home-feed-reaction" />}

        <Stack
          direction="row"
          useFlexGap
          sx={{ alignItems: 'center', columnGap: '0.75rem', minWidth: 0 }}
        >
          <PostMetaText component="span" data-testid={`home-feed-reply-count-${item.id}`}>
            {t.discussion.replyCount({ count: item.replyCount })}
          </PostMetaText>
          <MuiLink
            component={Link}
            to={communityPostPath(item.spaceId, item.id)}
            data-testid={`home-feed-open-${item.id}`}
          >
            {t.community.openThread}
          </MuiLink>
          <Box sx={{ ml: 'auto', flexShrink: 0 }}>
            <FeedPostMenu
              postId={item.id}
              postPath={communityPostPath(item.spaceId, item.id)}
              canContactAuthor={!item.isOwn && !deleted}
              canEdit={item.isOwn && !deleted}
              canDelete={(item.isOwn || canModerate) && !deleted}
              writeDisabled={writeDisabled}
              onEdit={() => setEditing(true)}
              onDelete={() => setDeleting(true)}
            />
          </Box>
        </Stack>
        {mutationError !== null ? <Alert severity="error">{localizeError(mutationError, t)}</Alert> : null}
      </Stack>
      {deleting ? (
        <DeletePostDialog
          pending={remove.isPending}
          onClose={() => setDeleting(false)}
          onConfirm={() => remove.mutate({ id: item.id }, { onSuccess: () => setDeleting(false) })}
        />
      ) : null}
    </DiscussionThread>
  );
};

export const HomeFeedSection = () => {
  const t = useTranslations();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const feed = useQuery({
    ...actions.memberHomeFeed({ limit }),
    placeholderData: (previous) => previous,
  });

  const items = feed.data?.feed.items ?? [];

  return (
    <Box component="section" data-testid="start-feed">
      <Typography variant="h3" component="h2" sx={{ mb: '0.9rem' }}>
        {t.start.feedSection}
      </Typography>
      {feed.isPending ? (
        <StatusView surface={false} state={{ kind: 'loading', label: t.common.loading }} />
      ) : feed.isError ? (
        <StatusView
          surface={false}
          state={{
            kind: 'error',
            message: localizeError(feed.error, t),
            retry: { label: t.common.retry, onRetry: () => void feed.refetch() },
          }}
        />
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="start-feed-empty">
          {t.start.feedEmpty}
        </Typography>
      ) : (
        <Stack useFlexGap sx={{ rowGap: '1rem' }}>
          {items.map((item) => (
            <HomeFeedCard key={item.id} item={item} />
          ))}
          {feed.data.feed.nextCursor === null ? null : (
            <Box>
              <Button
                variant="outlined"
                data-testid="start-feed-load-more"
                disabled={feed.isFetching}
                onClick={() => setLimit((previous) => previous + PAGE_SIZE)}
              >
                {t.discussion.loadMore}
              </Button>
            </Box>
          )}
        </Stack>
      )}
    </Box>
  );
};
