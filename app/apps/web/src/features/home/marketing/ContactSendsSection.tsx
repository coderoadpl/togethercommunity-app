import { useState } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { EmailSendProjection } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryError, DirectoryPagination } from './DirectoryFields.js';
import { deliveryStatusColor, deliveryStatusLabel, sendStatusLabel } from './EmailSendSummary.js';

const localizedSkipReasons = [
  'suppressed',
  'unsubscribed',
  'not_consented',
  'pending_confirmation',
  'contact_archived',
  'contact_address_changed',
] as const;

const isLocalizedSkipReason = (reason: string): reason is keyof Messages['marketing']['skipReasons'] =>
  localizedSkipReasons.some((key) => key === reason);

const skipReasonLabel = (reason: string, t: Messages): string => {
  return isLocalizedSkipReason(reason) ? t.marketing.skipReasons[reason] : reason;
};

const sendHistoryDate = (send: EmailSendProjection, language: string): string =>
  formatDateTime(send.sentAt ?? send.createdAt, language);

export const ContactSendsSection = ({ contactId }: { contactId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { tenant } = usePanelContext();
  const [cursor, setCursor] = useState<string | undefined>();
  const sends = useQuery(actions.directory.contactSends(tenant.id, { contactId, kind: 'marketing', ...(cursor ? { cursor } : {}) }));
  return <SectionCard title={t.marketing.contactSends}>
    <DirectoryError error={sends.error} />
    {sends.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : null}
    {sends.data?.sends.length === 0 ? <Typography>{t.directory.noHistory}</Typography> : null}
    <Stack component="ul" useFlexGap spacing="0.5rem" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {sends.data?.sends.map((send) => <Stack
        key={send.id}
        component="li"
        data-testid="contact-send-row"
        direction="row"
        useFlexGap
        spacing="0.5rem"
        sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}
      >
        <Box sx={{ flex: '1 1 12rem', minWidth: 0 }}>
          <Link to="/panel/marketing/sends/$kind/$sendId" params={{ kind: 'marketing', sendId: send.id }}>{send.subject}</Link>
        </Box>
        {send.deliveryStatus === null
          ? <Chip size="small" variant="outlined" label={sendStatusLabel(send.status, t)} />
          : <Chip size="small" color={deliveryStatusColor(send.deliveryStatus)} label={deliveryStatusLabel(send.deliveryStatus, t)} />}
        <Typography variant="body2" color="text.secondary">{sendHistoryDate(send, language)}</Typography>
        {send.skipReason === null ? null : <Chip size="small" variant="outlined" label={`${t.marketing.skipReason}: ${skipReasonLabel(send.skipReason, t)}`} />}
      </Stack>)}
    </Stack>
    <DirectoryPagination cursor={cursor} nextCursor={sends.data?.nextCursor} onChange={setCursor} />
  </SectionCard>;
};
