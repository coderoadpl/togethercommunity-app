import { useEffect, useRef } from 'react';
import { Box, Button, Link as MuiLink, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useIsFetching, useQuery } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';

import { communitySpacePath, PUBLIC_OFFER_ANCHOR } from '#core/contract/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { QuietNotice } from '../../theme.js';
import { AnonOfferSection, offerProductPrices, uniqueOfferProducts, useOfferPriceFormatter } from './AnonOfferSection.js';
import { CourseCard } from './CourseCards.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyLibraryIcon } from './overview-icons.js';
import { PublicFeedList } from './PublicFeed.js';
import { isPublicHomeAnchor, lockedSpaceAnchor } from './shell/member-nav.js';
import { SectionHeadingLink } from './shell/shell-chrome.js';
import { LockedSpaceCard, SpaceCard } from './SpaceCards.js';
import { TileSection } from './StartPage.js';

const HomeSpaceFeed = ({ spaceId, name }: { spaceId: string; name: string }) => {
  const t = useTranslations();
  const feed = useQuery(actions.publicSpaceFeed({ spaceId }));

  return (
    <Box component="section" data-testid="anon-home-feed">
      <Typography variant="h3" component="h2" sx={{ mb: '0.9rem' }}>
        <SectionHeadingLink component={Link} to={communitySpacePath(spaceId)} data-testid="anon-home-feed-link">
          {name}
          <Box component="span" aria-hidden sx={{ ml: '0.35rem' }}>
            →
          </Box>
        </SectionHeadingLink>
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

const EmptyWorkspaceActions = ({ supportUrl, signedIn }: { supportUrl: string | null; signedIn: boolean }) => {
  const t = useTranslations();
  const external = supportUrl !== null && !supportUrl.toLowerCase().startsWith('mailto:');
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap sx={{ gap: '0.75rem', justifyContent: 'center' }}>
      {signedIn ? null : (
        <Button component={Link} to="/login" variant="contained" data-testid="anon-empty-sign-in">
          {t.auth.signInLink}
        </Button>
      )}
      {supportUrl === null ? null : (
        <Button
          href={supportUrl}
          variant={signedIn ? 'contained' : 'outlined'}
          data-testid="anon-empty-contact"
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          {t.anon.contactCreator}
        </Button>
      )}
    </Stack>
  );
};

const ReadOnlyNotice = ({ showOfferJump, showSignIn }: { showOfferJump: boolean; showSignIn: boolean }) => {
  const t = useTranslations();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const signIn = showSignIn ? (
    <MuiLink component={Link} to="/login">
      {t.auth.signInLink}
    </MuiLink>
  ) : null;

  if (isDesktop) {
    return (
      <QuietNotice variant="outlined" data-testid="anon-read-only-banner">
        <span>{t.anon.readOnlyBanner}</span>
        <Box
          component="span"
          sx={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: '1rem', rowGap: '0.4rem', ml: 'auto' }}
        >
          {showOfferJump ? (
            <MuiLink component={Link} to="/" hash={PUBLIC_OFFER_ANCHOR} data-testid="anon-offer-jump">
              {t.anon.salesCta}
            </MuiLink>
          ) : null}
          {signIn}
        </Box>
      </QuietNotice>
    );
  }

  return (
    <QuietNotice variant="outlined" data-testid="anon-read-only-banner">
      <span>{t.anon.readOnlyBanner}</span>
      {showOfferJump || signIn !== null ? (
        <Box
          sx={{ display: 'flex', flexBasis: '100%', flexWrap: 'wrap', alignItems: 'center', columnGap: '1rem', rowGap: '0.4rem' }}
        >
          {showOfferJump ? (
            <Button
              component={Link}
              to="/"
              hash={PUBLIC_OFFER_ANCHOR}
              variant="outlined"
              size="small"
              data-testid="anon-offer-jump"
              sx={{ minHeight: 44, '&&': { ml: 0 } }}
            >
              {t.anon.salesCta}
            </Button>
          ) : null}
          {signIn}
        </Box>
      ) : null}
    </QuietNotice>
  );
};

const useScrollToHomeAnchor = (ready: boolean) => {
  const hash = useLocation({ select: (location) => location.hash });
  const settled = useIsFetching() === 0;
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isPublicHomeAnchor(hash)) {
      scrolledFor.current = null;
      return;
    }
    if (!ready || !settled || scrolledFor.current === hash) return;
    scrolledFor.current = hash;
    const target = document.getElementById(hash);
    if (target === null) return;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }, [ready, settled, hash]);
};

export const AnonHomePage = ({ visitorEmail = null }: { visitorEmail?: string | null } = {}) => {
  const t = useTranslations();
  const offer = useQuery(actions.publicOffer);
  const salesLinks = offer.data?.salesLinks ?? [];
  const offerProducts = uniqueOfferProducts(offer.data?.products ?? []);
  const title = offer.data?.tenant.name ?? t.anon.homeTitle;
  const supportUrl = offer.data?.tenant.support.url ?? null;
  const formatTerms = useOfferPriceFormatter();
  const previewCourseIds = new Set((offer.data?.previewLessons ?? []).map((lesson) => lesson.courseId));
  const lockedPrice = (productIds: readonly string[]): string | null => {
    const product = offer.data?.products.find((candidate) => candidate.id === productIds[0]);
    const lead = product === undefined ? undefined : offerProductPrices(product)[0];
    return lead === undefined ? null : formatTerms(lead);
  };
  const navigation = useQuery(actions.publicNavigation);
  useScrollToHomeAnchor(navigation.isSuccess);

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
  const showReadOnlyNotice = spaces.length > 0 || courses.length > 0;
  const sectionsBeforeAnchor =
    homeSpace !== undefined ||
    (anchorSection === 'locked' && (tileSpaces.length > 0 || courses.length > 0)) ||
    (anchorSection === 'courses' && tileSpaces.length > 0);
  const showOfferJump = anchorSection !== null && anchorSection !== 'spaces' && sectionsBeforeAnchor;

  if (
    spaces.length === 0 &&
    courses.length === 0 &&
    lockedSpaces.length === 0 &&
    salesLinks.length === 0 &&
    offerProducts.length === 0
  ) {
    return (
      <MemberSurface title={title} eyebrow={t.anon.eyebrow} width="wide">
        <Box sx={{ maxWidth: '32rem', mx: 'auto' }}>
          <StatusView
            state={{
              kind: 'not-found',
              icon: <EmptyLibraryIcon />,
              title: t.anon.emptyTitle,
              body: t.anon.emptyBody,
              ...(visitorEmail !== null && supportUrl === null
                ? {}
                : { action: <EmptyWorkspaceActions supportUrl={supportUrl} signedIn={visitorEmail !== null} /> }),
            }}
            data-testid="anon-empty-state"
          />
        </Box>
      </MemberSurface>
    );
  }

  return (
    <MemberSurface title={title} eyebrow={t.anon.eyebrow} width="wide">
      <Stack useFlexGap sx={{ rowGap: '2rem' }}>
        {showReadOnlyNotice ? (
          <ReadOnlyNotice showOfferJump={showOfferJump} showSignIn={visitorEmail === null} />
        ) : null}
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
              <CourseCard key={course.id} course={course} preview={previewCourseIds.has(course.id)} />
            ))}
          </TileSection>
        )}
        {lockedSpaces.length === 0 ? null : (
          <TileSection title={t.start.lockedSection} id={anchorFor('locked')} testId="anon-locked">
            {lockedSpaces.map((space) => (
              <LockedSpaceCard
                key={space.id}
                space={space}
                price={lockedPrice(space.productIds)}
                anchorId={lockedSpaceAnchor(space.id)}
              />
            ))}
          </TileSection>
        )}
      </Stack>
    </MemberSurface>
  );
};
