import { useState } from 'react';
import { Chip, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { EventSummaryCard } from './EventSummaryCard.js';

const PAGE_SIZE = 5;

type Scope = 'upcoming' | 'past';

export const SpaceEventsSection = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const [scope, setScope] = useState<Scope>('upcoming');
  const events = useQuery({
    ...actions.spaceEvents({ spaceId, scope, limit: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

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
    </SectionCard>
  );
};
