import { Box, Button, Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { communitySpacePath } from '#core/contract/index.js';
import type { PublicSpaceEvent } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { FinePrint, PostBody, PostMetaText } from '../../../theme.js';
import { MemberSurface } from '../MemberSurface.js';
import { PublicThreadView } from '../PublicFeed.js';
import { formatEventRange } from './event-time.js';

const PublicEventDiscussion = ({ spaceId, rootPostId }: { spaceId: string; rootPostId: string }) => {
  const t = useTranslations();
  const thread = useQuery(actions.publicSpaceThread({ spaceId, postId: rootPostId }));
  const root = thread.data?.discussion.threads[0];

  if (thread.isPending) {
    return <StatusView surface={false} state={{ kind: 'loading', label: t.community.loadingFeed }} />;
  }
  if (thread.isError || root === undefined) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="public-event-discussion-empty">
        {t.events.discussionEmpty}
      </Typography>
    );
  }
  return <PublicThreadView root={root} />;
};

const PublicEventView = ({ event, spaceName }: { event: PublicSpaceEvent; spaceName: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();

  const rail = (
    <SectionCard title={t.events.sectionTitle} data-testid="public-event-details">
      <PostMetaText component="time" dateTime={event.startsAt}>
        {formatEventRange(event.startsAt, event.endsAt, language)}
      </PostMetaText>
      {event.location === null ? null : (
        <Stack useFlexGap sx={{ rowGap: '0.2rem' }} data-testid="public-event-location">
          <FinePrint component="span">{t.events.location}</FinePrint>
          <Typography variant="body2">{event.location}</Typography>
        </Stack>
      )}
      <Stack direction="row" useFlexGap sx={{ columnGap: '1rem', flexWrap: 'wrap' }}>
        <FinePrint component="span" data-testid="public-event-going-count">
          {t.events.goingCount({ count: event.goingCount })}
        </FinePrint>
        <FinePrint component="span" data-testid="public-event-not-going-count">
          {t.events.notGoingCount({ count: event.notGoingCount })}
        </FinePrint>
      </Stack>
      <Box>
        <Button component={Link} to="/login" variant="contained" data-testid="public-event-sign-in">
          {t.events.signInToRsvp}
        </Button>
      </Box>
    </SectionCard>
  );

  return (
    <MemberSurface
      title={event.title}
      eyebrow={t.anon.eyebrow}
      width="wide"
      rail={rail}
      mobileRail="before"
      breadcrumbs={[
        {
          label: spaceName,
          link: (
            <MuiLink component={Link} to={communitySpacePath(event.spaceId)}>
              {spaceName}
            </MuiLink>
          ),
        },
        { label: event.title },
      ]}
    >
      <Stack useFlexGap sx={{ rowGap: '1.5rem' }} data-testid="public-event-page">
        {event.description === null ? null : (
          <PostBody variant="body1" component="p" data-testid="public-event-description">
            {event.description}
          </PostBody>
        )}
        {event.discussionRootPostId === null ? null : (
          <PublicEventDiscussion spaceId={event.spaceId} rootPostId={event.discussionRootPostId} />
        )}
      </Stack>
    </MemberSurface>
  );
};

export const PublicEventPage = ({ spaceId, eventId }: { spaceId: string; eventId: string }) => {
  const t = useTranslations();
  const navigation = useQuery(actions.publicNavigation);
  const event = useQuery(actions.publicSpaceEvent({ spaceId, eventId }));

  if (event.isPending || navigation.isPending) {
    return (
      <MemberSurface
        title={t.events.sectionTitle}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.events.loading }}
      />
    );
  }

  if (event.isError) {
    return (
      <MemberSurface
        title={t.events.notFoundTitle}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{
          kind: 'not-found',
          title: t.events.notFoundTitle,
          body: t.events.notFoundBody,
          action: (
            <MuiLink component={Link} to={communitySpacePath(spaceId)}>
              {t.events.backToSpace}
            </MuiLink>
          ),
        }}
      />
    );
  }

  if (navigation.isError) {
    return (
      <MemberSurface
        title={t.events.sectionTitle}
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

  return (
    <PublicEventView event={event.data.event} spaceName={space?.name ?? t.community.heading} />
  );
};
