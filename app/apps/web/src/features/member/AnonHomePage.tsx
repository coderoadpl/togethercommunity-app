import { Box, Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { QuietNotice } from '../../theme.js';
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

export const AnonHomePage = () => {
  const t = useTranslations();
  const navigation = useQuery(actions.publicNavigation);

  if (navigation.isPending) {
    return (
      <MemberSurface
        title={t.anon.homeTitle}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.common.loading }}
      />
    );
  }

  if (navigation.isError) {
    return (
      <MemberSurface
        title={t.anon.homeTitle}
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

  if (spaces.length === 0 && courses.length === 0 && lockedSpaces.length === 0) {
    return (
      <MemberSurface title={t.anon.homeTitle} eyebrow={t.anon.eyebrow} width="wide">
        <StatusView
          state={{ kind: 'empty', icon: <EmptyLibraryIcon />, title: t.anon.emptyTitle, body: t.anon.emptyBody }}
          data-testid="anon-empty-state"
        />
      </MemberSurface>
    );
  }

  return (
    <MemberSurface title={t.anon.homeTitle} eyebrow={t.anon.eyebrow} width="wide">
      <Stack useFlexGap sx={{ rowGap: '2rem' }}>
        <QuietNotice variant="outlined" data-testid="anon-read-only-banner">
          <span>{t.anon.readOnlyBanner}</span>
          <MuiLink component={Link} to="/login">
            {t.auth.signInLink}
          </MuiLink>
        </QuietNotice>
        {homeSpace === undefined ? null : (
          <HomeSpaceFeed spaceId={homeSpace.id} name={homeSpace.name} />
        )}
        {spaces.length === 0 ? null : (
          <TileSection title={t.anon.spacesSection} testId="anon-spaces">
            {spaces.map((space) => (
              <SpaceCard key={space.id} space={space} />
            ))}
          </TileSection>
        )}
        {courses.length === 0 ? null : (
          <TileSection title={t.anon.coursesSection} testId="anon-courses">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </TileSection>
        )}
        {lockedSpaces.length === 0 ? null : (
          <TileSection title={t.start.lockedSection} testId="anon-locked">
            {lockedSpaces.map((space) => (
              <LockedSpaceCard key={space.id} space={space} />
            ))}
          </TileSection>
        )}
      </Stack>
    </MemberSurface>
  );
};
