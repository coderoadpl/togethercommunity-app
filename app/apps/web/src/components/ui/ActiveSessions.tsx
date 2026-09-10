import type { ComponentType } from 'react';
import type { AccountSectionProps } from './AccountSection.js';
import { ChevronDownIcon, MonitorIcon } from './account-icons.js';
import { useEffect, useId, useRef, useState } from 'react';
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
  useMediaQuery,
  useTheme,
} from '@mui/material';

import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/format.js';
import { AccountSessionDisclosure, AccountSessionRow } from '../../theme.js';
import { AccountSection } from './AccountSection.js';
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
  Card?: ComponentType<AccountSectionProps>;
  presentation?: 'account' | 'embedded';
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
  presentation = 'account',
  Card = AccountSection,
  sessions,
  revokeSession,
  revokeOtherSessions,
}: ActiveSessionsProps) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [waiting, setWaiting] = useState(false);
  const t = useTranslations();
  const { language } = useLanguage();
  const [pendingRevoke, setPendingRevoke] = useState<PendingRevoke | null>(null);
  const confirmTitleId = useId();
  const contentId = useId();
  const [expanded, setExpanded] = useState(presentation === 'embedded');
  const [confirmedRevoke, setConfirmedRevoke] = useState(false);
  const summaryRef = useRef<HTMLButtonElement>(null);
  const rows = [...(sessions.data ?? [])].sort((left, right) => Number(right.current) - Number(left.current));
  const currentSession = rows.find((session) => session.current);
  const otherCount = rows.filter((session) => !session.current).length;
  const revokingOthers = pendingRevoke?.kind === 'others';

  const operation = revokingOthers ? revokeOtherSessions : revokeSession;
  useEffect(() => {
    if (operation.pending) setWaiting(true);
    else if (waiting) {
      setWaiting(false);
      if (operation.success) { setPendingRevoke(null); setConfirmedRevoke(true); }
    }
  }, [operation.pending, operation.success, waiting]);

  const confirmRevoke = () => {
    if (pendingRevoke === null) return;
    if (pendingRevoke.kind === 'others') revokeOtherSessions.run();
    else revokeSession.run({ sessionId: pendingRevoke.sessionId });

  };

  return (
    <Box>
    <Card icon={<MonitorIcon />} title={presentation === 'embedded' ? t.security.sessionsHeading : (
      <AccountSessionDisclosure ref={summaryRef} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)} data-testid="active-sessions-disclosure">
        <Typography component="span" variant="h2">{t.security.sessionsHeading}</Typography>
        <Chip size="small" variant="outlined" aria-label={sessions.pending || sessions.error || sessions.data === undefined ? undefined : t.security.sessionsSummary({ count: rows.length })} label={sessions.pending ? t.security.sessionsLoading : sessions.error || sessions.data === undefined ? t.security.sessionsUnavailable : String(rows.length)} />
        <ChevronDownIcon />
      </AccountSessionDisclosure>
    )} description={currentSession && presentation === 'account' ? `${t.security.sessionCurrent}: ${summarizeUserAgent(currentSession.userAgent) ?? t.security.sessionUnknownDevice}` : undefined}>
    <Box data-testid="active-sessions">
      <Box id={contentId} hidden={!expanded}>
        {expanded ? <Stack useFlexGap spacing="1rem" sx={{ mt: '1rem' }}>
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
        <AccountSessionRow
          key={session.id}
          data-current={session.current}
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          spacing="0.6rem"
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          data-testid={`session-${session.id}`}
        >
          <Box>
            <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <MonitorIcon />
              <Typography variant="body2">
                {summarizeUserAgent(session.userAgent) ?? t.security.sessionUnknownDevice}
              </Typography>
              {session.current ? (
                <Chip size="small" variant="outlined" label={t.security.sessionCurrent} />
              ) : null}
            </Stack>
            <Typography variant="caption" component="p">
              {t.security.sessionLastActiveAt({
                date: formatDateTime(session.lastActiveAt, language),
              })}
            </Typography>
            <Typography variant="caption" component="p">
              {t.security.sessionSignedInAt({ date: formatDateTime(session.createdAt, language) })}
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
        </AccountSessionRow>
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
        </Stack> : null}
      </Box>
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
        fullScreen={fullScreen}
        fullWidth maxWidth="sm"
        disableRestoreFocus={confirmedRevoke && presentation === 'account'}
        slotProps={{ transition: { onExited: () => {
          if (confirmedRevoke) summaryRef.current?.focus();
          setConfirmedRevoke(false);
        } } }}
        open={pendingRevoke !== null}
        onClose={() => { if (!operation.pending) setPendingRevoke(null); }}
        aria-labelledby={confirmTitleId}
        data-testid="revoke-sessions-confirm"
      >
        <DialogTitle id={confirmTitleId}>
          {revokingOthers
            ? t.security.sessionsRevokeOthersConfirmTitle
            : t.security.sessionRevokeConfirmTitle}
        </DialogTitle>
        <DialogContent sx={{ flex: '0 1 auto' }}>
          <Typography variant="body2">
            {revokingOthers
              ? t.security.sessionsRevokeOthersConfirmBody
              : t.security.sessionRevokeConfirmBody}
          </Typography>
          {operation.error ? <Alert severity="error">{localizeError(operation.error, t)}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button
            variant="text"
            disabled={operation.pending}
            data-testid="revoke-sessions-confirm-cancel"
            onClick={() => setPendingRevoke(null)}
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={operation.pending}
            data-testid="revoke-sessions-confirm-accept"
            onClick={confirmRevoke}
          >
            {revokingOthers ? t.security.sessionsRevokeOthers : t.security.sessionRevoke}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
    </Card>
    </Box>
  );
};
