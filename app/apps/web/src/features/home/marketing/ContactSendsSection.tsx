import { useState } from 'react';
import { Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryError, DirectoryPagination } from './DirectoryFields.js';
import { sendStatusLabel } from './EmailSendSummary.js';

export const ContactSendsSection = ({ contactId }: { contactId: string }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const [cursor, setCursor] = useState<string | undefined>();
  const sends = useQuery(actions.directory.contactSends(tenant.id, { contactId, kind: 'marketing', ...(cursor ? { cursor } : {}) }));
  return <SectionCard title={t.marketing.contactSends}>
    <DirectoryError error={sends.error} />
    {sends.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : null}
    {sends.data?.sends.length === 0 ? <Typography>{t.directory.noHistory}</Typography> : null}
    {sends.data?.sends.map((send) => <Typography key={send.id}><Link to="/panel/marketing/sends/$kind/$sendId" params={{ kind: 'marketing', sendId: send.id }}>{send.subject}</Link> · {sendStatusLabel(send.status, t)}{send.skipReason ? ` · ${send.skipReason}` : ''}</Typography>)}
    <DirectoryPagination cursor={cursor} nextCursor={sends.data?.nextCursor} onChange={setCursor} />
  </SectionCard>;
};
