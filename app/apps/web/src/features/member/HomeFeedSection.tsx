import { useState } from 'react';
import { Box, Button, Chip, Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { communityPostPath, communitySpacePath } from '#core/contract/index.js';
import type { MemberHomeFeedItem } from '#core/domain/index.js';

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
import { MemberAvatar } from '../../components/ui/MemberAvatar.js';
import { FeedPostMenu } from './FeedPostMenu.js';
import { ReactionBar } from './ReactionBar.js';

const PAGE_SIZE = 10;

const HomeFeedCard = ({ item }: { item: MemberHomeFeedItem }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const deleted = item.deletedAt !== null;
  return (
    <DiscussionThread sx={{ p: '1rem 1.25rem' }} data-testid={`home-feed-post-${item.id}`}>
      <Stack useFlexGap sx={{ rowGap: '0.6rem' }}>
        <Stack
          direction="row"
          useFlexGap
          sx={{ alignItems: 'center', columnGap: '0.6rem', flexWrap: 'wrap' }}
        >
          <MemberAvatar name={item.authorDisplay} avatarUrl={item.authorAvatarUrl} size="sm" />
          <PostAuthorName component="span">{item.authorDisplay}</PostAuthorName>
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
          <DeletedPostText variant="body2" component="p" data-testid={`home-feed-deleted-${item.id}`}>
            {t.discussion.deletedPost}
          </DeletedPostText>
        ) : (
          <PostBody variant="body1" component="p" data-testid={`home-feed-body-${item.id}`}>
            {item.body}
          </PostBody>
        )}

        <ReactionBar postId={item.id} reactions={item.reactions} testIdPrefix="home-feed-reaction" />

        <Stack
          direction="row"
          useFlexGap
          sx={{
            alignItems: 'baseline',
            columnGap: '0.75rem',
            rowGap: '0.25rem',
            flexWrap: 'wrap',
          }}
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
          <FeedPostMenu
            postId={item.id}
            postPath={communityPostPath(item.spaceId, item.id)}
            canContactAuthor={!item.isOwn && !deleted}
          />
        </Stack>
      </Stack>
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
