import { Box, Link as MuiLink, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import { communitySpacePath } from '#core/contract/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { ThreadHeadline } from '../../theme.js';
import { anonCrumbs } from './anon-crumbs.js';
import { MemberSurface } from './MemberSurface.js';
import { PublicThreadView } from './PublicFeed.js';
import { anonHomePath } from './shell/member-nav.js';
import { useVisitorJoin, VisitorContactLinks, VisitorJoinButton } from './visitor-actions.js';

const isNotFound = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'not_found';

const threadHeadline = (body: string): string | null => {
  const condensed = body.replaceAll(/\s+/gu, ' ').trim();
  return condensed.length === 0 ? null : condensed;
};

export const PublicSpaceThreadPage = ({
  spaceId,
  postId,
}: {
  spaceId: string;
  postId: string;
}) => {
  const t = useTranslations();
  const navigation = useQuery(actions.publicNavigation);
  const thread = useQuery(actions.publicSpaceThread({ spaceId, postId }));
  const join = useVisitorJoin(spaceId);

  if (navigation.isPending) {
    return (
      <MemberSurface
        title={t.community.threadTitle}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.community.loadingFeed }}
      />
    );
  }

  if (navigation.isError) {
    return (
      <MemberSurface
        title={t.community.threadTitle}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{
          kind: 'error',
          message: localizeError(navigation.error, t),
          retry: { label: t.common.retry, onRetry: () => void navigation.refetch() },
        }}
      />
    );
  }

  const space = navigation.data.navigation.spaces.find((candidate) => candidate.id === spaceId);

  if (space === undefined) {
    return (
      <MemberSurface
        title={t.community.spaceNotFoundTitle}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{
          kind: 'not-found',
          title: t.community.spaceNotFoundTitle,
          body: t.community.spaceNotFoundBody,
          action: <MuiLink component={Link} to={anonHomePath()}>{t.shell.start}</MuiLink>,
        }}
      />
    );
  }

  const root = thread.data?.discussion.threads[0];
  const headline = root === undefined ? null : threadHeadline(root.bodyPlainText);
  const missing = thread.isError ? isNotFound(thread.error) : thread.isSuccess && root === undefined;

  return (
    <MemberSurface
      documentTitle={root?.body.split(/\r?\n/u)[0]?.trim() || t.community.threadTitle}
      title={<ThreadHeadline>{headline ?? t.community.threadTitle}</ThreadHeadline>}
      eyebrow={space.name}
      width="wide"
      breadcrumbs={anonCrumbs(
        t,
        {
          label: space.name,
          link: (
            <MuiLink component={Link} to={communitySpacePath(spaceId)}>
              {space.name}
            </MuiLink>
          ),
        },
        { label: t.community.threadTitle },
      )}
    >
      <Stack useFlexGap sx={{ rowGap: '1.5rem' }}>
        {thread.isPending ? (
          <StatusView surface={false} state={{ kind: 'loading', label: t.community.loadingFeed }} />
        ) : missing ? (
          <StatusView
            state={{
              kind: 'not-found',
              title: t.community.threadNotFoundTitle,
              body: t.community.threadNotFoundBody,
              action: (
                <MuiLink component={Link} to={communitySpacePath(spaceId)} data-testid="public-thread-back">
                  {t.community.backToFeed}
                </MuiLink>
              ),
            }}
            data-testid="public-thread-not-found"
          />
        ) : thread.isError || root === undefined ? (
          <StatusView
            surface={false}
            state={{
              kind: 'error',
              message: localizeError(thread.error, t),
              retry: { label: t.discussion.retry, onRetry: () => void thread.refetch() },
            }}
          />
        ) : (
          <PublicThreadView root={root} />
        )}
        <Box>
          {join.target.kind === 'none' ? (
            <VisitorContactLinks supportUrl={join.supportUrl} signedIn={join.signedIn} />
          ) : (
            <VisitorJoinButton target={join.target} />
          )}
        </Box>
      </Stack>
    </MemberSurface>
  );
};
