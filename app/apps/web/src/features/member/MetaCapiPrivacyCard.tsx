import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Divider, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { MetaCapiMemberConsent } from '#core/domain/index.js';
import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { AccountCard } from './AccountCard.js';

const emptyNotice = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' } as const;

const ConsentRow = ({ consent, onWithdrawn }: { consent: MetaCapiMemberConsent; onWithdrawn: (orderId: string, title: string) => Promise<boolean> }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const statusText = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);
  const withdrawn = consent.withdrawnAt !== null;
  useEffect(() => {
    if (!withdrawn || !focusStatus.current) return;
    focusStatus.current = false;
    statusText.current?.focus();
  }, [withdrawn]);
  const day = (value: string) => new Date(value).toLocaleDateString(language);
  const title = consent.productName === null ? t.metaCapi.order({ id: consent.orderId })
    : consent.purchasedAt === null ? consent.productName
      : t.metaCapi.purchase({ product: consent.productName, date: day(consent.purchasedAt) });
  const [label, at] = withdrawn ? [t.metaCapi.rowWithdrawn, consent.withdrawnAt]
    : consent.consent === 'granted' ? [t.metaCapi.rowGranted, consent.consentAt] : [t.metaCapi.rowDenied, consent.consentAt];
  const active = consent.consent === 'granted' && !withdrawn;
  const withdraw = useMutation({
    ...actions.metaCapi.withdraw,
    onSuccess: async () => {
      focusStatus.current = await onWithdrawn(consent.orderId, title);
    },
  });
  return (
    <Stack component="li" spacing={1} data-testid="meta-capi-consent-row">
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography component="p" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
          <Typography ref={statusText} variant="body2" color="text.secondary" role="status" tabIndex={-1}>
            {at === null ? label : `${label} · ${day(at)}`}
          </Typography>
        </Stack>
        {active ? (
          <Button variant="outlined" size="small" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ orderId: consent.orderId })} sx={{ flexShrink: 0 }}>
            {withdraw.isPending ? t.metaCapi.withdrawing : t.metaCapi.withdrawShort}
          </Button>
        ) : null}
      </Stack>
      {withdraw.isError && !withdrawn ? <Alert severity="error">{localizeError(withdraw.error, t)}</Alert> : null}
    </Stack>
  );
};

export const MetaCapiPrivacyCard = () => {
  const t = useTranslations();
  const consents = useQuery(actions.metaCapi.consents);
  const [notice, setNotice] = useState<{ text: string; seq: number } | null>(null);
  const noticeText = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice !== null) noticeText.current?.focus();
  }, [notice]);
  const withdrawn = async (orderId: string, title: string) => {
    const refreshed = await consents.refetch();
    const row = refreshed.data?.consents.find((consent) => consent.orderId === orderId);
    if (row !== undefined && row.withdrawnAt !== null) return true;
    setNotice((previous) => ({ text: t.metaCapi.withdrawnNotice({ title }), seq: (previous?.seq ?? 0) + 1 }));
    return false;
  };
  if (consents.isPending || (consents.isSuccess && consents.data.consents.length === 0 && notice === null)) return null;
  const rows = consents.data?.consents ?? [];
  const withdrawable = rows.some((consent) => consent.consent === 'granted' && consent.withdrawnAt === null);
  return (
    <AccountCard title={t.metaCapi.privacyHeading} description={withdrawable ? t.metaCapi.withdrawHint : undefined}>
      <Typography ref={noticeText} variant="body2" role="status" tabIndex={-1} data-testid="meta-capi-withdrawn-notice" sx={notice === null ? emptyNotice : undefined}>
        {notice?.text ?? ''}
      </Typography>
      {consents.isError ? <StatusView state={{ kind: 'error', message: localizeError(consents.error, t), retry: { label: t.common.retry, onRetry: () => void consents.refetch() } }} /> : null}
      {rows.length > 0 ? (
        <Stack component="ul" spacing={2} divider={<Divider component="li" aria-hidden flexItem />} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {rows.map((consent) => <ConsentRow key={consent.orderId} consent={consent} onWithdrawn={withdrawn} />)}
        </Stack>
      ) : null}
    </AccountCard>
  );
};
