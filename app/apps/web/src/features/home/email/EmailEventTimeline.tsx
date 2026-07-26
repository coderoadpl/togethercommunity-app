import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material';

import type { EmailEvent } from '@core/domain/index.js';

import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

const eventLabel = (event: EmailEvent, t: Messages): string => t.marketing.eventTypes[event.type];

const stringMeta = (event: EmailEvent, key: string): string | null => {
  const value = event.meta?.[key];
  return typeof value === 'string' ? value : null;
};

const salientMeta = (event: EmailEvent, t: Messages): Array<{ label: string; value: string }> => {
  const values = [
    { label: t.marketing.sesMessageId, value: stringMeta(event, 'sesMessageId') },
    { label: t.marketing.skipReason, value: stringMeta(event, 'reason') },
    { label: t.marketing.bounceClassification, value: stringMeta(event, 'classification') },
    { label: t.marketing.eventError, value: stringMeta(event, 'error') },
  ];
  return values.flatMap((value) => value.value === null ? [] : [{ label: value.label, value: value.value }]);
};

export const EmailEventTimeline = ({ events }: { events: EmailEvent[] }) => {
  const t = useTranslations();
  const { language } = useLanguage();

  if (events.length === 0) {
    return <Typography color="text.secondary">{t.marketing.eventsEmpty}</Typography>;
  }

  return (
    <Stack component="ol" aria-label={t.marketing.eventsTimeline} sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {events.map((event, index) => (
        <Box
          component="li"
          key={event.id}
          data-testid="email-event"
          sx={{
            position: 'relative',
            pl: '2rem',
            pb: index === events.length - 1 ? 0 : '1.5rem',
          }}
        >
          {index === events.length - 1 ? null : (
            <Divider
              orientation="vertical"
              sx={{ position: 'absolute', left: '0.45rem', top: '1rem', bottom: 0 }}
            />
          )}
          <Avatar sx={{ position: 'absolute', left: 0, top: '0.35rem', width: '0.9rem', height: '0.9rem' }}>
            {' '}
          </Avatar>
          <Stack useFlexGap spacing="0.65rem">
            <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem" sx={{ alignItems: { sm: 'center' } }}>
              <Chip size="small" variant="outlined" label={eventLabel(event, t)} sx={{ alignSelf: 'flex-start' }} />
              <Typography component="time" dateTime={event.occurredAt} variant="body2" color="text.secondary">
                {formatDateTime(event.occurredAt, language)}
              </Typography>
            </Stack>
            {salientMeta(event, t).map((item) => (
              <Typography key={item.label} variant="body2">
                <Box component="span" color="text.secondary">{item.label}: </Box>
                {item.value}
              </Typography>
            ))}
            <Accordion disableGutters elevation={0}>
              <AccordionSummary sx={{ minHeight: 0, px: 0, '& .MuiAccordionSummary-content': { my: 0 } }}>
                <Typography variant="body2" color="primary">{t.marketing.rawMeta}</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 0, pb: 0 }}>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: '0.75rem',
                    overflowX: 'auto',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {JSON.stringify(event.meta, null, 2)}
                </Box>
              </AccordionDetails>
            </Accordion>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
};
