import { useEffect, useState } from 'react';
import { AccountDialog } from '../../components/ui/AccountDialog.js';
import { Alert, Typography, Box, Button, FormControl, FormHelperText, FormLabel, OutlinedInput, Stack } from '@mui/material';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { AccountWrappingText } from '../../theme.js';

export const AccountNameFields = ({ displayName, savedDisplayName, onChange, onCancel, pending, success = false, dirty, error = null, onSubmit }: { displayName: string; savedDisplayName: string; onCancel(): void; success?: boolean; onChange(value: string): void; pending: boolean; dirty: boolean; error?: Error | null; onSubmit?(): void }) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (success) setOpen(false);
  }, [success]);
  return <>
    <Stack component="dl" useFlexGap spacing="0.25rem" sx={{ m: 0 }}>
      <Typography component="dt" variant="caption" color="text.secondary">{t.account.displayNameLabel}</Typography>
      <AccountWrappingText component="dd" variant="body1" color={savedDisplayName.trim() === '' ? 'text.secondary' : undefined} sx={{ m: 0 }} data-testid="account-display-name-value">
        {savedDisplayName.trim() === '' ? t.account.displayNameNotSet : savedDisplayName}
      </AccountWrappingText>
    </Stack>
    <Box><Button variant="outlined" data-testid="account-name-open" onClick={() => setOpen(true)}>{t.account.editName}</Button></Box>
    <AccountDialog open={open} title={t.account.editName} pending={pending} onClose={() => { setOpen(false); onCancel(); }}>
    <Box component="form" onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }} sx={{ display: 'grid', gap: '1rem' }}>
            <FormControl fullWidth>
              <FormLabel htmlFor="account-display-name">{t.account.displayNameLabel}</FormLabel>
              <OutlinedInput
                id="account-display-name"
                autoFocus
                autoComplete="nickname"
                inputProps={{ maxLength: 200, 'aria-describedby': 'account-display-name-helper' }}
                value={displayName}
                onChange={(event) => onChange(event.target.value)}
              />
              <FormHelperText id="account-display-name-helper">
                {t.account.displayNameHint}
              </FormHelperText>
            </FormControl>
            <Box>
              <Button
                type="submit"
                variant="contained"
                data-testid="account-display-name-save"
                disabled={pending || !dirty}
              >
                {t.account.displayNameSave}
              </Button>
            </Box>
    {error ? <Alert severity="error">{localizeError(error, t)}</Alert> : null}
    </Box></AccountDialog>
  </>;
};
