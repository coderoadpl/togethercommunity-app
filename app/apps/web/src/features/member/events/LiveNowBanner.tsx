import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { communityEventPath } from '#core/contract/index.js';

import { actions } from '../../../api.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { PostMetaText } from '../../../theme.js';
import { formatEventRange } from './event-time.js';

const BANNER_LIMIT = 20;

export const LiveNowBanner = ({ spaceId }: { spaceId: string | null }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const upcoming = useQuery(actions.upcomingEvents(BANNER_LIMIT));
  const live = (upcoming.data?.events ?? []).filter(
    (event) => event.liveNow && (spaceId === null || event.spaceId === spaceId),
  );

  if (live.length === 0) return null;

  return (
    <Stack useFlexGap sx={{ rowGap: '0.75rem' }} data-testid="live-now-banner">
      {live.map((event) => (
        <Paper
          key={event.id}
          elevation={1}
          sx={{
            p: '1.1rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
          data-testid={`live-now-${event.id}`}
        >
          <Box>
            <Chip
              size="small"
              color="error"
              label={t.events.liveNow}
              sx={{ mb: '0.4rem' }}
              data-testid={`live-now-badge-${event.id}`}
            />
            <Typography variant="h3" component="h2">
              {event.title}
            </Typography>
            <PostMetaText component="time" dateTime={event.startsAt}>
              {formatEventRange(event.startsAt, event.endsAt, language)}
            </PostMetaText>
          </Box>
          <Button
            component={Link}
            to={communityEventPath(event.spaceId, event.id)}
            variant="contained"
            data-testid={`live-now-join-${event.id}`}
          >
            {t.events.liveJoin}
          </Button>
        </Paper>
      ))}
    </Stack>
  );
};
