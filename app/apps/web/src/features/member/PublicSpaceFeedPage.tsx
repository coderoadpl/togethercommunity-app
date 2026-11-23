import { useEffect } from 'react';
import { Box, Button, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { PublicNavigation, SpaceFeed } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { EmberCtaLink, PostBody, QuietNotice } from '../../theme.js';
import { anonCrumbs } from './anon-crumbs.js';
import { MemberSurface } from './MemberSurface.js';
import { PublicSpaceEventsSection } from './events/PublicSpaceEventsSection.js';
import { PublicFeedList } from './PublicFeed.js';
import { anonHomePath } from './shell/member-nav.js';
import { LockClosed } from './tree-icons.js';
import { usePublicOfferPrice, useVisitorJoin, VisitorContactLinks, VisitorJoinButton } from './visitor-actions.js';

type LockedSpace = PublicNavigation['lockedSpaces'][number];

type FeedPages = InfiniteData<{ feed: SpaceFeed }, string | undefined>;

const mergeFeedPages = (pages: FeedPages['pages']): SpaceFeed | undefined => {
  const [first] = pages;
  if (first === undefined) return undefined;
  const seen = new Set<string>();
  const items = pages.flatMap((page) => page.feed.items).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return { ...first.feed, items };
};

const firstPageOnly = (data: FeedPages | undefined): FeedPages | undefined =>
  data === undefined || data.pages.length <= 1
    ? data
    : { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };

const usePublicSpaceFeed = (spaceId: string) => {
  const queryClient = useQueryClient();
  const feed = useInfiniteQuery(actions.publicSpaceFeedPages(spaceId));
  useEffect(
    () => () => {
      queryClient.setQueryData<FeedPages>(actions.publicSpaceFeedPages(spaceId).queryKey, firstPageOnly);
    },
    [queryClient, spaceId],
  );
  return feed;
};

const LockedSpaceAccess = ({ locked }: { locked: LockedSpace }) => {
  const t = useTranslations();
  const priceFor = usePublicOfferPrice();
  const productId = locked.productIds[0];
  const product = locked.products?.find((candidate) => candidate.id === productId) ?? locked.products?.[0];
  const price = priceFor(productId);
  return (
    <Paper variant="outlined" sx={{ p: '1.5rem', maxWidth: '40rem' }} data-testid="anon-locked-space">
      <Stack useFlexGap sx={{ rowGap: '1rem', alignItems: 'flex-start' }}>
        {locked.description === null ? null : (
          <PostBody variant="body1" component="p" data-testid="anon-locked-space-description">
            {locked.description}
          </PostBody>
        )}
        <Typography variant="body2" color="text.secondary">
          {t.anon.lockedSpaceBody}
        </Typography>
        {product === undefined ? null : (
          <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.5rem' }}>
            <LockClosed fontSize="small" />
            <Typography variant="body2" component="p" data-testid="anon-locked-space-product">
              {t.community.productGatedFor({ product: product.title })}
            </Typography>
          </Stack>
        )}
        {price === null ? null : (
          <Typography variant="h2" component="p" data-testid="anon-locked-space-price">
            {price}
          </Typography>
        )}
        {productId === undefined ? null : (
          <Box>
            <EmberCtaLink
              component={Link}
              to={`/checkout/${encodeURIComponent(productId)}`}
              variant="contained"
              data-testid="anon-space-unlock"
            >
              {t.anon.unlockCta}
            </EmberCtaLink>
          </Box>
        )}
      </Stack>
    </Paper>
  );
};

export const PublicSpaceFeedPage = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const navigation = useQuery(actions.publicNavigation);
  const feed = usePublicSpaceFeed(spaceId);
  const feedData = feed.data === undefined ? undefined : mergeFeedPages(feed.data.pages);
  const join = useVisitorJoin(spaceId);

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

  if (space === undefined && locked !== undefined) {
    return (
      <MemberSurface
        title={locked.name}
        eyebrow={t.anon.eyebrow}
        width="wide"
        breadcrumbs={anonCrumbs(t, { label: locked.name })}
      >
        <LockedSpaceAccess locked={locked} />
      </MemberSurface>
    );
  }

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

  const notice = (
    <QuietNotice variant="outlined" data-testid="anon-guest-notice">
      <span data-testid="anon-read-only">{t.anon.readOnlyBanner}</span>
      {join.target.kind === 'none' ? (
        <VisitorContactLinks supportUrl={join.supportUrl} signedIn={join.signedIn} />
      ) : (
        <VisitorJoinButton target={join.target} sx={{ minHeight: '44px' }} />
      )}
    </QuietNotice>
  );

  return (
    <MemberSurface
      title={space.name}
      eyebrow={t.anon.eyebrow}
      width="wide"
      railLeading={notice}
      rail={<PublicSpaceEventsSection spaceId={spaceId} />}
      mobileRail="split"
      breadcrumbs={anonCrumbs(t, { label: space.name })}
    >
      <Stack useFlexGap sx={{ rowGap: '1.5rem' }}>
        {space.description === null ? null : (
          <PostBody variant="body1" component="p" data-testid="anon-space-description">
            {space.description}
          </PostBody>
        )}
        {feedData === undefined ? (
          feed.isError ? (
            <StatusView
              surface={false}
              state={{
                kind: 'error',
                message: localizeError(feed.error, t),
                retry: { label: t.discussion.retry, onRetry: () => void feed.refetch() },
              }}
            />
          ) : (
            <StatusView surface={false} state={{ kind: 'loading', label: t.community.loadingFeed }} />
          )
        ) : (
          <Stack useFlexGap sx={{ rowGap: '1rem' }}>
            <PublicFeedList spaceId={spaceId} feed={feedData} />
            {feed.hasNextPage ? (
              <Box>
                <Button
                  variant="outlined"
                  data-testid="public-feed-load-more"
                  disabled={feed.isFetching}
                  onClick={() => void feed.fetchNextPage()}
                >
                  {t.discussion.loadMore}
                </Button>
              </Box>
            ) : null}
          </Stack>
        )}
      </Stack>
    </MemberSurface>
  );
};
