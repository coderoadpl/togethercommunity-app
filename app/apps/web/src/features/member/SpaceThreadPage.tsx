import { useEffect } from 'react';
import { Link as MuiLink } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { ThreadHeadline } from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';
import { PublicSpaceThreadPage } from './PublicSpaceThreadPage.js';
import { PAGE_SIZE, ThreadDiscussion } from './ThreadDiscussion.js';
import { useViewerKind } from './viewer.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const threadHeadline = (body: string): string | null => {
  const condensed = body.replaceAll(/\s+/gu, ' ').trim();
  return condensed.length === 0 ? null : condensed;
};

export const SpaceThreadPage = ({ spaceId, postId }: { spaceId: string; postId: string }) => {
  const t = useTranslations();
  const viewer = useViewerKind();

  if (viewer === 'pending') {
    return (
      <MemberSurface
        title={t.community.threadTitle}
        eyebrow={t.community.threadEyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.community.loadingFeed }}
      />
    );
  }

  return viewer === 'anonymous' ? (
    <PublicSpaceThreadPage spaceId={spaceId} postId={postId} />
  ) : (
    <MemberSpaceThreadPage spaceId={spaceId} postId={postId} />
  );
};

const MemberSpaceThreadPage = ({ spaceId, postId }: { spaceId: string; postId: string }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const spaces = useQuery(actions.spaces);
  const discussion = useQuery(
    actions.discussion({ contextKind: 'space', contextId: spaceId, limit: PAGE_SIZE }),
  );
  const unauthorized = isUnauthorized(spaces.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (spaces.isPending) {
    return (
      <MemberSurface
        title={t.community.threadTitle}
        eyebrow={t.community.threadEyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.community.loadingFeed }}
      />
    );
  }

  if (unauthorized) return null;

  if (spaces.isError) {
    return (
      <MemberSurface
        title={t.community.threadTitle}
        eyebrow={t.community.threadEyebrow}
        width="wide"
        state={{ kind: 'error', message: localizeError(spaces.error, t), retry: { label: t.common.retry, onRetry: () => void spaces.refetch() } }}
      />
    );
  }

  const space = spaces.data.spaces.find((candidate) => candidate.id === spaceId);

  if (space === undefined) {
    return (
      <MemberSurface
        title={t.community.spaceNotFoundTitle}
        eyebrow={t.community.threadEyebrow}
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

  const rootPost = discussion.data?.discussion.threads.find((thread) => thread.id === postId);
  const headline = rootPost === undefined ? null : threadHeadline(rootPost.body);

  return (
    <MemberSurface
      title={<ThreadHeadline>{headline ?? t.community.threadTitle}</ThreadHeadline>}
      eyebrow={space.name}
      width="wide"
      breadcrumbs={[
        { label: t.community.heading, link: <MuiLink component={Link} to="/community">{t.community.heading}</MuiLink> },
        ...(space.name === t.community.heading
          ? []
          : [{
              label: space.name,
              link: <MuiLink component={Link} to={`/community/${encodeURIComponent(spaceId)}`}>{space.name}</MuiLink>,
            }]),
        { label: t.community.threadTitle },
      ]}
    >
      <ThreadDiscussion
        context={{ contextKind: 'space', contextId: spaceId }}
        data-testid="space-thread"
        focus={{
          rootPostId: postId,
          onExit: () => void navigate({ to: '/community/$spaceId', params: { spaceId } }),
          exitLabel: t.community.backToFeed,
        }}
      />
    </MemberSurface>
  );
};
