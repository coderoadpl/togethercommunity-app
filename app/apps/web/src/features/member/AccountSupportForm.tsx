import { useEffect, useState, type FormEvent } from 'react';
import { AccountDialog } from '../../components/ui/AccountDialog.js';
import { MessageSquareIcon } from '../../components/ui/account-icons.js';
import { Alert, Box, Button, FormControl, FormLabel, OutlinedInput, Stack, Typography } from '@mui/material';
import { AccountCard as SectionCard } from './AccountCard.js';
import { localizeError, useTranslations } from '../../i18n/index.js';

export const AccountSupportForm = ({ configured = true, externalUrl = null, supportSubject, supportBody, pending, success = false, error = null, initiallyOpen = false, onSubjectChange, onBodyChange, onSubmit }: {
  configured?: boolean; externalUrl?: string | null;
  supportSubject: string; supportBody: string; pending: boolean; success?: boolean; error?: Error | null; initiallyOpen?: boolean;
  onSubjectChange(value: string): void; onBodyChange(value: string): void;
  onSubmit(input: { subject: string; body: string }): void;
}) => {
  const t = useTranslations();
  const [open, setOpen] = useState(configured && initiallyOpen);
  useEffect(() => {
    if (success) setOpen(false);
  }, [success]);
  return (
          <SectionCard
            icon={<MessageSquareIcon />}
            title={t.support.heading}
            description={configured ? t.support.intro : undefined}
            data-testid="account-support"
          >
            {configured || externalUrl !== null ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-start' }}>
                {configured ? <Button variant="outlined" data-testid="account-support-open" onClick={() => setOpen(true)}>{t.support.heading}</Button> : null}
                {externalUrl === null ? null : (
                  <Button component="a" href={externalUrl} target="_blank" rel="noreferrer" variant="outlined" data-testid="account-support-external">
                    {t.support.externalLink}
                  </Button>
                )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" data-testid="account-support-not-configured">{t.support.notConfigured}</Typography>
            )}
            <AccountDialog open={configured && open} title={t.support.heading} pending={pending} onClose={() => setOpen(false)}>
            <Box component="form" sx={{ display: 'grid', gap: '1rem' }} onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit({ subject: supportSubject, body: supportBody }); }}>
            <FormControl fullWidth>
              <FormLabel htmlFor="support-subject">{t.support.subjectLabel}</FormLabel>
              <OutlinedInput
                id="support-subject"
                autoFocus
                value={supportSubject}
                onChange={(event) => onSubjectChange(event.target.value)}
                required
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel htmlFor="support-body">{t.support.bodyLabel}</FormLabel>
              <OutlinedInput
                id="support-body"
                multiline
                minRows={5}
                value={supportBody}
                onChange={(event) => onBodyChange(event.target.value)}
                required
              />
            </FormControl>
            <Box>
              <Button
                type="submit"
                variant="contained"
                disabled={pending || supportSubject.trim() === '' || supportBody.trim() === ''}
              >
                {pending ? t.support.sending : t.support.send}
              </Button>
            </Box>
            {error ? <Alert severity="error">{localizeError(error, t)}</Alert> : null}
            </Box></AccountDialog>
          </SectionCard>
  );
};
