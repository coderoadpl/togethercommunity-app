import { useEffect, useState } from 'react';
import { Alert, Button, Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import { communitySpacePath } from '#core/contract/index.js';

import { actions } from '../../../api.js';
import { SectionCard } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { FinePrint, PostBody, PostMetaText } from '../../../theme.js';
import { MemberSurface } from '../MemberSurface.js';
import { ThreadDiscussion } from '../ThreadDiscussion.js';
import { formatEventRange, hasEnded } from './event-time.js';
import { RsvpButtons } from './RsvpButtons.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isMissing = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'not_found';

export const EventPage = ({ spaceId, eventId }: { spaceId: string; eventId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const spaces = useQuery(actions.spaces);
  const event = useQuery(actions.event(eventId));
  const [calendarError, setCalendarError] = useState(false);

  const unauthorized = isUnauthorized(event.error) || isUnauthorized(spaces.error);
  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  const space = spaces.data?.spaces.find((candidate) => candidate.id === spaceId);
  const spaceName = space?.name ?? t.community.heading;

  if (event.isPending) {
    return (
      <MemberSurface
        title={t.events.sectionTitle}
        eyebrow={t.events.eyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.events.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (event.isError) {
    return (
      <MemberSurface
        title={isMissing(event.error) ? t.events.notFoundTitle : t.events.sectionTitle}
        eyebrow={t.events.eyebrow}
        width="wide"
        state={
          isMissing(event.error)
            ? {
                kind: 'not-found',
                title: t.events.notFoundTitle,
                body: t.events.notFoundBody,
                action: (
                  <MuiLink component={Link} to={communitySpacePath(spaceId)}>
                    {t.events.backToSpace}
                  </MuiLink>
                ),
              }
            : {
                kind: 'error',
                message: localizeError(event.error, t),
                retry: { label: t.common.retry, onRetry: () => void event.refetch() },
              }
        }
      />
    );
  }

  const current = event.data.event;
  const ended = hasEnded(current.endsAt);

  const downloadIcs = async () => {
    setCalendarError(false);
    try {
      const file = await queryClient.fetchQuery(actions.eventIcs(eventId));
      const url = URL.createObjectURL(new Blob([file.icsContent], { type: 'text/calendar' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setCalendarError(true);
    }
  };

  const rail = (
    <SectionCard title={t.events.sectionTitle} data-testid="event-details">
      <PostMetaText component="time" dateTime={current.startsAt}>
        {formatEventRange(current.startsAt, current.endsAt, language)}
      </PostMetaText>
      {current.location === null ? null : (
        <Stack useFlexGap sx={{ rowGap: '0.2rem' }} data-testid="event-location">
          <FinePrint component="span">{t.events.location}</FinePrint>
          <Typography variant="body2">{current.location}</Typography>
        </Stack>
      )}
      {current.url === null ? null : (
        <Stack useFlexGap sx={{ rowGap: '0.2rem' }}>
          <FinePrint component="span">{t.events.link}</FinePrint>
          <MuiLink href={current.url} target="_blank" rel="noreferrer" data-testid="event-link">
            {t.events.openLink}
          </MuiLink>
        </Stack>
      )}
      {ended ? (
        <Typography variant="body2" color="text.secondary" data-testid="event-ended">
          {t.events.ended}
        </Typography>
      ) : (
        <RsvpButtons event={current} />
      )}
      <Button variant="outlined" data-testid="event-ics" onClick={() => void downloadIcs()}>
        {t.events.addToCalendar}
      </Button>
      {calendarError ? <Alert severity="error">{t.events.calendarError}</Alert> : null}
    </SectionCard>
  );

  return (
    <MemberSurface
      title={current.title}
      eyebrow={spaceName}
      width="wide"
      rail={rail}
      mobileRail="before"
      breadcrumbs={[
        { label: t.community.heading, link: <MuiLink component={Link} to="/community">{t.community.heading}</MuiLink> },
        {
          label: spaceName,
          link: (
            <MuiLink component={Link} to={communitySpacePath(spaceId)}>
              {spaceName}
            </MuiLink>
          ),
        },
        { label: current.title },
      ]}
    >
      <Stack useFlexGap sx={{ rowGap: '1.5rem' }} data-testid="event-page">
        {current.description === null ? null : (
          <PostBody variant="body1" component="p" data-testid="event-description">
            {current.description}
          </PostBody>
        )}
        {current.discussionRootPostId === null ? (
          <Typography variant="body2" color="text.secondary" data-testid="event-discussion-empty">
            {t.events.discussionEmpty}
          </Typography>
        ) : (
          <ThreadDiscussion
            context={{ contextKind: 'space', contextId: spaceId }}
            heading={t.events.discussionTitle}
            data-testid="event-discussion"
            focus={{
              rootPostId: current.discussionRootPostId,
              onExit: () => void navigate({ to: '/community/$spaceId', params: { spaceId } }),
              exitLabel: t.events.backToSpace,
            }}
          />
        )}
      </Stack>
    </MemberSurface>
  );
};
