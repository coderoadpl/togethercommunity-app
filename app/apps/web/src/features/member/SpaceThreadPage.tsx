import { useEffect } from 'react';
import { Link as MuiLink } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { MemberSurface } from './MemberSurface.js';
import { ThreadDiscussion } from './ThreadDiscussion.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

export const SpaceThreadPage = ({ spaceId, postId }: { spaceId: string; postId: string }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const spaces = useQuery(actions.spaces);
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

  return (
    <MemberSurface
      title={t.community.threadTitle}
      eyebrow={t.community.threadEyebrow}
      width="wide"
      breadcrumbs={[
        { label: t.community.heading, link: <MuiLink component={Link} to="/community">{t.community.heading}</MuiLink> },
        { label: space.name, link: <MuiLink component={Link} to={`/community/${encodeURIComponent(spaceId)}`}>{space.name}</MuiLink> },
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
