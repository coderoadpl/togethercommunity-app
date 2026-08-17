import { Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { EventSummaryCard } from './EventSummaryCard.js';

const PAGE_SIZE = 5;

export const PublicSpaceEventsSection = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const events = useQuery(actions.publicSpaceEvents({ spaceId, scope: 'upcoming', limit: PAGE_SIZE }));

  return (
    <SectionCard title={t.events.sectionTitle} data-testid="public-space-events">
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
        <Typography variant="body2" color="text.secondary" data-testid="public-space-events-empty">
          {t.events.emptyUpcoming}
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
