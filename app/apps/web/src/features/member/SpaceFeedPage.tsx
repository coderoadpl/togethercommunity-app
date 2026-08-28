import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Link as MuiLink, Paper, Stack } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import { REACTION_EMOJIS, type ReactionEmoji, type ReactionSummary, type SpaceFeedItem } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
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
import { EmptyFeedIcon } from './community-icons.js';
import { LiveNowBanner } from './events/LiveNowBanner.js';
import { SpaceEventsSection } from './events/SpaceEventsSection.js';
import { MemberAvatar } from '../../components/ui/MemberAvatar.js';
import { MemberSurface } from './MemberSurface.js';
import { PublicSpaceFeedPage } from './PublicSpaceFeedPage.js';
import { LockedSpaceCard } from './SpaceCards.js';
import { PostComposer } from './ThreadDiscussion.js';
import { ReportPostButton } from './ReportPostButton.js';
import { StartMessageButton } from './messages/StartMessageButton.js';
import { useViewerKind } from './viewer.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const reactionFor = (reactions: ReactionSummary[], emoji: ReactionEmoji): ReactionSummary | undefined =>
  reactions.find((reaction) => reaction.emoji === emoji);

const ReactionBar = ({
  postId,
  reactions,
  onToggle,
  busy,
}: {
  postId: string;
  reactions: ReactionSummary[];
  onToggle: (emoji: ReactionEmoji, reacted: boolean) => void;
  busy: boolean;
}) => {
  const t = useTranslations();
  return (
    <Stack direction="row" useFlexGap sx={{ columnGap: '0.5rem', flexWrap: 'wrap' }}>
      {REACTION_EMOJIS.map((emoji) => {
        const summary = reactionFor(reactions, emoji);
        const count = summary?.count ?? 0;
        const reacted = summary?.viewerReacted ?? false;
        return (
          <Chip
            key={emoji}
            size="small"
            variant={reacted ? 'filled' : 'outlined'}
            color={reacted ? 'primary' : 'default'}
            disabled={busy}
            aria-pressed={reacted}
            aria-label={t.community.reactAria({ emoji })}
            data-testid={`reaction-${postId}-${emoji}`}
            label={count > 0 ? `${emoji} ${count}` : emoji}
            onClick={() => onToggle(emoji, reacted)}
          />
        );
      })}
    </Stack>
  );
};

const FeedPost = ({
  spaceId,
  item,
  reactions,
  onToggle,
  busy,
  canPin,
  pinBusy,
  onPin,
}: {
  spaceId: string;
  item: SpaceFeedItem;
  reactions: ReactionSummary[];
  onToggle: (postId: string, emoji: ReactionEmoji, reacted: boolean) => void;
  busy: boolean;
  canPin: boolean;
  pinBusy: boolean;
  onPin: (postId: string, pinned: boolean) => void;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const deleted = item.deletedAt !== null;
  return (
    <DiscussionThread sx={{ p: '1rem 1.25rem' }} data-testid={`feed-post-${item.id}`}>
      <Stack useFlexGap sx={{ rowGap: '0.6rem' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.6rem', flexWrap: 'wrap' }}>
          <MemberAvatar name={item.authorDisplay} avatarUrl={item.authorAvatarUrl} size="sm" />
          <PostAuthorName component="span">{item.authorDisplay}</PostAuthorName>
          {item.authorIsStaff && <AuthorChip data-testid={`author-chip-${item.id}`}>{t.discussion.authorChip}</AuthorChip>}
          {item.pinnedAt !== null ? (
            <Chip
              size="small"
              label={item.authorIsStaff ? t.community.announcementChip : t.community.pinnedChip}
            />
          ) : null}
          <PostMetaText component="time" dateTime={item.createdAt}>
            {formatRelativeTime(item.createdAt, language)}
          </PostMetaText>
        </Stack>

        {deleted ? (
          <DeletedPostText variant="body2" component="p" data-testid={`deleted-post-${item.id}`}>
            {t.discussion.deletedPost}
          </DeletedPostText>
        ) : (
          <PostBody variant="body1" component="p" data-testid={`post-body-${item.id}`}>
            {item.body}
          </PostBody>
        )}

        {!deleted && (
          <ReactionBar
            postId={item.id}
            reactions={reactions}
            busy={busy}
            onToggle={(emoji, reacted) => onToggle(item.id, emoji, reacted)}
          />
        )}

        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '1rem', flexWrap: 'wrap' }}>
          <PostMetaText component="span" data-testid={`reply-count-${item.id}`}>
            {t.discussion.replyCount({ count: item.replyCount })}
          </PostMetaText>
          <MuiLink component={Link} to={`/community/${encodeURIComponent(spaceId)}/posts/${encodeURIComponent(item.id)}`} data-testid={`open-thread-${item.id}`}>
            {t.community.openThread}
          </MuiLink>
          {canPin ? (
            <Button
              size="small"
              disabled={pinBusy}
              onClick={() => onPin(item.id, item.pinnedAt === null)}
            >
              {item.pinnedAt === null ? t.community.pin : t.community.unpin}
            </Button>
          ) : null}
          {!item.isOwn && !deleted ? <StartMessageButton postId={item.id} /> : null}
          {!item.isOwn && !deleted ? <ReportPostButton postId={item.id} /> : null}
        </Stack>
      </Stack>
    </DiscussionThread>
  );
};

export const SpaceFeedPage = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const viewer = useViewerKind();

  if (viewer === 'pending') {
    return (
      <MemberSurface
        title={t.community.heading}
        eyebrow={t.community.feedEyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.community.loadingFeed }}
      />
    );
  }

  return viewer === 'anonymous' ? (
    <PublicSpaceFeedPage spaceId={spaceId} />
  ) : (
    <MemberSpaceFeedPage spaceId={spaceId} />
  );
};

const MemberSpaceFeedPage = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const spaces = useQuery(actions.spaces);
  const navigation = useQuery(actions.memberNavigation);
  const me = useQuery(actions.me);
  const feed = useQuery(actions.spaceFeed({ spaceId }));
  const banned = me.data?.tenant?.banned === true;

  const [followOverride, setFollowOverride] = useState<boolean | null>(null);
  const [reactionOverrides, setReactionOverrides] = useState<Record<string, ReactionSummary[]>>({});

  const { mutate: markSeen } = useMutation({
    ...actions.markSpaceSeen,
    onSettled: () => queryClient.invalidateQueries(actions.memberNavigationInvalidates()),
  });
  const invalidateSpaces = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.spacesInvalidates()),
      queryClient.invalidateQueries(actions.memberHomeFeedInvalidates()),
    ]);
    markSeen({ spaceId });
  };
  const settleFollow = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.spacesInvalidates()),
      queryClient.invalidateQueries(actions.memberNavigationInvalidates()),
    ]);
  };
  const create = useMutation({ ...actions.createPost, onSettled: invalidateSpaces });
  const follow = useMutation({ ...actions.followSpace, onSettled: settleFollow });
  const unfollow = useMutation({ ...actions.unfollowSpace, onSettled: settleFollow });
  const react = useMutation(actions.reactToPost);
  const unreact = useMutation(actions.unreactToPost);
  const pin = useMutation({
    ...actions.pinPost,
    onSuccess: () => void feed.refetch(),
  });

  const unauthorized = isUnauthorized(spaces.error) || isUnauthorized(feed.error);
  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  const feedReadable = feed.isSuccess;
  useEffect(() => {
    if (feedReadable) markSeen({ spaceId });
  }, [feedReadable, markSeen, spaceId]);

  if (spaces.isPending) {
    return (
      <MemberSurface
        title={t.community.heading}
        eyebrow={t.community.feedEyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.community.loadingFeed }}
      />
    );
  }

  if (unauthorized) return null;

  if (spaces.isError) {
    return (
      <MemberSurface
        title={t.community.heading}
        eyebrow={t.community.feedEyebrow}
        width="wide"
        state={{ kind: 'error', message: localizeError(spaces.error, t), retry: { label: t.common.retry, onRetry: () => void spaces.refetch() } }}
      />
    );
  }

  const space = spaces.data.spaces.find((candidate) => candidate.id === spaceId);

  if (space === undefined && navigation.isPending) {
    return (
      <MemberSurface
        title={t.community.heading}
        eyebrow={t.community.feedEyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.community.loadingFeed }}
      />
    );
  }

  const locked = navigation.data?.navigation.lockedSpaces.find((candidate) => candidate.id === spaceId);

  if (space === undefined && locked !== undefined) {
    return (
      <MemberSurface title={locked.name} eyebrow={t.community.feedEyebrow} width="prose">
        <Box data-testid="locked-space-view">
          <LockedSpaceCard space={locked} />
        </Box>
      </MemberSurface>
    );
  }

  if (space === undefined) {
    return (
      <MemberSurface
        title={t.community.heading}
        eyebrow={t.community.feedEyebrow}
        width="wide"
        state={{
          kind: 'not-found',
          title: t.community.spaceNotFoundTitle,
          body: t.community.spaceNotFoundBody,
          action: <MuiLink component={Link} to="/community">{t.community.backToSpaces}</MuiLink>,
        }}
      />
    );
  }

  const isFollowing = followOverride ?? space.isFollowing;
  const toggleFollow = () => {
    if (isFollowing) {
      setFollowOverride(false);
      unfollow.mutate({ spaceId }, { onError: () => setFollowOverride(null) });
    } else {
      setFollowOverride(true);
      follow.mutate({ spaceId }, { onError: () => setFollowOverride(null) });
    }
  };

  const reactionBusy = react.isPending || unreact.isPending;
  const toggleReaction = (postId: string, emoji: ReactionEmoji, reacted: boolean) => {
    const onSuccess = (data: { postId: string; reactions: ReactionSummary[] }) =>
      setReactionOverrides((previous) => ({ ...previous, [postId]: data.reactions }));
    if (reacted) unreact.mutate({ postId, emoji }, { onSuccess });
    else react.mutate({ postId, emoji }, { onSuccess });
  };

  const rail = (
    <>
      <SectionCard title={t.community.aboutHeading} data-testid="space-about">
        <PostBody variant="body2" component="p" color="text.secondary">
          {space.description ?? t.community.noDescription}
        </PostBody>
        <Chip
          size="small"
          variant="outlined"
          label={space.visibility === 'product' ? t.community.productGated : t.community.membersOnly}
          sx={{ alignSelf: 'flex-start' }}
        />
        <Box>
          <Button
            variant={isFollowing ? 'outlined' : 'contained'}
            aria-pressed={isFollowing}
            data-testid="space-follow-toggle"
            onClick={toggleFollow}
          >
            {isFollowing ? t.community.unfollow : t.community.follow}
          </Button>
        </Box>
      </SectionCard>
      <SpaceEventsSection spaceId={spaceId} />
    </>
  );

  const items = feed.data?.feed.items ?? [];
  const pinned = feed.data?.feed.pinned ?? [];
  const canPin =
    me.data?.tenant?.staffRole !== null && me.data?.tenant?.staffRole !== undefined;

  return (
    <MemberSurface title={space.name} eyebrow={t.community.feedEyebrow} width="wide" rail={rail}>
      <Stack useFlexGap sx={{ rowGap: '1.5rem' }}>
        <LiveNowBanner spaceId={spaceId} />
        <Paper elevation={1} sx={{ p: '1.25rem' }}>
          <PostComposer
            label={t.community.composerLabel}
            placeholder={t.community.composerPlaceholder}
            submitLabel={t.community.post}
            pendingLabel={t.community.posting}
            busy={create.isPending}
            disabled={banned}
            onSubmit={(body, reset) =>
              create.mutate({ contextKind: 'space', contextId: spaceId, body }, { onSuccess: () => reset() })
            }
            testId="space-composer"
          />
        </Paper>

        {create.isError ? <Alert severity="error">{create.error instanceof ApiError && create.error.appError.code === 'rate_limited' ? t.community.postTooFast : localizeError(create.error, t)}</Alert> : null}
        {pin.isError ? <Alert severity="error">{localizeError(pin.error, t)}</Alert> : null}
        {follow.isError || unfollow.isError ? <Alert severity="error">{localizeError(follow.error ?? unfollow.error, t)}</Alert> : null}
        {react.isError || unreact.isError ? <Alert severity="error">{localizeError(react.error ?? unreact.error, t)}</Alert> : null}
        {me.isError ? (
          <StatusView surface={false} state={{ kind: 'error', message: localizeError(me.error, t), retry: { label: t.common.retry, onRetry: () => void me.refetch() } }} />
        ) : null}

        {feed.isPending ? (
          <StatusView surface={false} state={{ kind: 'loading', label: t.community.loadingFeed }} />
        ) : feed.isError ? (
          <StatusView
            surface={false}
            state={{
              kind: 'error',
              message: localizeError(feed.error, t),
              retry: { label: t.discussion.retry, onRetry: () => void feed.refetch() },
            }}
          />
        ) : items.length === 0 && pinned.length === 0 ? (
          <StatusView
            state={{ kind: 'empty', icon: <EmptyFeedIcon />, title: t.community.emptyFeed }}
            data-testid="feed-empty-state"
          />
        ) : (
          <Stack useFlexGap sx={{ rowGap: '1rem' }}>
            {pinned.length > 0 ? <Chip label={t.community.pinnedHeading} /> : null}
            {pinned.map((item) => (
              <FeedPost
                key={`pinned-${item.id}`}
                spaceId={spaceId}
                item={item}
                reactions={reactionOverrides[item.id] ?? item.reactions}
                onToggle={toggleReaction}
                busy={reactionBusy}
                canPin={canPin}
                pinBusy={pin.isPending}
                onPin={(postId, nextPinned) => pin.mutate({ postId, pinned: nextPinned })}
              />
            ))}
            {items.map((item) => (
              <FeedPost
                key={item.id}
                spaceId={spaceId}
                item={item}
                reactions={reactionOverrides[item.id] ?? item.reactions}
                onToggle={toggleReaction}
                busy={reactionBusy}
                canPin={canPin}
                pinBusy={pin.isPending}
                onPin={(postId, nextPinned) => pin.mutate({ postId, pinned: nextPinned })}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </MemberSurface>
  );
};
