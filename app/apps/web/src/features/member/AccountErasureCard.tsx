import { useState } from 'react';
import { ConfirmDialog } from '../../components/layout/ConfirmDialog.js';
import { TriangleAlertIcon } from '../../components/ui/account-icons.js';
import { Alert, Box, Button, FormControl, FormLabel, OutlinedInput, Typography } from '@mui/material';
import type { MemberErasureRequest } from '#core/domain/index.js';
import { AccountCard as SectionCard } from './AccountCard.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';

interface AccountErasureCardProps {
  request: MemberErasureRequest | null;
  pending: boolean; error: Error | null;
  createPending: boolean; createError: Error | null;
  cancelPending: boolean; cancelError: Error | null;
  email: string; erasureConfirmEmail: string;
  onConfirmEmailChange(value: string): void;
  onCreate(input: { confirmEmail: string }): void;
  onCancel(): void; onRetry(): void;
}
export const AccountErasureCard = ({ request, pending, error, createPending, createError, cancelPending, cancelError, email, erasureConfirmEmail, onConfirmEmailChange, onCreate, onCancel, onRetry }: AccountErasureCardProps) => {
  const [open, setOpen] = useState(false);
  const t = useTranslations();
  const { language } = useLanguage();
  return (
<Box data-account-wide data-account-danger><SectionCard icon={<TriangleAlertIcon />}
          title={t.account.erasureHeading}
          description={t.account.erasureIntro}
        >
          {pending ? (
            <StatusView state={{ kind: 'loading', label: t.common.loading }} />
          ) : error !== null ? (
            <StatusView state={{ kind: 'error', message: localizeError(error, t), retry: { label: t.common.retry, onRetry: onRetry } }} />
          ) : request === null ? (
            <>
              <Box><Button color="error" variant="outlined" data-testid="account-erasure-open" onClick={() => setOpen(true)}>{t.account.erasureRequestButton}</Button></Box>
              <ConfirmDialog open={open} title={t.account.erasureHeading} confirmLabel={t.account.erasureRequestButton} cancelLabel={t.common.cancel}
                pending={createPending} confirmDisabled={erasureConfirmEmail.trim().toLowerCase() !== email.toLowerCase()} confirmTestId="account-erasure-create"
                onClose={() => setOpen(false)} onConfirm={() => onCreate({ confirmEmail: erasureConfirmEmail })}
                body={<><Typography>{t.account.erasureIntro}</Typography><FormControl fullWidth>
                <FormLabel htmlFor="erasure-confirm-email">
                  {t.account.erasureConfirmLabel}
                </FormLabel>
                <OutlinedInput
                  id="erasure-confirm-email"
                  value={erasureConfirmEmail}
                  onChange={(event) => onConfirmEmailChange(event.target.value)}
                />
              </FormControl>{createError ? <Alert severity="error">{localizeError(createError, t)}</Alert> : null}</>}
              />
            </>
          ) : request.status === 'open' ? (
            <>
              <Typography>
                {t.account.erasureOpen({
                  dueAt: new Date(request.dueAt).toLocaleDateString(
                    language,
                  ),
                })}
              </Typography>
              <Box>
                <Button
                  variant="outlined"
                  data-testid="account-erasure-cancel"
                  disabled={cancelPending}
                  onClick={onCancel}
                >
                  {t.account.erasureCancelButton}
                </Button>
              </Box>
            </>
          ) : (
            <Typography>
              {t.account.erasureResolved({
                status: t.account.erasureRequestStatus[
                  request.status
                ],
                resolvedAt:
                  request.resolvedAt === null
                    ? '—'
                    : new Date(
                        request.resolvedAt,
                      ).toLocaleDateString(language),
              })}
            </Typography>
          )}
          {cancelError !== null ? <Alert severity="error">{localizeError(cancelError, t)}</Alert> : null}
        </SectionCard></Box>
  );
};
