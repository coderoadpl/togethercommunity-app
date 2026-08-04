import { useEffect, useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { AuthenticationMethods } from '../../components/ui/AuthenticationMethods.js';
import { ChangePasswordForm } from '../../components/ui/ChangePasswordForm.js';
import { EmailVerificationStatus } from '../../components/ui/EmailVerificationStatus.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { BreakAllText } from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

export const MemberAccountPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery(actions.me);
  const billingOrders = useQuery(actions.memberBillingOrders);
  const tenantSettings = useQuery(actions.tenantSettings);
  const dataExport = useQuery({ ...actions.myDataExport, enabled: false });
  const erasureRequest = useQuery(actions.myErasureRequest);
  const [erasureConfirmEmail, setErasureConfirmEmail] = useState('');
  const createErasureRequest = useMutation({
    ...actions.requestMyErasure,
    onSuccess: () => {
      void erasureRequest.refetch();
    },
  });
  const cancelErasureRequest = useMutation({
    ...actions.cancelMyErasureRequest,
    onSuccess: () => {
      void erasureRequest.refetch();
    },
  });
  const [supportSubject, setSupportSubject] = useState('');
  const [supportBody, setSupportBody] = useState('');
  const support = useMutation(actions.sendSupportMessage);
  const passkeys = useQuery(actions.passkeys);
  const registerPasskey = useMutation({
    ...actions.registerPasskey,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.passkeysInvalidates());
    },
  });
  const removePasskey = useMutation({
    ...actions.removePasskey,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.passkeysInvalidates());
    },
  });
  const enableTwoFactor = useMutation(actions.enableTwoFactor);
  const verifyTotp = useMutation(actions.verifyTotp);
  const disableTwoFactor = useMutation(actions.disableTwoFactor);
  const regenerateBackupCodes = useMutation(actions.regenerateBackupCodes);

  const unauthorized = isUnauthorized(me.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  const requestPasswordReset = useMutation(actions.requestPasswordReset);
  const requestPasskeyPasswordSetup = useMutation(actions.requestPasswordReset);
  const changePassword = useMutation(actions.changePassword);
  const resendVerification = useMutation(actions.sendVerificationEmail);

  if (me.isPending) {
    return (
      <MemberSurface
        title={t.account.title}
        eyebrow={t.account.heading}
        state={{ kind: 'loading', label: t.common.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (me.isError) {
    return (
      <MemberSurface
        title={t.account.title}
        eyebrow={t.account.heading}
        state={{ kind: 'error', message: localizeError(me.error, t) }}
      />
    );
  }

  const email = me.data.email;
  const passwordSetupInput = {
    email,
    redirectTo: new URL('/reset-password', window.location.origin).toString(),
    language,
  };
  const billingPortalUrl = tenantSettings.data?.settings.billingPortalUrl ?? null;
  const billedOrders = billingOrders.data?.orders ?? [];
  const downloadDataExport = async () => {
    const result = await dataExport.refetch();
    if (result.data === undefined) return;
    const blob = new Blob([result.data.content], { type: result.data.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.data.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MemberSurface title={t.account.title} eyebrow={t.account.heading}>
      <Stack component="section" useFlexGap spacing="1.5rem">
        <SectionCard title={t.account.signedInAs}>
          <BreakAllText variant="body1" data-testid="account-email">
            {email}
          </BreakAllText>
        </SectionCard>

        <SectionCard title={t.emailVerification.heading}>
          <EmailVerificationStatus
            email={email}
            emailVerified={me.data.emailVerified}
            resendPending={resendVerification.isPending}
            resendSent={resendVerification.isSuccess}
            resendError={resendVerification.isError}
            onResend={() => resendVerification.mutate({
              email,
              callbackURL: new URL('/login?verification=verified', window.location.origin).toString(),
              language,
            })}
          />
        </SectionCard>

        <SectionCard
          title={t.account.dataExportHeading}
          description={t.account.dataExportIntro}
        >
          <Box>
            <Button
              variant="outlined"
              data-testid="account-data-export"
              disabled={dataExport.isFetching}
              onClick={() => void downloadDataExport()}
            >
              {dataExport.isFetching ? t.account.dataExportPreparing : t.account.dataExportButton}
            </Button>
          </Box>
          {dataExport.isError ? (
            <StatusView
              state={{ kind: 'error', message: localizeError(dataExport.error, t) }}
            />
          ) : null}
        </SectionCard>

        <SectionCard
          title={t.account.erasureHeading}
          description={t.account.erasureIntro}
        >
          {erasureRequest.data?.request === null ? (
            <>
              <FormControl fullWidth>
                <FormLabel htmlFor="erasure-confirm-email">
                  {t.account.erasureConfirmLabel}
                </FormLabel>
                <OutlinedInput
                  id="erasure-confirm-email"
                  value={erasureConfirmEmail}
                  onChange={(event) => setErasureConfirmEmail(event.target.value)}
                />
              </FormControl>
              <Button
                color="error"
                variant="contained"
                data-testid="account-erasure-create"
                disabled={
                  createErasureRequest.isPending ||
                  erasureConfirmEmail.trim().toLowerCase() !== email.toLowerCase()
                }
                onClick={() =>
                  createErasureRequest.mutate({ confirmEmail: erasureConfirmEmail })
                }
              >
                {t.account.erasureRequestButton}
              </Button>
            </>
          ) : erasureRequest.data?.request.status === 'open' ? (
            <>
              <Typography>
                {t.account.erasureOpen({
                  dueAt: new Date(erasureRequest.data.request.dueAt).toLocaleDateString(
                    language,
                  ),
                })}
              </Typography>
              <Button
                variant="outlined"
                data-testid="account-erasure-cancel"
                disabled={cancelErasureRequest.isPending}
                onClick={() => cancelErasureRequest.mutate(undefined)}
              >
                {t.account.erasureCancelButton}
              </Button>
            </>
          ) : erasureRequest.data?.request === undefined ? (
            <Typography>{t.common.loading}</Typography>
          ) : (
            <Typography>
              {t.account.erasureResolved({
                status: t.account.erasureRequestStatus[
                  erasureRequest.data.request.status
                ],
                resolvedAt:
                  erasureRequest.data.request.resolvedAt === null
                    ? '—'
                    : new Date(
                        erasureRequest.data.request.resolvedAt,
                      ).toLocaleDateString(language),
              })}
            </Typography>
          )}
          {createErasureRequest.isError ? (
            <StatusView
              state={{
                kind: 'error',
                message: localizeError(createErasureRequest.error, t),
              }}
            />
          ) : null}
        </SectionCard>

        <SectionCard title={t.account.passwordHeading} description={t.account.passwordIntro}>
            <ChangePasswordForm
              pending={changePassword.isPending}
              success={changePassword.isSuccess}
              error={changePassword.error}
              onSubmit={(input) => changePassword.mutate(input)}
            />
            <Box>
              <Button
                variant="outlined"
                data-testid="account-reset-password"
                disabled={requestPasswordReset.isPending}
                onClick={() => requestPasswordReset.mutate(passwordSetupInput)}
              >
                {requestPasswordReset.isPending
                  ? t.account.resetSending
                  : t.account.setOrResetPassword}
              </Button>
            </Box>
            {requestPasswordReset.isSuccess ? (
              <Typography variant="caption" component="p" data-testid="account-reset-sent">
                {t.account.resetSent}
              </Typography>
            ) : null}
            {requestPasswordReset.isError ? (
              <StatusView state={{ kind: 'error', message: localizeError(requestPasswordReset.error, t) }} />
            ) : null}
        </SectionCard>

        <SectionCard title={t.security.heading} data-testid="account-security-methods">
          <AuthenticationMethods
            passkeys={{ data: passkeys.data, pending: passkeys.isPending, error: passkeys.error }}
            registerPasskey={{
              pending: registerPasskey.isPending,
              success: registerPasskey.isSuccess,
              error: registerPasskey.error,
              run: registerPasskey.mutate,
            }}
            removePasskey={{
              pending: removePasskey.isPending,
              success: removePasskey.isSuccess,
              error: removePasskey.error,
              run: removePasskey.mutate,
            }}
            requestPasswordSetup={{
              pending: requestPasskeyPasswordSetup.isPending,
              success: requestPasskeyPasswordSetup.isSuccess,
              error: requestPasskeyPasswordSetup.error,
              run: () => requestPasskeyPasswordSetup.mutate(passwordSetupInput),
            }}
            enableTwoFactor={{
              data: enableTwoFactor.data,
              submittedAt: enableTwoFactor.submittedAt,
              pending: enableTwoFactor.isPending,
              success: enableTwoFactor.isSuccess,
              error: enableTwoFactor.error,
              run: enableTwoFactor.mutate,
            }}
            verifyTotp={{
              pending: verifyTotp.isPending,
              success: verifyTotp.isSuccess,
              error: verifyTotp.error,
              run: verifyTotp.mutate,
            }}
            disableTwoFactor={{
              submittedAt: disableTwoFactor.submittedAt,
              pending: disableTwoFactor.isPending,
              success: disableTwoFactor.isSuccess,
              error: disableTwoFactor.error,
              run: disableTwoFactor.mutate,
            }}
            regenerateBackupCodes={{
              data: regenerateBackupCodes.data,
              submittedAt: regenerateBackupCodes.submittedAt,
              pending: regenerateBackupCodes.isPending,
              success: regenerateBackupCodes.isSuccess,
              error: regenerateBackupCodes.error,
              run: regenerateBackupCodes.mutate,
            }}
          />
        </SectionCard>

        {billingPortalUrl ? (
          <SectionCard title={t.account.billingHeading} description={t.account.billingIntro}>
              <Box>
                <Button
                  component="a"
                  href={billingPortalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="contained"
                  data-testid="account-manage-payments"
                >
                  {t.account.managePayments}
                </Button>
              </Box>
          </SectionCard>
        ) : null}

        {tenantSettings.data?.settings.supportConfigured === true ? (
          <SectionCard
            title={t.support.heading}
            description={t.support.intro}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              support.mutate({ subject: supportSubject, body: supportBody });
            }}
          >
            <FormControl fullWidth>
              <FormLabel htmlFor="support-subject">{t.support.subjectLabel}</FormLabel>
              <OutlinedInput
                id="support-subject"
                value={supportSubject}
                onChange={(event) => setSupportSubject(event.target.value)}
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
                onChange={(event) => setSupportBody(event.target.value)}
                required
              />
            </FormControl>
            <Button type="submit" variant="contained" disabled={support.isPending}>
              {support.isPending ? t.support.sending : t.support.send}
            </Button>
            {support.isSuccess ? <Typography>{t.support.sent}</Typography> : null}
            {support.isError ? (
              <StatusView state={{ kind: 'error', message: localizeError(support.error, t) }} />
            ) : null}
          </SectionCard>
        ) : null}

        {tenantSettings.data?.settings.supportUrl ? (
          <Button
            component="a"
            href={tenantSettings.data.settings.supportUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t.support.externalLink}
          </Button>
        ) : null}

        {billedOrders.length > 0 ? (
          <SectionCard title={t.account.invoiceOrdersHeading}>
            <Stack useFlexGap spacing="1rem">
              {billedOrders.map((order) => (
                <Stack key={order.id} useFlexGap spacing="0.2rem">
                  <Typography variant="subtitle2">
                    {t.account.invoiceOrderLabel({ date: new Date(order.createdAt).toLocaleDateString(language) })}
                  </Typography>
                  {order.billing === null ? null : (
                    <>
                      <Typography>{order.billing.companyName}</Typography>
                      <Typography>{order.billing.nip ?? ''}</Typography>
                      <Typography>{order.billing.address}</Typography>
                      <Typography>
                        {order.billing.postalCode} {order.billing.city}, {order.billing.country}
                      </Typography>
                    </>
                  )}
                  {order.invoice?.provider === 'ksef'
                    && (order.invoice.status === 'issued' || order.invoice.status === 'delivered') ? (
                      <Button
                        component="a"
                        href={`/api/me/invoices/${encodeURIComponent(order.invoice.id)}/download`}
                        target="_blank"
                        rel="noreferrer"
                        variant="text"
                        data-testid={`account-invoice-download-${order.invoice.id}`}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {t.account.invoiceDownload}
                      </Button>
                    ) : null}
                </Stack>
              ))}
            </Stack>
          </SectionCard>
        ) : null}

        <SectionCard title={t.account.preferencesHeading} description={t.account.preferencesIntro}>
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
            <LanguageSwitcher inline />
          </Stack>
        </SectionCard>
      </Stack>
    </MemberSurface>
  );
};
