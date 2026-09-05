import { useId, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';

import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/format.js';
import { Eyebrow } from '../../theme.js';
import { summarizeUserAgent } from './user-agent.js';

interface OperationState {
  pending: boolean;
  success: boolean;
  error: Error | null;
}

type PendingRevoke = { kind: 'session'; sessionId: string } | { kind: 'others' };

interface SessionRow {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  userAgent: string | null;
  current: boolean;
}

export interface ActiveSessionsProps {
  sessions: {
    data: SessionRow[] | undefined;
    pending: boolean;
    error: Error | null;
    retry(): void;
  };
  revokeSession: OperationState & {
    run(input: { sessionId: string }): void;
  };
  revokeOtherSessions: OperationState & {
    run(): void;
  };
}

export const ActiveSessions = ({
  sessions,
  revokeSession,
  revokeOtherSessions,
}: ActiveSessionsProps) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [pendingRevoke, setPendingRevoke] = useState<PendingRevoke | null>(null);
  const confirmTitleId = useId();
  const rows = sessions.data ?? [];
  const otherCount = rows.filter((session) => !session.current).length;
  const revokingOthers = pendingRevoke?.kind === 'others';

  const confirmRevoke = () => {
    if (pendingRevoke === null) return;
    if (pendingRevoke.kind === 'others') revokeOtherSessions.run();
    else revokeSession.run({ sessionId: pendingRevoke.sessionId });
    setPendingRevoke(null);
  };

  return (
    <Box component="section" sx={{ display: 'grid', gap: '0.8rem' }} data-testid="active-sessions">
      <Eyebrow variant="overline" component="h3">
        {t.security.sessionsHeading}
      </Eyebrow>
      <Typography variant="body2">{t.security.sessionsIntro}</Typography>
      {sessions.pending ? (
        <Typography variant="body2">{t.security.sessionsLoading}</Typography>
      ) : null}
      {sessions.data !== undefined && rows.length === 0 ? (
        <Typography variant="body2" data-testid="sessions-empty">
          {t.security.sessionsEmpty}
        </Typography>
      ) : null}
      {rows.map((session) => (
        <Stack
          key={session.id}
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          spacing="0.6rem"
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          data-testid={`session-${session.id}`}
        >
          <Box>
            <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center' }}>
              <Typography variant="body2">
                {summarizeUserAgent(session.userAgent) ?? t.security.sessionUnknownDevice}
              </Typography>
              {session.current ? (
                <Chip size="small" variant="outlined" label={t.security.sessionCurrent} />
              ) : null}
            </Stack>
            <Typography variant="caption" component="p">
              {t.security.sessionSignedInAt({ date: formatDateTime(session.createdAt, language) })}
            </Typography>
            <Typography variant="caption" component="p">
              {t.security.sessionLastActiveAt({
                date: formatDateTime(session.lastActiveAt, language),
              })}
            </Typography>
          </Box>
          {session.current ? null : (
            <Button
              size="small"
              color="error"
              disabled={revokeSession.pending}
              onClick={() => setPendingRevoke({ kind: 'session', sessionId: session.id })}
            >
              {revokeSession.pending ? t.security.sessionRevoking : t.security.sessionRevoke}
            </Button>
          )}
        </Stack>
      ))}
      {otherCount > 0 ? (
        <Box>
          <Button
            type="button"
            variant="outlined"
            color="error"
            data-testid="revoke-other-sessions"
            disabled={revokeOtherSessions.pending}
            onClick={() => setPendingRevoke({ kind: 'others' })}
          >
            {revokeOtherSessions.pending
              ? t.security.sessionsRevokingOthers
              : t.security.sessionsRevokeOthers}
          </Button>
        </Box>
      ) : null}
      {revokeSession.success ? (
        <Typography variant="caption" data-testid="session-revoked">
          {t.security.sessionRevoked}
        </Typography>
      ) : null}
      {revokeOtherSessions.success ? (
        <Typography variant="caption" data-testid="other-sessions-revoked">
          {t.security.sessionsOthersRevoked}
        </Typography>
      ) : null}
      {revokeSession.error ? (
        <Alert severity="error">{localizeError(revokeSession.error, t)}</Alert>
      ) : null}
      {revokeOtherSessions.error ? (
        <Alert severity="error">{localizeError(revokeOtherSessions.error, t)}</Alert>
      ) : null}
      {sessions.error ? (
        <Box>
          <Alert severity="error">{localizeError(sessions.error, t)}</Alert>
          <Button size="small" sx={{ mt: '0.5rem' }} onClick={sessions.retry}>
            {t.common.retry}
          </Button>
        </Box>
      ) : null}
      <Dialog
        open={pendingRevoke !== null}
        onClose={() => setPendingRevoke(null)}
        aria-labelledby={confirmTitleId}
        data-testid="revoke-sessions-confirm"
      >
        <DialogTitle id={confirmTitleId}>
          {revokingOthers
            ? t.security.sessionsRevokeOthersConfirmTitle
            : t.security.sessionRevokeConfirmTitle}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {revokingOthers
              ? t.security.sessionsRevokeOthersConfirmBody
              : t.security.sessionRevokeConfirmBody}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            variant="text"
            data-testid="revoke-sessions-confirm-cancel"
            onClick={() => setPendingRevoke(null)}
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="contained"
            color="error"
            data-testid="revoke-sessions-confirm-accept"
            onClick={confirmRevoke}
          >
            {revokingOthers ? t.security.sessionsRevokeOthers : t.security.sessionRevoke}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
