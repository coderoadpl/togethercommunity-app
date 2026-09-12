import { useState } from 'react';
import { Alert, Button, FormControl, FormLabel, MenuItem, OutlinedInput, Select, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { ConfirmDialog } from '../../../components/layout/index.js';
import { adoptionRefusalOf, localizePanelError, useTranslations } from '../../../i18n/index.js';

export const AdoptStripeSubscriptionDialog = ({ memberId, onAdopted }: {
  memberId: string;
  onAdopted: () => Promise<void>;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [subscriptionId, setSubscriptionId] = useState('');
  const [productId, setProductId] = useState('');
  const products = useQuery({ ...actions.products, enabled: open });
  const adopt = useMutation({
    ...actions.adoptStripeSubscription,
    onSuccess: async () => {
      setOpen(false);
      setSubscriptionId('');
      setProductId('');
      await Promise.all([
        onAdopted(),
        queryClient.invalidateQueries(actions.memberCommerce(memberId)),
        queryClient.invalidateQueries(actions.memberTimeline(memberId)),
      ]);
    },
  });

  const refusal = adopt.isError ? adoptionRefusalOf(adopt.error) : null;

  return <>
    <Button variant="outlined" sx={{ alignSelf: 'flex-start' }} onClick={() => { adopt.reset(); setOpen(true); }}>
      {t.members.adoptSubscription}
    </Button>
    <ConfirmDialog
      open={open}
      title={t.members.adoptSubscription}
      confirmLabel={adopt.isPending ? t.members.adoptingSubscription : t.members.adoptSubscription}
      cancelLabel={t.common.cancel}
      confirmColor="primary"
      pending={adopt.isPending}
      confirmDisabled={!/^sub_[A-Za-z0-9]+$/.test(subscriptionId.trim()) || productId === '' || products.isError}
      onClose={() => setOpen(false)}
      onConfirm={() => adopt.mutate({ memberId, subscriptionId: subscriptionId.trim(), productId })}
      body={<>
        <Typography variant="body2">{t.members.adoptionHint}</Typography>
        <FormControl size="small">
          <FormLabel htmlFor="adopt-stripe-subscription-id">{t.members.subscriptionIdLabel}</FormLabel>
          <OutlinedInput id="adopt-stripe-subscription-id" value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)} disabled={adopt.isPending} />
        </FormControl>
        <FormControl size="small">
          <FormLabel htmlFor="adopt-stripe-product">{t.members.colProduct}</FormLabel>
          <Select id="adopt-stripe-product" value={productId} onChange={(event) => setProductId(event.target.value)} disabled={adopt.isPending || products.isPending} inputProps={{ 'aria-label': t.members.colProduct }}>
            {products.data?.products.map((product) => <MenuItem key={product.id} value={product.id}>{product.title}</MenuItem>)}
          </Select>
        </FormControl>
        {products.isError ? <Alert severity="error">{localizePanelError(products.error, t)}</Alert> : null}
        {adopt.isError ? <Alert severity="error">{refusal === null ? localizePanelError(adopt.error, t) : t.members.adoptionRefusals[refusal]}</Alert> : null}
      </>}
    />
  </>;
};
