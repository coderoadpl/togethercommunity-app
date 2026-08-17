import { Box, Button, Link as MuiLink, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { PostBody } from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';
import { PublicFeedList } from './PublicFeed.js';
import { anonHomePath } from './shell/member-nav.js';

export const PublicSpaceFeedPage = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const navigation = useQuery(actions.publicNavigation);
  const feed = useQuery(actions.publicSpaceFeed({ spaceId }));

  if (navigation.isPending) {
    return (
      <MemberSurface
        title={t.community.heading}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.community.loadingFeed }}
      />
    );
  }

  if (navigation.isError) {
    return (
      <MemberSurface
        title={t.community.heading}
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
  const locked = navigation.data.navigation.lockedSpaces.find(
    (candidate) => candidate.id === spaceId,
  );

  if (space === undefined) {
    const productId = locked?.productIds[0];
    return (
      <MemberSurface
        title={locked?.name ?? t.community.spaceNotFoundTitle}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{
          kind: 'not-found',
          title: locked?.name ?? t.community.spaceNotFoundTitle,
          body: locked === undefined ? t.community.spaceNotFoundBody : t.shell.lockedSpaceHint,
          action: productId === undefined
            ? <MuiLink component={Link} to={anonHomePath()}>{t.shell.start}</MuiLink>
            : (
                <Button
                  component={Link}
                  to={`/checkout/${encodeURIComponent(productId)}`}
                  variant="contained"
                  data-testid="anon-space-unlock"
                >
                  {t.anon.unlockCta}
                </Button>
              ),
        }}
      />
    );
  }

  const rail = (
    <SectionCard title={t.community.aboutHeading} data-testid="anon-space-about">
      <PostBody variant="body2" component="p" color="text.secondary">
        {space.description ?? t.community.noDescription}
      </PostBody>
      <PostBody variant="body2" component="p" color="text.secondary" data-testid="anon-read-only">
        {t.anon.readOnlyBanner}
      </PostBody>
      <Box>
        <Button component={Link} to="/login" variant="contained" data-testid="anon-join-cta">
          {t.anon.joinDiscussionCta}
        </Button>
      </Box>
    </SectionCard>
  );

  return (
    <MemberSurface title={space.name} eyebrow={t.anon.eyebrow} width="wide" rail={rail}>
      <Stack useFlexGap sx={{ rowGap: '1.5rem' }}>
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
        ) : (
          <PublicFeedList spaceId={spaceId} feed={feed.data.feed} />
        )}
      </Stack>
    </MemberSurface>
  );
};
