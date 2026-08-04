import { useState } from 'react';
import { Alert } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { TenantSecretKey } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SecretField as SecretFieldView } from '../../../components/ui/SecretField.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';

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
  const removeSecret = useMutation({
    ...actions.deleteTenantSecret,
    onSuccess: invalidate,
  });

  return (
    <>
      <SecretFieldView
        secretKey={secretKey}
        label={label}
        maskedPreview={maskedPreview}
        value={value}
        labels={{
          configured: t.integrations.configured,
          notConfigured: t.integrations.notConfigured,
          placeholder: t.integrations.valuePlaceholder,
          save: t.integrations.save,
          saving: t.integrations.saving,
          remove: t.integrations.remove,
          removing: t.integrations.removing,
          saved: t.integrations.saved,
        }}
        saving={setSecret.isPending}
        removing={removeSecret.isPending}
        saved={setSecret.isSuccess}
        onValueChange={setValue}
        onSave={() => setSecret.mutate({ key: secretKey, value })}
        onRemove={() => removeSecret.mutate({ key: secretKey })}
      />
      {setSecret.isError ? <Alert severity="error">{localizeError(setSecret.error, t)}</Alert> : null}
      {removeSecret.isError ? <Alert severity="error">{localizeError(removeSecret.error, t)}</Alert> : null}
    </>
  );
};
