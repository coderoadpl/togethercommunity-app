import { Box, Chip, Link as MuiLink, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import { communityPostPath } from '#core/contract/index.js';
import type { DiscussionPost, ReactionSummary, SpaceFeed, SpaceFeedItem } from '#core/domain/index.js';

import { translateDeletedContent } from '../../i18n/deleted-content.js';
import { StatusView } from '../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { PostContent } from '../../components/ui/PostContent.js';
import { UserAvatar } from '../../components/ui/UserAvatar.js';
import { formatRelativeTime } from '../../lib/format.js';
import {
  AuthorChip,
  DeletedPostText,
  DiscussionThread,
  PostAuthorName,
  PostMetaText,
} from '../../theme.js';
import { EmptyFeedIcon } from './community-icons.js';

const EXCERPT_WORDS = 8;

const postExcerpt = (text: string): string => {
  const words = text.replaceAll(/\s+/gu, ' ').trim().split(' ').filter((word) => word.length > 0);
  const lead = words.slice(0, EXCERPT_WORDS).join(' ');
  return words.length > EXCERPT_WORDS ? `${lead}…` : lead;
};

const PublicReactions = ({ reactions }: { reactions: ReactionSummary[] }) => {
  const t = useTranslations();
  const counted = reactions.filter((reaction) => reaction.count > 0);
  if (counted.length === 0) return null;
  return (
    <Stack direction="row" useFlexGap sx={{ columnGap: '0.9rem', flexWrap: 'wrap' }} data-testid="public-reactions">
      {counted.map((reaction) => (
        <PostMetaText
          key={reaction.emoji}
          component="span"
          role="img"
          aria-label={t.community.reactionCountAria({ emoji: reaction.emoji, count: reaction.count })}
          data-testid={`public-reaction-${reaction.emoji}`}
        >
          {`${reaction.emoji} ${String(reaction.count)}`}
        </PostMetaText>
      ))}
    </Stack>
  );
};

const PostHeader = ({
  post,
  underPinnedHeading = false,
}: {
  post: DiscussionPost | SpaceFeedItem;
  underPinnedHeading?: boolean;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const pinChip = post.pinnedAt === null
    ? null
    : post.authorIsStaff
      ? t.community.announcementChip
      : underPinnedHeading ? null : t.community.pinnedChip;
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ alignItems: 'center', columnGap: '0.6rem', flexWrap: 'wrap' }}
    >
      <UserAvatar name={translateDeletedContent(post.authorDisplay, t)} imageUrl={post.authorAvatarUrl} size="sm" />
      <PostAuthorName component="span">{translateDeletedContent(post.authorDisplay, t)}</PostAuthorName>
      {post.authorIsStaff && (
        <AuthorChip data-testid={`public-author-chip-${post.id}`}>
          {t.discussion.authorChip}
        </AuthorChip>
      )}
      {pinChip === null ? null : <Chip size="small" label={pinChip} data-testid={`public-pin-chip-${post.id}`} />}
      <PostMetaText component="time" dateTime={post.createdAt}>
        {formatRelativeTime(post.createdAt, language)}
      </PostMetaText>
    </Stack>
  );
};

const PostText = ({ post }: { post: DiscussionPost | SpaceFeedItem }) => {
  const t = useTranslations();
  return post.deletedAt === null ? (
    <PostContent html={post.bodyHtml} format={post.bodyFormat} sx={{ mt: '0.75rem' }} data-testid={`public-post-body-${post.id}`} />
  ) : (
    <DeletedPostText variant="body2" component="p" sx={{ mt: '0.75rem' }} data-testid={`public-deleted-post-${post.id}`}>
      {post.deletedBy === 'moderator' ? t.discussion.moderatorDeletedPost : t.discussion.deletedPost}
    </DeletedPostText>
  );
};

const PublicFeedPost = ({
  spaceId,
  item,
  underPinnedHeading = false,
}: {
  spaceId: string;
  item: SpaceFeedItem;
  underPinnedHeading?: boolean;
}) => {
  const t = useTranslations();
  return (
    <DiscussionThread sx={{ p: '1rem 1.25rem' }} data-testid={`public-feed-post-${item.id}`}>
      <Stack useFlexGap sx={{ rowGap: '0.6rem' }}>
        <Box>
          <PostHeader post={item} underPinnedHeading={underPinnedHeading} />
          <PostText post={item} />
        </Box>
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
            aria-label={t.community.openThreadAria({
              author: translateDeletedContent(item.authorDisplay, t),
              excerpt: item.deletedAt === null ? postExcerpt(item.bodyPlainText) : '',
            })}
            data-testid={`public-open-thread-${item.id}`}
          >
            {t.community.openThread}
          </MuiLink>
        </Stack>
      </Stack>
    </DiscussionThread>
  );
};

const FeedGroupHeading = ({ component, testId, children }: { component: 'h2' | 'h3'; testId: string; children: string }) => (
  <Typography variant="h3" component={component} sx={{ mt: '0.5rem' }} data-testid={testId}>
    {children}
  </Typography>
);

export const PublicFeedList = ({
  spaceId,
  feed,
  headingComponent = 'h2',
}: {
  spaceId: string;
  feed: SpaceFeed;
  headingComponent?: 'h2' | 'h3';
}) => {
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
      {feed.pinned.length > 0 ? (
        <FeedGroupHeading component={headingComponent} testId="public-feed-pinned-heading">
          {t.community.pinnedHeading}
        </FeedGroupHeading>
      ) : null}
      {feed.pinned.map((item) => (
        <PublicFeedPost key={`pinned-${item.id}`} spaceId={spaceId} item={item} underPinnedHeading />
      ))}
      {feed.pinned.length > 0 && feed.items.length > 0 ? (
        <FeedGroupHeading component={headingComponent} testId="public-feed-latest-heading">
          {t.community.latestHeading}
        </FeedGroupHeading>
      ) : null}
      {feed.items.map((item) => (
        <PublicFeedPost key={item.id} spaceId={spaceId} item={item} />
      ))}
    </Stack>
  );
};

const PublicReply = ({ post, depth }: { post: DiscussionPost; depth: number }) => (
  <Stack useFlexGap sx={{ rowGap: '0.6rem', pl: depth === 0 ? 0 : '1.25rem' }}>
    <DiscussionThread sx={{ p: '0.85rem 1.1rem' }} data-testid={`public-reply-${post.id}`}>
      <Box>
        <PostHeader post={post} />
        <PostText post={post} />
      </Box>
    </DiscussionThread>
    {post.replies.map((reply) => (
      <PublicReply key={reply.id} post={reply} depth={depth + 1} />
    ))}
  </Stack>
);

export const PublicThreadView = ({ root }: { root: DiscussionPost }) => (
  <Stack useFlexGap sx={{ rowGap: '1rem' }} data-testid="public-thread">
    <DiscussionThread sx={{ p: '1rem 1.25rem' }} data-testid={`public-post-${root.id}`}>
      <Box>
        <PostHeader post={root} />
        <PostText post={root} />
      </Box>
    </DiscussionThread>
    {root.replies.map((reply) => (
      <PublicReply key={reply.id} post={reply} depth={0} />
    ))}
  </Stack>
);
