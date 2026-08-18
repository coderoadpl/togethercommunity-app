import { useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { PublicSpaceEvent } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, ListSection, PanelPage, StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { DataValue } from '../../../theme.js';
import { PanelBackLink } from '../PanelBackLink.js';

type EventScope = 'upcoming' | 'past';

const PAGE_SIZE = 20;

const EventRow = ({ spaceId, event }: { spaceId: string; event: PublicSpaceEvent }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const remove = useMutation({
    ...actions.deleteEvent,
    onSuccess: async () => {
      setConfirmDelete(false);
      await queryClient.invalidateQueries(actions.eventsInvalidates());
    },
  });

  return (
    <Paper elevation={1} sx={{ p: '1rem', display: 'grid', gap: '0.75rem' }} data-testid={`panel-event-${event.id}`}>
      <Stack direction="row" useFlexGap spacing="0.75rem" sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="h2" component="h2">
          {event.title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary" component="time" dateTime={event.startsAt}>
          {formatDateTime(event.startsAt, language)}
        </Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary" component="span">
        <DataValue>{event.goingCount}</DataValue> {t.events.rsvpGoing} ·{' '}
        <DataValue>{event.notGoingCount}</DataValue> {t.events.rsvpNotGoing}
        {event.location === null ? null : ` · ${event.location}`}
      </Typography>

      <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="text"
          component={Link}
          to={`/panel/spaces/${encodeURIComponent(spaceId)}/events/${encodeURIComponent(event.id)}`}
          data-testid={`panel-event-edit-${event.id}`}
        >
          {t.events.edit}
        </Button>
        <Button
          size="small"
          variant="text"
          color="error"
          onClick={() => setConfirmDelete(true)}
          data-testid={`panel-event-delete-${event.id}`}
        >
          {t.common.remove}
        </Button>
      </Stack>

      {remove.isError ? <Alert severity="error">{localizeError(remove.error, t)}</Alert> : null}

      <ConfirmDialog
        open={confirmDelete}
        title={t.events.deleteConfirmTitle}
        body={<Typography variant="body1">{t.events.deleteConfirmBody}</Typography>}
        confirmLabel={t.events.deleteEvent}
        cancelLabel={t.common.cancel}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ eventId: event.id })}
        onClose={() => setConfirmDelete(false)}
        confirmTestId={`panel-event-delete-confirm-${event.id}`}
      />
    </Paper>
  );
};

export const SpaceEventsPanel = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const [scope, setScope] = useState<EventScope>('upcoming');
  const spaces = useQuery(actions.staffSpaces);
  const events = useQuery({
    ...actions.spaceEvents({ spaceId, scope, limit: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  const space = spaces.data?.spaces.find((candidate) => candidate.id === spaceId);
  const listed = events.data?.events ?? [];
  const scopeLabels: Record<EventScope, string> = {
    upcoming: t.events.upcoming,
    past: t.events.past,
  };

  return (
    <PanelPage
      title={t.events.panelTitle}
      description={space?.name}
      backTo={<PanelBackLink to="/panel/spaces">{t.spacesPanel.allSpaces}</PanelBackLink>}
      action={
        <Button
          component={Link}
          to={`/panel/spaces/${encodeURIComponent(spaceId)}/events/new`}
          variant="contained"
          data-testid="panel-event-new"
        >
          + {t.events.newEvent}
        </Button>
      }
    >
      <ListSection
        toolbar={{
          filters: (
            <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label={t.events.sectionTitle}>
              {(['upcoming', 'past'] as const).map((value) => (
                <Chip
                  key={value}
                  size="small"
                  clickable
                  variant={scope === value ? 'filled' : 'outlined'}
                  color={scope === value ? 'primary' : 'default'}
                  label={scopeLabels[value]}
                  aria-pressed={scope === value}
                  data-testid={`panel-events-scope-${value}`}
                  onClick={() => setScope(value)}
                />
              ))}
            </Stack>
          ),
        }}
        isEmpty={false}
        empty={null}
        noMatches={
          events.isSuccess && listed.length === 0 ? (
            <StatusView
              state={{
                kind: 'empty',
                title: t.events.panelEmpty,
                body: t.events.panelEmptyHint,
                action: (
                  <Button component={Link} to={`/panel/spaces/${encodeURIComponent(spaceId)}/events/new`}>
                    + {t.events.newEvent}
                  </Button>
                ),
              }}
              data-testid="panel-events-empty"
            />
          ) : undefined
        }
      >
        {events.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.events.loading }} />
        ) : events.isError ? (
          <StatusView
            state={{
              kind: 'error',
              message: localizeError(events.error, t),
              retry: { label: t.common.retry, onRetry: () => void events.refetch() },
            }}
          />
        ) : (
          <Stack useFlexGap spacing="1rem">
            {listed.map((event) => (
              <EventRow key={event.id} spaceId={spaceId} event={event} />
            ))}
          </Stack>
        )}
      </ListSection>
    </PanelPage>
  );
};
