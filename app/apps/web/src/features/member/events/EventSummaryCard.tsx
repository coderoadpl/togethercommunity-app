import { Box, Chip, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import { communityEventPath } from '#core/contract/index.js';
import type { PublicSpaceEvent } from '#core/domain/index.js';

import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { CourseCardRoot, FinePrint, PostMetaText } from '../../../theme.js';
import { formatEventRange } from './event-time.js';

export const EventSummaryCard = ({ event }: { event: PublicSpaceEvent }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return (
    <CourseCardRoot
      component={Link}
      to={communityEventPath(event.spaceId, event.id)}
      data-testid={`event-card-${event.id}`}
    >
      <Box sx={{ p: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', flexGrow: 1 }}>
        <Stack direction="row" useFlexGap sx={{ columnGap: '0.5rem', alignItems: 'center' }}>
          <Typography variant="h3" component="h3">
            {event.title}
          </Typography>
          {event.liveNow ? (
            <Chip
              size="small"
              color="error"
              label={t.events.liveBadge}
              data-testid={`event-card-live-${event.id}`}
            />
          ) : null}
        </Stack>
        <PostMetaText component="time" dateTime={event.startsAt}>
          {formatEventRange(event.startsAt, event.endsAt, language)}
        </PostMetaText>
        <Stack direction="row" useFlexGap sx={{ columnGap: '0.75rem', flexWrap: 'wrap', marginTop: 'auto' }}>
          <FinePrint component="span" data-testid={`event-card-going-${event.id}`}>
            {t.events.goingCount({ count: event.goingCount })}
          </FinePrint>
          {event.location === null ? null : (
            <FinePrint component="span">{event.location}</FinePrint>
          )}
        </Stack>
      </Box>
    </CourseCardRoot>
  );
};
