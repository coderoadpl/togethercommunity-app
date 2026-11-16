import { useState } from 'react';
import { Alert, Button, FormControl, FormHelperText, FormLabel, OutlinedInput } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { checkoutReturnOriginsSchema } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard } from '../../../components/layout/index.js';
import { useToastOutcome } from '../../../components/ui/Toast.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';

const originLines = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter((line) => line !== '');

export const CheckoutReturnSettingsCard = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? (settings.data?.settings.checkoutReturnOrigins ?? []).join('\n');
  const update = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
      setDraft(null);
    },
  });
  const unavailable = !settings.isSuccess || update.isPending;
  useToastOutcome(update.isSuccess, t.common.saved, update.error === null ? null : localizePanelError(update.error, t));

  return (
    <SectionCard
      title={t.shipping.returnOriginsHeading}
      description={t.shipping.returnOriginsIntro}
      data-testid="checkout-return-settings"
      actions={canEdit ? <Button type="submit" variant="contained" disabled={unavailable}>{t.shipping.returnOriginsSave}</Button> : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        const origins = checkoutReturnOriginsSchema.safeParse(originLines(value));
        if (!origins.success) {
          setInvalid(true);
          return;
        }
        update.mutate({ checkoutReturnOrigins: origins.data });
      }}
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="checkout-return-origins">{t.shipping.returnOriginsLabel}</FormLabel>
        <OutlinedInput
          id="checkout-return-origins"
          multiline
          minRows={2}
          value={value}
          disabled={!canEdit || unavailable}
          inputProps={{ 'aria-describedby': 'checkout-return-origins-hint', spellCheck: false }}
          onChange={(event) => {
            setInvalid(false);
            setDraft(event.target.value);
          }}
        />
        <FormHelperText id="checkout-return-origins-hint">{t.shipping.returnOriginsHint}</FormHelperText>
      </FormControl>
      {invalid ? <Alert severity="error" role="alert">{t.shipping.returnOriginsInvalid}</Alert> : null}
    </SectionCard>
  );
};
