import { useEffect, useRef } from 'react';
import { Alert, Button } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { navigateFresh } from '../../../lib/navigation.js';
import { useImpersonation } from '../viewer.js';

export const ImpersonationBanner = ({ panelUrl = '/panel/members' }: { panelUrl?: string }) => {
  const t = useTranslations();
  const impersonation = useImpersonation();
  const wasActive = useRef(false);
  const banner = useRef<HTMLDivElement>(null);
  const announced = useRef(false);
  // Entering the view is a full navigation, so the banner is present at mount and
  // a live region would announce nothing; focus is what carries it to the reader.
  useEffect(() => {
    if (impersonation === null || announced.current) return;
    announced.current = true;
    banner.current?.focus();
  }, [impersonation]);
  const queryClient = useQueryClient();
  const expiresAt = impersonation?.expiresAt ?? null;
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setTimeout(
      () => void queryClient.invalidateQueries(actions.meInvalidates()),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => { clearTimeout(timer); };
  }, [expiresAt, queryClient]);
  const stop = useMutation({
    ...actions.stopImpersonation,
    onSuccess: () => navigateFresh(panelUrl),
  });

  if (impersonation === null) {
    if (!wasActive.current || stop.isSuccess) return null;
    return (
      <Alert
        severity="info"
        role="status"
        data-testid="impersonation-expired"
        action={<Button color="inherit" size="small" href={panelUrl}>{t.shell.impersonationExit}</Button>}
      >
        {t.shell.impersonationExpired}
      </Alert>
    );
  }

  wasActive.current = true;

  return (
    <Alert
      ref={banner}
      severity="warning"
      role="region"
      tabIndex={-1}
      aria-label={t.shell.impersonationRegionLabel}
      data-testid="impersonation-banner"
      action={
        <Button
          color="inherit"
          size="small"
          disabled={stop.isPending}
          data-testid="impersonation-exit"
          onClick={() => stop.mutate(undefined)}
        >
          {stop.isPending ? t.shell.impersonationExiting : t.shell.impersonationExit}
        </Button>
      }
    >
      {t.shell.impersonationBanner({ name: impersonation.subjectName })}
      {' — '}
      {t.shell.impersonationReadOnlyHint}
      {stop.isError ? ` — ${localizeError(stop.error, t)}` : null}
    </Alert>
  );
};
