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
import { z } from 'zod';

import type { EmailEvent } from '#core/domain/index.js';

import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTimeWithSeconds } from '../../../lib/format.js';
import { bounceClassificationLabel, reasonLabel } from '../marketing/EmailSendSummary.js';

const eventLabel = (event: EmailEvent, t: Messages): string => t.marketing.eventTypes[event.type];

const eventColor = (event: EmailEvent): 'success' | 'info' | 'warning' | 'error' | 'default' =>
  event.type === 'delivered'
    ? 'success'
    : event.type === 'opened' || event.type === 'clicked'
      ? 'info'
      : event.type === 'bounced' || event.type === 'complained' || event.type === 'failed'
      ? 'error'
      : event.type === 'suppressed_written'
        ? 'warning'
        : 'default';

const providerBounceRecipientSchema = z.object({
  diagnosticCode: z.string().min(1).optional(),
}).passthrough();

const directBouncePayloadSchema = z.object({
  bounceType: z.string().min(1).optional(),
  bounceSubType: z.string().min(1).optional(),
  diagnosticCode: z.string().min(1).optional(),
  bouncedRecipients: z.array(providerBounceRecipientSchema).optional(),
}).passthrough();

const nestedBouncePayloadSchema = z.object({
  bounce: directBouncePayloadSchema,
}).passthrough();

const stringMeta = (event: EmailEvent, key: string): string | null => {
  const value = event.meta?.[key];
  return typeof value === 'string' ? value : null;
};

const firstDiagnosticCode = (recipients: readonly z.output<typeof providerBounceRecipientSchema>[] | undefined): string | null =>
  recipients?.find((recipient) => recipient.diagnosticCode !== undefined)?.diagnosticCode ?? null;

const bounceProviderMeta = (event: EmailEvent): { type: string | null; subType: string | null; diagnosticCode: string | null } => {
  const rawProviderPayload = event.meta?.rawProviderPayload;
  const nested = nestedBouncePayloadSchema.safeParse(rawProviderPayload);
  if (nested.success) {
    return {
      type: nested.data.bounce.bounceType ?? null,
      subType: nested.data.bounce.bounceSubType ?? null,
      diagnosticCode: nested.data.bounce.diagnosticCode ?? firstDiagnosticCode(nested.data.bounce.bouncedRecipients),
    };
  }
  const direct = directBouncePayloadSchema.safeParse(rawProviderPayload);
  if (!direct.success) return { type: null, subType: null, diagnosticCode: null };
  return {
    type: direct.data.bounceType ?? null,
    subType: direct.data.bounceSubType ?? null,
    diagnosticCode: direct.data.diagnosticCode ?? firstDiagnosticCode(direct.data.bouncedRecipients),
  };
};

const salientMeta = (event: EmailEvent, t: Messages): Array<{ label: string; value: string }> => {
  const reason = stringMeta(event, 'reason');
  const classification = stringMeta(event, 'classification');
  const bounce = bounceProviderMeta(event);
  const values = [
    { label: t.marketing.sesMessageId, value: stringMeta(event, 'sesMessageId') },
    reason === null ? null : reasonLabel(reason, t),
    {
      label: t.marketing.bounceTypeLabel,
      value: classification === null ? null : bounceClassificationLabel(classification, t),
    },
    { label: t.marketing.bounceProviderType, value: bounce.type },
    { label: t.marketing.bounceSubType, value: bounce.subType },
    { label: t.marketing.diagnosticCode, value: bounce.diagnosticCode },
    { label: t.marketing.clickedLink, value: stringMeta(event, 'linkUrl') },
    { label: t.marketing.eventError, value: stringMeta(event, 'error') },
  ];
  return values.flatMap((value) => value === null || value.value === null ? [] : [{ label: value.label, value: value.value }]);
};

export const EmailEventTimeline = ({ events }: { events: EmailEvent[] }) => {
  const t = useTranslations();
  const { language } = useLanguage();

  if (events.length === 0) {
    return <Typography color="text.secondary">{t.marketing.eventsEmpty}</Typography>;
  }

  return (
    <Stack component="ol" aria-label={t.marketing.eventsTimeline} sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {events.map((event, index) => {
        const color = eventColor(event);
        return (
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
                <Chip
                  size="small"
                  color={color}
                  variant={color === 'default' ? 'outlined' : 'filled'}
                  label={eventLabel(event, t)}
                  sx={{ alignSelf: 'flex-start' }}
                />
                <Typography component="time" dateTime={event.occurredAt} variant="body2" color="text.secondary">
                  {formatDateTimeWithSeconds(event.occurredAt, language)}
                </Typography>
              </Stack>
              {salientMeta(event, t).map((item) => (
                <Typography key={item.label} variant="body2">
                  <Box component="span" color="text.secondary">{item.label}: </Box>
                  {item.value}
                </Typography>
              ))}
              {event.meta !== null && Object.keys(event.meta).length > 0 ? (
                <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
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
              ) : null}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
};
