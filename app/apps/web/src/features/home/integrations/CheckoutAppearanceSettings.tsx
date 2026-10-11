import { useState, type FormEvent } from 'react';
import { Alert, Button, FormControl, FormLabel, MenuItem, OutlinedInput, Select, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CHECKOUT_CORNERS, CHECKOUT_FONTS, checkoutAppearanceSchema, type CheckoutAppearance } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';

const selectFields = ['fontFamily', 'borderStyle'] as const;
const textFields = ['displayName', 'logoUrl', 'iconUrl', 'backgroundColor', 'buttonColor'] as const;

export const CheckoutAppearanceSettings = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const labels = t.integrations.checkoutAppearance;
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [draft, setDraft] = useState<CheckoutAppearance | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? settings.data?.settings.checkoutAppearance ?? {};
  const save = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });
  const change = (key: keyof CheckoutAppearance, next: string) => {
    setDraft({ ...value, [key]: next });
    setInvalid(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = checkoutAppearanceSchema.safeParse(value);
    setInvalid(!parsed.success);
    if (canEdit && parsed.success) save.mutate({ checkoutAppearance: parsed.data });
  };

  return (
    <SectionCard title={labels.heading} onSubmit={submit} actions={canEdit ? (
      <Button type="submit" variant="contained" data-testid="checkout-appearance-save" disabled={save.isPending || !settings.isSuccess}>
        {save.isPending ? t.billing.saving : t.billing.save}
      </Button>
    ) : undefined}>
      {settings.isPending ? <StatusView state={{ kind: 'loading', label: t.common.loading }} /> : null}
      {textFields.map((key) => (
        <FormControl fullWidth key={key}>
          <FormLabel htmlFor={`checkout-appearance-${key}`}>{labels[key]}</FormLabel>
          <OutlinedInput
            id={`checkout-appearance-${key}`}
            type={key === 'logoUrl' || key === 'iconUrl' ? 'url' : 'text'}
            value={value[key] ?? ''}
            disabled={!canEdit || !settings.isSuccess}
            onChange={(event) => change(key, event.target.value)}
            inputProps={{
              'data-testid': `checkout-appearance-${key}`,
              ...(key === 'backgroundColor' || key === 'buttonColor' ? { pattern: '#[0-9a-fA-F]{6}' } : {}),
              ...(key === 'logoUrl' || key === 'iconUrl' ? { pattern: 'https://.*' } : {}),
            }}
          />
        </FormControl>
      ))}
      {selectFields.map((key) => (
        <FormControl fullWidth key={key}>
          <FormLabel id={`checkout-appearance-${key}-label`}>{labels[key]}</FormLabel>
          <Select
            labelId={`checkout-appearance-${key}-label`}
            value={value[key] ?? (key === 'fontFamily' ? 'default' : '')}
            disabled={!canEdit || !settings.isSuccess}
            onChange={(event) => change(key, event.target.value)}
          >
            {key === 'borderStyle' ? <MenuItem value="">—</MenuItem> : null}
            {(key === 'fontFamily' ? CHECKOUT_FONTS : CHECKOUT_CORNERS).map((option) => (
              <MenuItem key={option} value={option}>{option.replaceAll('_', ' ')}</MenuItem>
            ))}
          </Select>
        </FormControl>
      ))}
      {invalid ? <Alert severity="error">{t.errors.validationForm}</Alert> : null}
      {settings.isError ? <Alert severity="error">{localizePanelError(settings.error, t)}</Alert> : null}
      {save.isError ? <Alert severity="error">{localizePanelError(save.error, t)}</Alert> : null}
      {save.isSuccess ? <Typography data-testid="checkout-appearance-saved">{t.billing.saved}</Typography> : null}
    </SectionCard>
  );
};
