import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import {
  isRedactedAuthEmailKind,
  type BounceClassification,
  type EmailDeliveryStatus,
  type EmailSendProjection,
  type EmailSendSourceKind,
  type EmailSendStatus,
  type MarketingAudienceContact,
  type Suppression,
} from '#core/domain/index.js';

import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

export const sendKindLabel = (kind: EmailSendProjection['kind'], t: Messages): string =>
  kind === 'marketing' ? t.marketing.kindMarketing : t.marketing.kindTransactional;

const sourceKindLabelKey: Record<EmailSendSourceKind, keyof Messages['marketing']['sourceKindLabels']> = {
  'auth-magic-link': 'authMagicLink',
  'auth-password-reset': 'authPasswordReset',
  'auth-email-verification': 'authEmailVerification',
  'welcome-sign-in': 'welcomeSignIn',
  'reset-password': 'resetPassword',
  'verify-email': 'verifyEmail',
  'magic-link': 'magicLink',
  'thread-reply': 'threadReply',
  'lesson-question': 'lessonQuestion',
  'space-post': 'spacePost',
  'direct-message': 'directMessage',
  'space-event': 'spaceEvent',
  'subscription-payment-failed': 'subscriptionPaymentFailed',
  'subscription-ended': 'subscriptionEnded',
  'support-message': 'supportMessage',
  'member-erasure-request': 'memberErasureRequest',
  'reputation-alert': 'reputationAlert',
  'marketing-consent-confirmation': 'marketingConsentConfirmation',
  'm2m-transactional': 'm2mTransactional',
  'marketing-campaign': 'marketingCampaign',
};

export const sourceKindLabel = (sourceKind: EmailSendSourceKind, t: Messages): string =>
  t.marketing.sourceKindLabels[sourceKindLabelKey[sourceKind]];

/** Redacted auth rows store the kind slug instead of a subject, so the panel localizes it. */
export const sendSubjectLabel = (send: EmailSendProjection, t: Messages): string =>
  isRedactedAuthEmailKind(send.sourceKind) ? sourceKindLabel(send.sourceKind, t) : send.subject;

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

export const sendStatusColor = (status: EmailSendStatus): 'success' | 'warning' | 'error' | 'default' =>
  status === 'sent' ? 'success' : status === 'failed' ? 'error' : status === 'sending' ? 'warning' : 'default';

export const deliveryStatusColor = (status: EmailDeliveryStatus | null): 'success' | 'warning' | 'error' | 'default' =>
  status === 'delivered' ? 'success' : status === 'bounced' ? 'error' : status === 'complained' ? 'warning' : 'default';

const localizedSkipReasons = [
  'suppressed',
  'unsubscribed',
  'not_consented',
  'pending_confirmation',
  'contact_archived',
  'contact_address_changed',
] as const satisfies readonly NonNullable<MarketingAudienceContact['skipReason']>[];

const localizedSuppressionReasons = [
  'hard_bounce',
  'complaint',
  'manual',
  'unsubscribe_global',
  'erasure',
] as const satisfies readonly Suppression['reason'][];

const localizedBounceClassifications = [
  'soft',
  'hard',
  'unresolved',
  'complaint',
] as const satisfies readonly BounceClassification[];

const isLocalizedSkipReason = (reason: string): reason is keyof Messages['marketing']['skipReasons'] =>
  localizedSkipReasons.some((key) => key === reason);

const isLocalizedSuppressionReason = (reason: string): reason is keyof Messages['marketing']['suppressionReasons'] =>
  localizedSuppressionReasons.some((key) => key === reason);

const isLocalizedBounceClassification = (classification: string): classification is keyof Messages['marketing']['bounceClassifications'] =>
  localizedBounceClassifications.some((key) => key === classification);

const skipReasonLabel = (reason: string, t: Messages): string =>
  isLocalizedSkipReason(reason) ? t.marketing.skipReasons[reason] : reason;

const suppressionReasonLabel = (reason: string, t: Messages): string =>
  isLocalizedSuppressionReason(reason) ? t.marketing.suppressionReasons[reason] : reason;

export const bounceClassificationLabel = (classification: string, t: Messages): string =>
  isLocalizedBounceClassification(classification) ? t.marketing.bounceClassifications[classification] : classification;

export const reasonLabel = (reason: string, t: Messages): { label: string; value: string } =>
  isLocalizedSuppressionReason(reason) || reason.startsWith('suppressed:')
    ? { label: t.marketing.suppressionReason, value: suppressionReasonLabel(reason, t) }
    : { label: t.marketing.skipReason, value: skipReasonLabel(reason, t) };

export const EmailSendSummary = ({ send }: { send: EmailSendProjection }) => {
  const t = useTranslations();
  const { language } = useLanguage();

  return (
    <Paper elevation={1} sx={{ p: '1rem' }} data-testid="member-email-send">
      <Stack useFlexGap spacing="0.75rem">
        <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={sendKindLabel(send.kind, t)} />
          <Chip size="small" variant="outlined" label={sourceKindLabel(send.sourceKind, t)} />
          <Chip size="small" color={sendStatusColor(send.status)} label={sendStatusLabel(send.status, t)} />
          <Typography variant="body2" color="text.secondary">
            {formatDateTime(send.sentAt ?? send.createdAt, language)}
          </Typography>
        </Stack>
        <Box>
          <Typography variant="subtitle1">{sendSubjectLabel(send, t)}</Typography>
          <Typography variant="body2" color="text.secondary">{send.recipient}</Typography>
        </Box>
        <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2">{deliveryStatusLabel(send.deliveryStatus, t)}</Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            component={Link}
            size="small"
            to={`/panel/marketing/sends/${encodeURIComponent(send.kind)}/${encodeURIComponent(send.id)}`}
          >
            {t.marketing.sendDetails}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
};
