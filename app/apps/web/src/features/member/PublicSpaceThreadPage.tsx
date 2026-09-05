import { Box, Button, Link as MuiLink, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { communitySpacePath } from '#core/contract/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { ThreadHeadline } from '../../theme.js';
import { anonCrumbs } from './anon-crumbs.js';
import { MemberSurface } from './MemberSurface.js';
import { PublicThreadView } from './PublicFeed.js';
import { anonHomePath, anonOfferLink } from './shell/member-nav.js';

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
  const headline = root === undefined ? null : threadHeadline(root.body);

  return (
    <MemberSurface
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
        ) : thread.isError ? (
          <StatusView
            surface={false}
            state={{
              kind: 'error',
              message: localizeError(thread.error, t),
              retry: { label: t.discussion.retry, onRetry: () => void thread.refetch() },
            }}
          />
        ) : root === undefined ? (
          <StatusView
            state={{
              kind: 'not-found',
              title: t.community.spaceNotFoundTitle,
              body: t.community.spaceNotFoundBody,
            }}
          />
        ) : (
          <PublicThreadView root={root} />
        )}
        <Box>
          <Button
            component={Link}
            {...anonOfferLink(navigation.data.navigation.defaultHomeSpaceId === spaceId)}
            variant="contained"
            data-testid="anon-join-cta"
          >
            {t.anon.joinOfferCta}
          </Button>
        </Box>
      </Stack>
    </MemberSurface>
  );
};
