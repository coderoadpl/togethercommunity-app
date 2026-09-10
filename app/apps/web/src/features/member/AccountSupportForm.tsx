import { useEffect, useState, type FormEvent } from 'react';
import { AccountDialog } from '../../components/ui/AccountDialog.js';
import { Alert, Box, Button, FormControl, FormLabel, OutlinedInput } from '@mui/material';
import { AccountCard as SectionCard } from './AccountCard.js';
import { localizeError, useTranslations } from '../../i18n/index.js';

export const AccountSupportForm = ({ supportSubject, supportBody, pending, success = false, error = null, onSubjectChange, onBodyChange, onSubmit }: {
  supportSubject: string; supportBody: string; pending: boolean; success?: boolean; error?: Error | null;
  onSubjectChange(value: string): void; onBodyChange(value: string): void;
  onSubmit(input: { subject: string; body: string }): void;
}) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (success) setOpen(false);
  }, [success]);
  return (
          <SectionCard
            title={t.support.heading}
            description={t.support.intro}
          >
            <Box><Button variant="outlined" data-testid="account-support-open" onClick={() => setOpen(true)}>{t.support.heading}</Button></Box>
            <AccountDialog open={open} title={t.support.heading} pending={pending} onClose={() => setOpen(false)}>
            <Box component="form" sx={{ display: 'grid', gap: '1rem' }} onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit({ subject: supportSubject, body: supportBody }); }}>
            <FormControl fullWidth>
              <FormLabel htmlFor="support-subject">{t.support.subjectLabel}</FormLabel>
              <OutlinedInput
                id="support-subject"
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
