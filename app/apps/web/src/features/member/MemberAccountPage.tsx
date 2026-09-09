import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  OutlinedInput,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import { AVATAR_IMAGE_MAX_BYTES, resolveVideoAutoplay } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { ActiveSessions } from '../../components/ui/ActiveSessions.js';
import { AuthenticationMethods } from '../../components/ui/AuthenticationMethods.js';
import { ChangePasswordForm } from '../../components/ui/ChangePasswordForm.js';
import { ColorSchemeSwitcher } from '../../components/ui/ColorSchemeSwitcher.js';
import { EmailVerificationStatus } from '../../components/ui/EmailVerificationStatus.js';
import { useToastOutcome } from '../../components/ui/Toast.js';
import { EmailLanguagePicker, useEmailLanguagePreference } from '../../EmailLanguageSwitcher.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { useRedirectToLogin } from './use-login-redirect.js';
import { WrapAnywhereText } from '../../theme.js';
import { UserAvatar } from '../../components/ui/UserAvatar.js';
import { MemberSurface } from './MemberSurface.js';
import { useImpersonation } from './viewer.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

type AccountTab = 'profile' | 'security' | 'notifications' | 'playback';

const accountTabFrom = (value: unknown): AccountTab =>
  value === 'security' || value === 'notifications' || value === 'playback' ? value : 'profile';

const avatarContentType = (value: string): 'image/png' | 'image/jpeg' | 'image/webp' | null => {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp') return value;
  return null;
};

const SignedInAddress = ({ email, variant }: { email: string; variant: 'card' | 'inline' }) => {
  const t = useTranslations();

  if (variant === 'card') {
    return (
      <SectionCard title={t.account.signedInAs}>
        <WrapAnywhereText variant="body1" data-testid="account-email">
          {email}
        </WrapAnywhereText>
      </SectionCard>
    );
  }

  return (
    <Stack component="dl" useFlexGap spacing="0.25rem" sx={{ m: 0 }}>
      <Typography component="dt" variant="caption" color="text.secondary">
        {t.account.signedInAs}
      </Typography>
      <WrapAnywhereText component="dd" variant="body1" sx={{ m: 0 }} data-testid="account-email">
        {email}
      </WrapAnywhereText>
    </Stack>
  );
};

export const MemberAccountPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const redirectToLogin = useRedirectToLogin();
  const search = useSearch({ strict: false });
  const me = useQuery(actions.me);
  const impersonating = useImpersonation() !== null;
  const ownAccount = me.data !== undefined && me.data.impersonation === null;
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
  const [displayNameDraft, setDisplayNameDraft] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const updateProfile = useMutation({
    ...actions.updateMyProfile,
    onSuccess: async () => {
      setDisplayNameDraft(null);
      await queryClient.invalidateQueries(actions.meInvalidates());
    },
  });
  const uploadAvatar = useMutation({
    ...actions.uploadAvatar,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.meInvalidates());
    },
  });
  const removeAvatar = useMutation({
    ...actions.removeAvatar,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.meInvalidates());
    },
  });
  const updatePrivacy = useMutation({
    ...actions.updateMyProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.meInvalidates());
    },
  });
  const updatePlayback = useMutation({
    ...actions.updateMyProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.meInvalidates());
    },
  });
  const emailLanguagePreference = useEmailLanguagePreference();
  const [supportSubject, setSupportSubject] = useState('');
  const [supportBody, setSupportBody] = useState('');
  const support = useMutation({
    ...actions.sendSupportMessage,
    onSuccess: () => {
      setSupportSubject('');
      setSupportBody('');
    },
  });
  const accountSessions = useQuery({ ...actions.accountSessions, enabled: ownAccount });
  const revokeAccountSession = useMutation({
    ...actions.revokeAccountSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.accountSessionsInvalidates());
    },
  });
  const revokeOtherAccountSessions = useMutation({
    ...actions.revokeOtherAccountSessions,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.accountSessionsInvalidates());
    },
  });
  const passkeys = useQuery({ ...actions.passkeys, enabled: ownAccount });
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
    if (unauthorized) void redirectToLogin();
  }, [redirectToLogin, unauthorized]);

  const requestPasswordReset = useMutation(actions.requestPasswordReset);
  const requestPasskeyPasswordSetup = useMutation(actions.requestPasswordReset);
  const changePassword = useMutation(actions.changePassword);
  const resendVerification = useMutation(actions.sendVerificationEmail);

  useToastOutcome(
    updateProfile.isSuccess,
    t.account.displayNameSaved,
    updateProfile.error === null ? null : localizeError(updateProfile.error, t),
  );
  useToastOutcome(
    updatePrivacy.isSuccess,
    t.messages.optOutSaved,
    updatePrivacy.error === null ? null : localizeError(updatePrivacy.error, t),
  );
  useToastOutcome(
    updatePlayback.isSuccess,
    t.account.videoAutoplaySaved,
    updatePlayback.error === null ? null : localizeError(updatePlayback.error, t),
  );
  useToastOutcome(
    requestPasswordReset.isSuccess,
    t.account.resetSent,
    requestPasswordReset.error === null ? null : localizeError(requestPasswordReset.error, t),
  );
  useToastOutcome(
    support.isSuccess,
    t.support.sent,
    support.error === null ? null : localizeError(support.error, t),
  );

  if (me.isPending) {
    return (
      <MemberSurface
        title={t.account.title}
        state={{ kind: 'loading', label: t.common.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (me.isError) {
    return (
      <MemberSurface
        title={t.account.title}
        state={{ kind: 'error', message: localizeError(me.error, t), retry: { label: t.common.retry, onRetry: () => void me.refetch() } }}
      />
    );
  }

  const email = me.data.email;
  const savedDisplayName = me.data.tenant?.displayName ?? '';
  const dmOptOut = me.data.tenant?.dmOptOut ?? false;
  const emailLanguage = me.data.tenant?.language ?? null;
  const memberVideoAutoplayOverride =
    tenantSettings.data?.settings.memberVideoAutoplayOverride === true;
  const videoAutoplay = tenantSettings.data === undefined
    ? false
    : resolveVideoAutoplay(
        tenantSettings.data.settings,
        me.data.tenant?.videoAutoplay ?? null,
      );
  const requestedTab = accountTabFrom(search['tab']);
  const selectedTab = (requestedTab === 'security' && impersonating) ||
    (requestedTab === 'playback' && (me.data.tenant?.memberId == null || !memberVideoAutoplayOverride))
    ? 'profile'
    : requestedTab;
  const displayName = displayNameDraft ?? savedDisplayName;
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
    <MemberSurface title={t.account.title}>
      <Tabs
        value={selectedTab}
        onChange={(_event, value: AccountTab) => {
          void navigate({ to: '/account', search: { tab: value } });
        }}
        aria-label={t.account.tabsLabel}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab id="account-tab-profile" aria-controls="account-panel-profile" value="profile" label={t.account.tabs.profile} />
        {impersonating ? null : (
          <Tab id="account-tab-security" aria-controls="account-panel-security" value="security" label={t.account.tabs.security} />
        )}
        <Tab id="account-tab-notifications" aria-controls="account-panel-notifications" value="notifications" label={t.account.tabs.notifications} />
        {me.data.tenant?.memberId == null || !memberVideoAutoplayOverride ? null : (
          <Tab id="account-tab-playback" aria-controls="account-panel-playback" value="playback" label={t.account.tabs.playback} />
        )}
      </Tabs>
      <Stack
        component="section"
        useFlexGap
        spacing="1.5rem"
        role="tabpanel"
        id={`account-panel-${selectedTab}`}
        aria-labelledby={`account-tab-${selectedTab}`}
        tabIndex={0}
        sx={{ mt: '1.5rem' }}
      >
        {selectedTab === 'profile' && me.data.tenant?.memberId ? (
          <SectionCard
            title={t.account.profileHeading}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              updateProfile.mutate({ displayName: displayName.trim() === '' ? null : displayName.trim() });
            }}
          >
            <SignedInAddress email={email} variant="inline" />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <UserAvatar
                name={displayName.trim() === '' ? me.data.name : displayName}
                email={email}
                imageUrl={me.data.avatarUrl}
                size="lg"
              />
              <Typography variant="caption" color="text.secondary">
                {t.account.avatarHint}
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem">
              <Button component="label" variant="outlined" disabled={uploadAvatar.isPending}>
                {uploadAvatar.isPending ? t.account.avatarUploading : t.account.avatarUpload}
                <input
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file !== undefined && file.size > AVATAR_IMAGE_MAX_BYTES) {
                      setAvatarError(t.account.avatarTooLarge);
                      return;
                    }
                    const contentType = file === undefined ? null : avatarContentType(file.type);
                    if (file === undefined || contentType === null) return;
                    setAvatarError(null);
                    uploadAvatar.mutate({
                      kind: 'avatar',
                      fileName: file.name,
                      contentType,
                      sizeBytes: file.size,
                      body: file,
                    });
                  }}
                />
              </Button>
              {me.data.avatarUrl === null ? null : (
                <Button
                  variant="text"
                  color="error"
                  disabled={removeAvatar.isPending}
                  onClick={() => removeAvatar.mutate(undefined)}
                >
                  {t.account.avatarRemove}
                </Button>
              )}
            </Stack>
            {uploadAvatar.isError ? (
              <Alert severity="error">{localizeError(uploadAvatar.error, t)}</Alert>
            ) : null}
            {avatarError === null ? null : <Alert severity="error">{avatarError}</Alert>}
            {removeAvatar.isError ? (
              <Alert severity="error">{localizeError(removeAvatar.error, t)}</Alert>
            ) : null}
            <FormControl fullWidth>
              <FormLabel htmlFor="account-display-name">{t.account.displayNameLabel}</FormLabel>
              <OutlinedInput
                id="account-display-name"
                inputProps={{ maxLength: 200, 'aria-describedby': 'account-display-name-helper' }}
                value={displayName}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
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
                disabled={updateProfile.isPending || displayName.trim() === savedDisplayName.trim()}
              >
                {t.account.displayNameSave}
              </Button>
            </Box>
          </SectionCard>
        ) : selectedTab === 'profile' ? (
          <SignedInAddress email={email} variant="card" />
        ) : null}

        {selectedTab === 'profile' && billingOrders.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(billingOrders.error, t), retry: { label: t.common.retry, onRetry: () => void billingOrders.refetch() } }} />
        ) : null}
        {selectedTab === 'profile' && tenantSettings.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(tenantSettings.error, t), retry: { label: t.common.retry, onRetry: () => void tenantSettings.refetch() } }} />
        ) : null}

        {selectedTab === 'security' && !impersonating ? (
          <>
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
            </SectionCard>

            <SectionCard title={t.security.heading} data-testid="account-security-methods">
              <AuthenticationMethods
                passkeys={{ data: passkeys.data, pending: passkeys.isPending, error: passkeys.error, retry: () => void passkeys.refetch() }}
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
              <ActiveSessions
                sessions={{
                  data: accountSessions.data?.sessions,
                  pending: accountSessions.isPending,
                  error: accountSessions.error,
                  retry: () => void accountSessions.refetch(),
                }}
                revokeSession={{
                  pending: revokeAccountSession.isPending,
                  success: revokeAccountSession.isSuccess,
                  error: revokeAccountSession.error,
                  run: revokeAccountSession.mutate,
                }}
                revokeOtherSessions={{
                  pending: revokeOtherAccountSessions.isPending,
                  success: revokeOtherAccountSessions.isSuccess,
                  error: revokeOtherAccountSessions.error,
                  run: () => revokeOtherAccountSessions.mutate(undefined),
                }}
              />
            </SectionCard>
          </>
        ) : null}

        {selectedTab === 'notifications' && !impersonating && me.data.tenant?.memberId !== undefined && me.data.tenant.memberId !== null ? (
          <SectionCard
            title={t.messages.privacyHeading}
            description={t.messages.optOutHint}
            data-testid="account-dm-privacy"
          >
            <FormControlLabel
              control={(
                <Switch
                  checked={dmOptOut}
                  disabled={updatePrivacy.isPending}
                  onChange={(event) => updatePrivacy.mutate({ dmOptOut: event.target.checked })}
                />
              )}
              label={t.messages.optOutLabel}
            />
          </SectionCard>
        ) : null}

        {selectedTab === 'notifications' ? <SectionCard title={t.account.preferencesHeading} description={t.account.preferencesIntro}>
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
            <EmailLanguagePicker preference={emailLanguagePreference} />
            <ColorSchemeSwitcher />
          </Stack>
          {me.data.tenant?.memberId == null ? null : (
            <>
              <Typography variant="body2" data-testid="member-email-language">
                {emailLanguage === null
                  ? t.account.emailLanguage.unset
                  : t.account.emailLanguage[emailLanguage]}
              </Typography>
              {emailLanguage === null ? null : (
                <Box>
                  <Button
                    variant="text"
                    data-testid="member-email-language-reset"
                    disabled={!emailLanguagePreference.storable}
                    onClick={() => emailLanguagePreference.store(null)}
                  >
                    {t.account.emailLanguage.reset}
                  </Button>
                </Box>
              )}
            </>
          )}
        </SectionCard> : null}

        {selectedTab === 'playback' && !impersonating && me.data.tenant?.memberId != null && memberVideoAutoplayOverride ? (
          <SectionCard
            title={t.account.playbackHeading}
            description={t.account.playbackIntro}
            data-testid="account-playback"
          >
            <FormControlLabel
              control={(
                <Switch
                  checked={videoAutoplay}
                  disabled={updatePlayback.isPending}
                  onChange={(event) => updatePlayback.mutate({ videoAutoplay: event.target.checked })}
                />
              )}
              label={t.account.videoAutoplayLabel}
            />
            <FormHelperText>{t.account.videoAutoplayHint}</FormHelperText>
          </SectionCard>
        ) : null}

        {selectedTab === 'profile' && billingPortalUrl ? (
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

        {selectedTab === 'profile' && billedOrders.length > 0 ? (
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

        {selectedTab === 'profile' && tenantSettings.data?.settings.supportConfigured === true ? (
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
            <Box>
              <Button
                type="submit"
                variant="contained"
                disabled={support.isPending || supportSubject.trim() === '' || supportBody.trim() === ''}
              >
                {support.isPending ? t.support.sending : t.support.send}
              </Button>
            </Box>
          </SectionCard>
        ) : null}

        {selectedTab === 'profile' && tenantSettings.data?.settings.supportUrl ? (
          <Button
            component="a"
            href={tenantSettings.data.settings.supportUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t.support.externalLink}
          </Button>
        ) : null}

        {selectedTab === 'profile' && !impersonating ? (
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
                state={{ kind: 'error', message: localizeError(dataExport.error, t), retry: { label: t.common.retry, onRetry: () => void downloadDataExport() } }}
              />
            ) : null}
          </SectionCard>
        ) : null}

        {selectedTab === 'profile' ? <SectionCard
          title={t.account.erasureHeading}
          description={t.account.erasureIntro}
        >
          {erasureRequest.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.common.loading }} />
          ) : erasureRequest.isError ? (
            <StatusView state={{ kind: 'error', message: localizeError(erasureRequest.error, t), retry: { label: t.common.retry, onRetry: () => void erasureRequest.refetch() } }} />
          ) : erasureRequest.data.request === null ? (
            <Stack
              useFlexGap
              spacing="1rem"
              data-mobile-keyboard-anchor
              sx={{ scrollMarginBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
            >
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
              <Box>
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
                  sx={{ minHeight: '44px' }}
                >
                  {t.account.erasureRequestButton}
                </Button>
              </Box>
            </Stack>
          ) : erasureRequest.data.request.status === 'open' ? (
            <>
              <Typography>
                {t.account.erasureOpen({
                  dueAt: new Date(erasureRequest.data.request.dueAt).toLocaleDateString(
                    language,
                  ),
                })}
              </Typography>
              <Box>
                <Button
                  variant="outlined"
                  data-testid="account-erasure-cancel"
                  disabled={cancelErasureRequest.isPending}
                  onClick={() => cancelErasureRequest.mutate(undefined)}
                >
                  {t.account.erasureCancelButton}
                </Button>
              </Box>
            </>
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
            <Alert severity="error">{localizeError(createErasureRequest.error, t)}</Alert>
          ) : null}
          {cancelErasureRequest.isError ? <Alert severity="error">{localizeError(cancelErasureRequest.error, t)}</Alert> : null}
        </SectionCard> : null}
      </Stack>
    </MemberSurface>
  );
};
