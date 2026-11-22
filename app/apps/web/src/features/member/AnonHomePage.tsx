import { useEffect } from 'react';
import { Box, Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';

import { PUBLIC_OFFER_ANCHOR } from '#core/contract/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { QuietNotice } from '../../theme.js';
import { AnonOfferSection, uniqueOfferProducts } from './AnonOfferSection.js';
import { CourseCard } from './CourseCards.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyLibraryIcon } from './overview-icons.js';
import { PublicFeedList } from './PublicFeed.js';
import { LockedSpaceCard, SpaceCard } from './SpaceCards.js';
import { TileSection } from './StartPage.js';

const HomeSpaceFeed = ({ spaceId, name }: { spaceId: string; name: string }) => {
  const t = useTranslations();
  const feed = useQuery(actions.publicSpaceFeed({ spaceId }));

  return (
    <Box component="section" data-testid="anon-home-feed">
      <Typography variant="h3" component="h2" sx={{ mb: '0.9rem' }}>
        {name}
      </Typography>
      {feed.isPending ? (
        <StatusView surface={false} state={{ kind: 'loading', label: t.community.loadingFeed }} />
      ) : feed.isError ? (
        <StatusView
          surface={false}
          state={{
            kind: 'error',
            message: localizeError(feed.error, t),
            retry: { label: t.common.retry, onRetry: () => void feed.refetch() },
          }}
        />
      ) : (
        <PublicFeedList spaceId={spaceId} feed={feed.data.feed} />
      )}
    </Box>
  );
};

type OfferAnchorSection = 'offer' | 'locked' | 'courses' | 'spaces';

const useScrollToOfferAnchor = (ready: boolean) => {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (!ready || hash !== PUBLIC_OFFER_ANCHOR) return;
    document.getElementById(PUBLIC_OFFER_ANCHOR)?.scrollIntoView({ block: 'start' });
  }, [ready, hash]);
};

export const AnonHomePage = () => {
  const t = useTranslations();
  const offer = useQuery(actions.publicOffer);
  const salesLinks = offer.data?.salesLinks ?? [];
  const offerProducts = uniqueOfferProducts(offer.data?.products ?? []);
  const title = offer.data?.tenant.name ?? t.anon.homeTitle;
  const navigation = useQuery(actions.publicNavigation);
  useScrollToOfferAnchor(navigation.isSuccess);

  if (navigation.isPending) {
    return (
      <MemberSurface
        title={title}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.common.loading }}
      />
    );
  }

  if (navigation.isError) {
    return (
      <MemberSurface
        title={title}
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

  const { defaultHomeSpaceId, spaces, courses, lockedSpaces } = navigation.data.navigation;
  const homeSpace = spaces.find((space) => space.id === defaultHomeSpaceId);
  const tileSpaces = spaces.filter((space) => space.id !== homeSpace?.id);
  const hasOffer = offerProducts.length > 0 || salesLinks.length > 0;
  const anchorSection: OfferAnchorSection | null = hasOffer
    ? 'offer'
    : lockedSpaces.length > 0
      ? 'locked'
      : courses.length > 0
        ? 'courses'
        : tileSpaces.length > 0
          ? 'spaces'
          : null;
  const anchorFor = (section: OfferAnchorSection) =>
    section === anchorSection ? PUBLIC_OFFER_ANCHOR : undefined;
  const showOfferJump = anchorSection !== null && anchorSection !== 'spaces';

  if (
    spaces.length === 0 &&
    courses.length === 0 &&
    lockedSpaces.length === 0 &&
    salesLinks.length === 0 &&
    offerProducts.length === 0
  ) {
    return (
      <MemberSurface title={title} eyebrow={t.anon.eyebrow} width="wide">
        <StatusView
          state={{ kind: 'empty', icon: <EmptyLibraryIcon />, title: t.anon.emptyTitle, body: t.anon.emptyBody }}
          data-testid="anon-empty-state"
        />
      </MemberSurface>
    );
  }

  return (
    <MemberSurface title={title} eyebrow={t.anon.eyebrow} width="wide">
      <Stack useFlexGap sx={{ rowGap: '2rem' }}>
        <QuietNotice variant="outlined" data-testid="anon-read-only-banner">
          <span>{t.anon.readOnlyBanner}</span>
          <Box
            component="span"
            sx={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: '1rem', rowGap: '0.4rem', ml: 'auto' }}
          >
            {showOfferJump ? (
              <MuiLink
                component={Link}
                to="/"
                hash={PUBLIC_OFFER_ANCHOR}
                data-testid="anon-offer-jump"
              >
                {t.anon.salesCta}
              </MuiLink>
            ) : null}
            <MuiLink component={Link} to="/login">
              {t.auth.signInLink}
            </MuiLink>
          </Box>
        </QuietNotice>
        {homeSpace === undefined ? null : (
          <HomeSpaceFeed spaceId={homeSpace.id} name={homeSpace.name} />
        )}
        {hasOffer ? (
          <AnonOfferSection id={PUBLIC_OFFER_ANCHOR} products={offerProducts} salesLinks={salesLinks} />
        ) : null}
        {tileSpaces.length === 0 ? null : (
          <TileSection title={t.anon.spacesSection} id={anchorFor('spaces')} testId="anon-spaces">
            {tileSpaces.map((space) => (
              <SpaceCard key={space.id} space={space} />
            ))}
          </TileSection>
        )}
        {courses.length === 0 ? null : (
          <TileSection title={t.anon.coursesSection} id={anchorFor('courses')} testId="anon-courses">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </TileSection>
        )}
        {lockedSpaces.length === 0 ? null : (
          <TileSection title={t.start.lockedSection} id={anchorFor('locked')} testId="anon-locked">
            {lockedSpaces.map((space) => (
              <LockedSpaceCard key={space.id} space={space} />
            ))}
          </TileSection>
        )}
      </Stack>
    </MemberSurface>
  );
};
