import { useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { EntryDate } from '../../../theme.js';

export const ImpersonationActivitySection = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const events = useQuery(actions.tenantAuditEvents(cursor === undefined ? {} : { cursor }));

  return (
    <SectionCard
      title={t.members.impersonationLogHeading}
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
            data-testid="impersonation-log-next"
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
        <StatusView state={{ kind: 'empty', title: t.members.impersonationLogEmpty }} />
      ) : (
        <Stack useFlexGap spacing="0.5rem" data-testid="impersonation-log">
          {events.data.events.map((event) => (
            <Typography key={event.id} variant="body2">
              <EntryDate component="time" dateTime={event.at}>
                {formatDateTime(event.at, language)}
              </EntryDate>
              {' · '}
              {event.kind === 'impersonation_started'
                ? t.members.impersonationLogStarted
                : t.members.impersonationLogEnded}
              {' · '}
              {t.members.impersonationLogEntry({
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
