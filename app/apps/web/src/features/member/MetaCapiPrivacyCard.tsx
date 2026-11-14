import { Alert, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { AccountCard } from './AccountCard.js';

export const MetaCapiPrivacyCard = () => {
  const t = useTranslations();
  const consents = useQuery(actions.metaCapi.consents);
  const withdraw = useMutation({
    ...actions.metaCapi.withdraw,
    onSuccess: async () => { await consents.refetch(); },
  });
  if (consents.isPending || (consents.isSuccess && consents.data.consents.length === 0)) return null;
  return (
    <AccountCard title={t.metaCapi.privacyHeading} description={t.metaCapi.withdrawHint}>
      {consents.isError ? <StatusView state={{ kind: 'error', message: localizeError(consents.error, t), retry: { label: t.common.retry, onRetry: () => void consents.refetch() } }} /> : null}
      {consents.data?.consents.map((consent) => (
        <Stack key={consent.orderId} spacing={1}>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{t.metaCapi.order({ id: consent.orderId })}</Typography>
          <Typography variant="body2">{consent.withdrawnAt !== null ? t.metaCapi.withdrawn : t.metaCapi[consent.consent]}</Typography>
          {consent.consent === 'granted' && consent.withdrawnAt === null ? <Button variant="outlined" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ orderId: consent.orderId })}>{t.metaCapi.withdraw}</Button> : null}
        </Stack>
      ))}
      {withdraw.isError ? <Alert severity="error">{localizeError(withdraw.error, t)}</Alert> : null}
    </AccountCard>
  );
};
