import { useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { EntryDate } from '../../../theme.js';

export const TenantAuditLogSection = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const events = useQuery(actions.tenantAuditEvents(cursor === undefined ? {} : { cursor }));

  return (
    <SectionCard
      title={t.members.auditLogHeading}
      actions={events.data === undefined ? undefined : (
        <>
          <Button
            disabled={previousCursors.length === 0}
            onClick={() => {
              setCursor(previousCursors.at(-1));
              setPreviousCursors(previousCursors.slice(0, -1));
            }}
          >
            {t.pagination.previousPage}
          </Button>
          <Button
            data-testid="audit-log-next"
            disabled={events.data.nextCursor === null}
            onClick={() => {
              const next = events.data.nextCursor;
              if (next === null) return;
              setPreviousCursors((history) => [...history, cursor]);
              setCursor(next);
            }}
          >
            {t.pagination.nextPage}
          </Button>
        </>
      )}
    >
      {events.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.common.loading }} />
      ) : events.isError ? (
        <StatusView
          state={{
            kind: 'error',
            message: localizePanelError(events.error, t),
            retry: { label: t.common.retry, onRetry: () => void events.refetch() },
          }}
        />
      ) : events.data.events.length === 0 ? (
        <StatusView state={{ kind: 'empty', title: t.members.auditLogEmpty }} />
      ) : (
        <Stack useFlexGap spacing="0.5rem" data-testid="audit-log">
          {events.data.events.map((event) => (
            <Typography key={event.id} variant="body2">
              <EntryDate component="time" dateTime={event.at}>
                {formatDateTime(event.at, language)}
              </EntryDate>
              {' · '}
              {t.members.auditLogKind[event.kind]}
              {' · '}
              {event.subjectMemberId === null
                ? event.actorEmail
                : t.members.auditLogEntry({
                    actor: event.actorEmail,
                    subject: event.subjectLabel ?? t.members.deletedBadge,
                  })}
              {event.reason === null ? null : ` · ${event.reason}`}
            </Typography>
          ))}
        </Stack>
      )}
    </SectionCard>
  );
};
