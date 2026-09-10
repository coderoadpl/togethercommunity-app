import type { ChangeEvent } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { AccountHelp } from '../../components/ui/AccountHelp.js';
import { UserAvatar } from '../../components/ui/UserAvatar.js';
import { localizeError, useTranslations } from '../../i18n/index.js';

interface AccountAvatarProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  uploadPending: boolean;
  removePending: boolean;
  uploadError: Error | null;
  removeError: Error | null;
  avatarError: string | null;
  onUpload(event: ChangeEvent<HTMLInputElement>): void;
  onRemove(): void;
}

export const AccountAvatar = ({ name, email, avatarUrl, uploadPending, removePending, uploadError, removeError, avatarError, onUpload, onRemove }: AccountAvatarProps) => {
  const t = useTranslations();
  return (<>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <UserAvatar
                name={name}
                email={email}
                imageUrl={avatarUrl}
                size="lg"
              />
              <Typography variant="caption" color="text.secondary">
                {t.account.avatarUploadHint}
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem">
              <Button component="label" variant="outlined" disabled={uploadPending}>
                {uploadPending ? t.account.avatarUploading : t.account.avatarUpload}
                <input
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onUpload}
                />
              </Button>
              {avatarUrl === null ? null : (
                <Button
                  variant="text"
                  color="error"
                  disabled={removePending}
                  onClick={onRemove}
                >
                  {t.account.avatarRemove}
                </Button>
              )}
            </Stack>
            <AccountHelp title={t.account.avatarHelp}><Typography variant="body2">{t.account.avatarHint}</Typography></AccountHelp>
            {uploadError !== null ? (
              <Alert severity="error">{localizeError(uploadError, t)}</Alert>
            ) : null}
            {avatarError === null ? null : <Alert severity="error">{avatarError}</Alert>}
            {removeError !== null ? (
              <Alert severity="error">{localizeError(removeError, t)}</Alert>
            ) : null}
  </>);
};
