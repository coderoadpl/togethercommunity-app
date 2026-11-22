import { useEffect, useRef } from 'react';
import { Alert, Button, Divider, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { MetaCapiMemberConsent } from '#core/domain/index.js';
import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { AccountCard } from './AccountCard.js';

const ConsentRow = ({ consent, onWithdrawn }: { consent: MetaCapiMemberConsent; onWithdrawn: () => Promise<unknown> }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const statusText = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);
  const withdraw = useMutation({
    ...actions.metaCapi.withdraw,
    onSuccess: async () => {
      focusStatus.current = true;
      await onWithdrawn();
    },
  });
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
  return (
    <Stack spacing={1} data-testid="meta-capi-consent-row">
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
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
  if (consents.isPending || (consents.isSuccess && consents.data.consents.length === 0)) return null;
  const rows = consents.data?.consents ?? [];
  const withdrawable = rows.some((consent) => consent.consent === 'granted' && consent.withdrawnAt === null);
  return (
    <AccountCard title={t.metaCapi.privacyHeading} description={withdrawable ? t.metaCapi.withdrawHint : undefined}>
      {consents.isError ? <StatusView state={{ kind: 'error', message: localizeError(consents.error, t), retry: { label: t.common.retry, onRetry: () => void consents.refetch() } }} /> : null}
      {rows.length > 0 ? (
        <Stack spacing={2} divider={<Divider flexItem />}>
          {rows.map((consent) => <ConsentRow key={consent.orderId} consent={consent} onWithdrawn={consents.refetch} />)}
        </Stack>
      ) : null}
    </AccountCard>
  );
};
