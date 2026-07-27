import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormLabel,
  OutlinedInput,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { TenantSecretKey } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { localizeError, useTranslations } from '../../i18n/index.js';

export const SecretField = ({
  secretKey,
  label,
  maskedPreview,
}: {
  secretKey: TenantSecretKey;
  label: string;
  maskedPreview: string | null;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  const invalidate = async () => {
    await queryClient.invalidateQueries(actions.tenantSecretsInvalidates());
  };

  const setSecret = useMutation({
    ...actions.setTenantSecret,
    onSuccess: async () => {
      setValue('');
      await invalidate();
    },
  });
  const removeSecret = useMutation({ ...actions.deleteTenantSecret, onSuccess: invalidate });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSecret.mutate({ key: secretKey, value });
  };
  const inputId = `secret-${secretKey}`;

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.6rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <FormLabel htmlFor={inputId} sx={{ m: 0 }}>
          {label}
        </FormLabel>
        <Chip
          size="small"
          variant="outlined"
          data-testid={`secret-status-${secretKey}`}
          label={maskedPreview ? `${t.integrations.configured} · ${maskedPreview}` : t.integrations.notConfigured}
        />
      </Box>
      <FormControl fullWidth>
        <OutlinedInput
          id={inputId}
          type="password"
          value={value}
          placeholder={t.integrations.valuePlaceholder}
          onChange={(event) => setValue(event.target.value)}
          inputProps={{ 'data-testid': `secret-input-${secretKey}` }}
          autoComplete="off"
        />
      </FormControl>
      <Box sx={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Button
          type="submit"
          variant="outlined"
          data-testid={`secret-save-${secretKey}`}
          disabled={setSecret.isPending || value.trim().length === 0}
        >
          {setSecret.isPending ? t.integrations.saving : t.integrations.save}
        </Button>
        {maskedPreview ? (
          <Button
            type="button"
            variant="text"
            color="error"
            data-testid={`secret-remove-${secretKey}`}
            disabled={removeSecret.isPending}
            onClick={() => removeSecret.mutate({ key: secretKey })}
          >
            {removeSecret.isPending ? t.integrations.removing : t.integrations.remove}
          </Button>
        ) : null}
      </Box>
      {setSecret.isSuccess ? (
        <Typography variant="caption" component="p" data-testid={`secret-saved-${secretKey}`}>
          {t.integrations.saved}
        </Typography>
      ) : null}
      {setSecret.isError ? <Alert>{localizeError(setSecret.error, t)}</Alert> : null}
      {removeSecret.isError ? <Alert>{localizeError(removeSecret.error, t)}</Alert> : null}
    </Box>
  );
};
