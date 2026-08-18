import { Box, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { useTranslations } from '../../../i18n/index.js';
import { EventSummaryCard } from './EventSummaryCard.js';

const STRIP_LIMIT = 4;

export const UpcomingEventsStrip = () => {
  const t = useTranslations();
  const upcoming = useQuery(actions.upcomingEvents(STRIP_LIMIT));
  const events = upcoming.data?.events ?? [];

  if (events.length === 0) return null;

  return (
    <Box component="section" data-testid="start-upcoming-events">
      <Typography variant="h3" component="h2" sx={{ mb: '0.9rem' }}>
        {t.events.upcomingHeading}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
        }}
      >
        {events.map((event) => (
          <EventSummaryCard key={event.id} event={event} />
        ))}
      </Box>
    </Box>
  );
};
