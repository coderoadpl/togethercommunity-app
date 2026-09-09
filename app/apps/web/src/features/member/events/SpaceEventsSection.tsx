import { useState } from 'react';
import { Button, Chip, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { useCanOpenStudio } from '../viewer.js';
import { EventSummaryCard } from './EventSummaryCard.js';

const PAGE_SIZE = 5;

type Scope = 'upcoming' | 'past';

export const SpaceEventsSection = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const [scope, setScope] = useState<Scope>('upcoming');
  const staff = useCanOpenStudio();
  const upcoming = useQuery(actions.spaceEvents({ spaceId, scope: 'upcoming', limit: PAGE_SIZE }));
  const past = useQuery(actions.spaceEvents({ spaceId, scope: 'past', limit: PAGE_SIZE }));
  const empty = upcoming.isSuccess && past.isSuccess &&
    upcoming.data.events.length === 0 && past.data.events.length === 0;
  const events = scope === 'upcoming' ? upcoming : past;

  if (empty && !staff) return null;

  const scopeChip = (value: Scope, label: string) => (
    <Chip
      size="small"
      variant={scope === value ? 'filled' : 'outlined'}
      color={scope === value ? 'primary' : 'default'}
      aria-pressed={scope === value}
      label={label}
      data-testid={`space-events-scope-${value}`}
      onClick={() => setScope(value)}
    />
  );

  return (
    <SectionCard
      title={t.events.sectionTitle}
      headerActions={
        <>
          {scopeChip('upcoming', t.events.upcoming)}
          {scopeChip('past', t.events.past)}
        </>
      }
      data-testid="space-events"
    >
      {events.isPending ? (
        <StatusView surface={false} state={{ kind: 'loading', label: t.events.loading }} />
      ) : events.isError ? (
        <StatusView
          surface={false}
          state={{
            kind: 'error',
            message: localizeError(events.error, t),
            retry: { label: t.common.retry, onRetry: () => void events.refetch() },
          }}
        />
      ) : events.data.events.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="space-events-empty">
          {scope === 'upcoming' ? t.events.emptyUpcoming : t.events.emptyPast}
        </Typography>
      ) : (
        <Stack useFlexGap sx={{ rowGap: '0.75rem' }}>
          {events.data.events.map((event) => (
            <EventSummaryCard key={event.id} event={event} />
          ))}
        </Stack>
      )}
      {empty && staff ? (
        <Button
          component={Link}
          to={`/panel/spaces/${encodeURIComponent(spaceId)}/events/new`}
          variant="text"
          data-testid="space-events-add"
        >
          {t.events.addEvent}
        </Button>
      ) : null}
    </SectionCard>
  );
};
