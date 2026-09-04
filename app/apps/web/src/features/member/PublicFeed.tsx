import { Chip, Link as MuiLink, Stack } from '@mui/material';
import { Link } from '@tanstack/react-router';

import { communityPostPath } from '#core/contract/index.js';
import type { DiscussionPost, ReactionSummary, SpaceFeed, SpaceFeedItem } from '#core/domain/index.js';

import { StatusView } from '../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatRelativeTime } from '../../lib/format.js';
import {
  AuthorChip,
  DeletedPostText,
  DiscussionThread,
  PostAuthorName,
  PostBody,
  PostMetaText,
} from '../../theme.js';
import { EmptyFeedIcon } from './community-icons.js';

const PublicReactions = ({ reactions }: { reactions: ReactionSummary[] }) => {
  const counted = reactions.filter((reaction) => reaction.count > 0);
  if (counted.length === 0) return null;
  return (
    <Stack direction="row" useFlexGap sx={{ columnGap: '0.5rem', flexWrap: 'wrap' }}>
      {counted.map((reaction) => (
        <Chip
          key={reaction.emoji}
          size="small"
          variant="outlined"
          label={`${reaction.emoji} ${String(reaction.count)}`}
          data-testid={`public-reaction-${reaction.emoji}`}
        />
      ))}
    </Stack>
  );
};

const PostHeader = ({ post }: { post: DiscussionPost | SpaceFeedItem }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ alignItems: 'baseline', columnGap: '0.6rem', flexWrap: 'wrap' }}
    >
      <PostAuthorName component="span">{post.authorDisplay}</PostAuthorName>
      {post.authorIsStaff && (
        <AuthorChip data-testid={`public-author-chip-${post.id}`}>
          {t.discussion.authorChip}
        </AuthorChip>
      )}
      {post.pinnedAt !== null ? (
        <Chip
          size="small"
          label={post.authorIsStaff ? t.community.announcementChip : t.community.pinnedChip}
        />
      ) : null}
      <PostMetaText component="time" dateTime={post.createdAt}>
        {formatRelativeTime(post.createdAt, language)}
      </PostMetaText>
    </Stack>
  );
};

const PostText = ({ post }: { post: DiscussionPost | SpaceFeedItem }) => {
  const t = useTranslations();
  return post.deletedAt === null ? (
    <PostBody variant="body1" component="p" data-testid={`public-post-body-${post.id}`}>
      {post.body}
    </PostBody>
  ) : (
    <DeletedPostText variant="body2" component="p" data-testid={`public-deleted-post-${post.id}`}>
      {t.discussion.deletedPost}
    </DeletedPostText>
  );
};

const PublicFeedPost = ({ spaceId, item }: { spaceId: string; item: SpaceFeedItem }) => {
  const t = useTranslations();
  return (
    <DiscussionThread sx={{ p: '1rem 1.25rem' }} data-testid={`public-feed-post-${item.id}`}>
      <Stack useFlexGap sx={{ rowGap: '0.6rem' }}>
        <PostHeader post={item} />
        <PostText post={item} />
        <PublicReactions reactions={item.reactions} />
        <Stack
          direction="row"
          useFlexGap
          sx={{ alignItems: 'center', columnGap: '1rem', flexWrap: 'wrap' }}
        >
          <PostMetaText component="span" data-testid={`public-reply-count-${item.id}`}>
            {t.discussion.replyCount({ count: item.replyCount })}
          </PostMetaText>
          <MuiLink
            component={Link}
            to={communityPostPath(spaceId, item.id)}
            data-testid={`public-open-thread-${item.id}`}
          >
            {t.community.openThread}
          </MuiLink>
        </Stack>
      </Stack>
    </DiscussionThread>
  );
};

export const PublicFeedList = ({ spaceId, feed }: { spaceId: string; feed: SpaceFeed }) => {
  const t = useTranslations();
  if (feed.items.length === 0 && feed.pinned.length === 0) {
    return (
      <StatusView
        state={{ kind: 'empty', icon: <EmptyFeedIcon />, title: t.anon.emptyFeed }}
        data-testid="public-feed-empty-state"
      />
    );
  }
  return (
    <Stack useFlexGap sx={{ rowGap: '1rem' }}>
      {feed.pinned.length > 0 ? <Chip label={t.community.pinnedHeading} /> : null}
      {feed.pinned.map((item) => (
        <PublicFeedPost key={`pinned-${item.id}`} spaceId={spaceId} item={item} />
      ))}
      {feed.items.map((item) => (
        <PublicFeedPost key={item.id} spaceId={spaceId} item={item} />
      ))}
    </Stack>
  );
};

const PublicReply = ({ post, depth }: { post: DiscussionPost; depth: number }) => (
  <Stack useFlexGap sx={{ rowGap: '0.6rem', pl: depth === 0 ? 0 : '1.25rem' }}>
    <DiscussionThread sx={{ p: '0.85rem 1.1rem' }} data-testid={`public-reply-${post.id}`}>
      <Stack useFlexGap sx={{ rowGap: '0.5rem' }}>
        <PostHeader post={post} />
        <PostText post={post} />
      </Stack>
    </DiscussionThread>
    {post.replies.map((reply) => (
      <PublicReply key={reply.id} post={reply} depth={depth + 1} />
    ))}
  </Stack>
);

export const PublicThreadView = ({ root }: { root: DiscussionPost }) => (
  <Stack useFlexGap sx={{ rowGap: '1rem' }} data-testid="public-thread">
    <DiscussionThread sx={{ p: '1rem 1.25rem' }} data-testid={`public-post-${root.id}`}>
      <Stack useFlexGap sx={{ rowGap: '0.6rem' }}>
        <PostHeader post={root} />
        <PostText post={root} />
      </Stack>
    </DiscussionThread>
    {root.replies.map((reply) => (
      <PublicReply key={reply.id} post={reply} depth={0} />
    ))}
  </Stack>
);
