import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';

import type {
  EmailDeliveryStatus,
  EmailSendProjection,
  EmailSendStatus,
} from '@core/domain/index.js';

import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

export const sendKindLabel = (kind: EmailSendProjection['kind'], t: Messages): string =>
  kind === 'marketing' ? t.marketing.kindMarketing : t.marketing.kindTransactional;

export const sendStatusLabel = (status: EmailSendStatus, t: Messages): string => ({
  queued: t.marketing.statusQueued,
  pending: t.marketing.statusPending,
  sending: t.marketing.statusSending,
  sent: t.marketing.statusSent,
  failed: t.marketing.statusFailed,
  skipped: t.marketing.statusSkipped,
})[status];

export const deliveryStatusLabel = (status: EmailDeliveryStatus | null, t: Messages): string => status === null
  ? t.marketing.noDeliveryStatus
  : {
      delivered: t.marketing.deliveryDelivered,
      bounced: t.marketing.deliveryBounced,
      complained: t.marketing.deliveryComplained,
    }[status];

const statusColor = (status: EmailSendStatus): 'success' | 'warning' | 'error' | 'default' =>
  status === 'sent' ? 'success' : status === 'failed' ? 'error' : status === 'sending' ? 'warning' : 'default';

export const EmailSendSummary = ({ send }: { send: EmailSendProjection }) => {
  const t = useTranslations();
  const { language } = useLanguage();

  return (
    <Paper elevation={1} sx={{ p: '1rem' }} data-testid="member-email-send">
      <Stack useFlexGap spacing="0.75rem">
        <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={sendKindLabel(send.kind, t)} />
          <Chip size="small" color={statusColor(send.status)} label={sendStatusLabel(send.status, t)} />
          <Typography variant="body2" color="text.secondary">
            {formatDateTime(send.sentAt ?? send.createdAt, language)}
          </Typography>
        </Stack>
        <Box>
          <Typography variant="subtitle1">{send.subject}</Typography>
          <Typography variant="body2" color="text.secondary">{send.recipient}</Typography>
        </Box>
        <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2">{deliveryStatusLabel(send.deliveryStatus, t)}</Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            component="a"
            size="small"
            href={`/panel/marketing/sends/${send.kind}/${encodeURIComponent(send.id)}`}
          >
            {t.marketing.sendDetails}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
};
