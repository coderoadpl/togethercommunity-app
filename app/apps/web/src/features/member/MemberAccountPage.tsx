import { BellIcon, LockKeyholeIcon, MailCheckIcon, PlayIcon, ShieldCheckIcon, UserRoundIcon } from '../../components/ui/account-icons.js';
import { useEffect, useState } from 'react';
import {
  Alert,
  Divider,
  Chip,
  Box,
  Button,
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  Tab,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import { AVATAR_IMAGE_MAX_BYTES, resolveVideoAutoplay } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { AccountCard as SectionCard } from './AccountCard.js';
import { AccountHelp } from '../../components/ui/AccountHelp.js';
import { ActiveSessions } from '../../components/ui/ActiveSessions.js';
import { AuthenticationMethods } from '../../components/ui/AuthenticationMethods.js';
import { ChangePasswordForm } from '../../components/ui/ChangePasswordForm.js';
import { ColorSchemeSwitcher } from '../../components/ui/ColorSchemeSwitcher.js';
import { EmailVerificationStatus } from '../../components/ui/EmailVerificationStatus.js';
import { useToastOutcome } from '../../components/ui/Toast.js';
import { EmailLanguagePicker, useEmailLanguagePreference } from '../../EmailLanguageSwitcher.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { AccountPanel, AccountTabs, AccountWrappingText } from '../../theme.js';
import { AccountNameFields } from './AccountNameFields.js';
import { AccountSupportForm } from './AccountSupportForm.js';
import { AccountExportCard } from './AccountExportCard.js';
import { AccountErasureCard } from './AccountErasureCard.js';
import { AccountAvatar } from './AccountAvatar.js';
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
        <AccountWrappingText variant="body1" data-testid="account-email">
          {email}
        </AccountWrappingText>
      </SectionCard>
    );
  }

  return (
    <Stack component="dl" useFlexGap spacing="0.25rem" sx={{ m: 0 }}>
      <Typography component="dt" variant="caption" color="text.secondary">
        {t.account.signedInAs}
      </Typography>
      <AccountWrappingText component="dd" variant="body1" sx={{ m: 0 }} data-testid="account-email">
        {email}
      </AccountWrappingText>
    </Stack>
  );
};

export const MemberAccountPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

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
      <AccountTabs
        value={selectedTab}
        onChange={(_event, value: AccountTab) => {
          void navigate({ to: '/account', search: { tab: value } });
        }}
        aria-label={t.account.tabsLabel}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab icon={<UserRoundIcon />} iconPosition="start" id="account-tab-profile" aria-controls="account-panel-profile" value="profile" label={t.account.tabs.profile} />
        {impersonating ? null : (
          <Tab icon={<ShieldCheckIcon />} iconPosition="start" id="account-tab-security" aria-controls="account-panel-security" value="security" label={t.account.tabs.security} />
        )}
        <Tab icon={<BellIcon />} iconPosition="start" id="account-tab-notifications" aria-controls="account-panel-notifications" value="notifications" label={t.account.tabs.notifications} />
        {me.data.tenant?.memberId == null || !memberVideoAutoplayOverride ? null : (
          <Tab icon={<PlayIcon />} iconPosition="start" id="account-tab-playback" aria-controls="account-panel-playback" value="playback" label={t.account.tabs.playback} />
        )}
      </AccountTabs>
      <AccountPanel
        component="section"
        role="tabpanel"
        id={`account-panel-${selectedTab}`}
        aria-labelledby={`account-tab-${selectedTab}`}
        tabIndex={0}
      >
        {selectedTab === 'profile' && me.data.tenant?.memberId ? (
          <Box data-account-identity>
          <SectionCard icon={<UserRoundIcon />}
            title={t.account.profileHeading}

          >
            <SignedInAddress email={email} variant="inline" />
            <AccountAvatar
              name={savedDisplayName.trim() === '' ? me.data.name : savedDisplayName}
              email={email}
              avatarUrl={me.data.avatarUrl}
              uploadPending={uploadAvatar.isPending}
              removePending={removeAvatar.isPending}
              uploadError={uploadAvatar.error}
              removeError={removeAvatar.error}
              avatarError={avatarError}
              onRemove={() => removeAvatar.mutate(undefined)}
                  onUpload={(event) => {
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
            <AccountNameFields savedDisplayName={savedDisplayName} onCancel={() => setDisplayNameDraft(null)} success={updateProfile.isSuccess} error={updateProfile.error} onSubmit={() => updateProfile.mutate({ displayName: displayName.trim() === '' ? null : displayName.trim() })} displayName={displayName} onChange={setDisplayNameDraft} pending={updateProfile.isPending} dirty={displayName.trim() !== savedDisplayName.trim()} />
          </SectionCard>
          </Box>
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
            <Box data-account-wide><SectionCard icon={<MailCheckIcon />} title={t.emailVerification.heading}>
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
            </SectionCard></Box>

            <Box role="group" aria-label={t.security.heading} data-account-wide data-testid="account-security-methods">
              <AuthenticationMethods
                twoFactorEnabled={me.data.twoFactorEnabled}
                onSecurityRefresh={() => {
                  void queryClient.invalidateQueries(actions.meInvalidates());
                }}
                passwordCard={<Box><SectionCard icon={<LockKeyholeIcon />} title={t.account.passwordHeading} description={me.data.hasPassword ? t.account.passwordDescription : t.account.passwordLinkDescription} headerActions={<Chip size="small" color={me.data.hasPassword ? 'success' : 'default'} variant="outlined" label={me.data.hasPassword ? t.account.passwordStatusSet : t.account.passwordStatusUnset} />}>
                {me.data.hasPassword ? <>
                  <ChangePasswordForm
                    dialog
                    showHeading={false}
                    pending={changePassword.isPending}
                    success={changePassword.isSuccess}
                    error={changePassword.error}
                    onSubmit={(input) => changePassword.mutate(input)}
                  />
                  <Divider />
                </> : null}
                <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Button
                    variant={me.data.hasPassword ? 'text' : 'contained'}
                    data-testid="account-reset-password"
                    disabled={requestPasswordReset.isPending}
                    onClick={() => requestPasswordReset.mutate(passwordSetupInput)}
                  >
                    {requestPasswordReset.isPending ? t.account.resetSending : me.data.hasPassword ? t.account.setOrResetPassword : t.account.setPassword}
                  </Button>
                  <AccountHelp title={t.account.passwordLinkHelp}>
                    <Typography variant="body2">{t.account.passwordLinkDescription}</Typography>
                    <AccountWrappingText variant="body2">{email}</AccountWrappingText>
                    <Typography variant="body2">{t.account.passwordIntro}</Typography>
                  </AccountHelp>
                </Stack>
                {requestPasswordReset.error ? <Alert severity="error">{localizeError(requestPasswordReset.error, t)}</Alert> : null}
            </SectionCard></Box>}
                sessionsCard={<ActiveSessions
                Card={SectionCard}
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
              />}
                Card={SectionCard}
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
                  submittedAt: verifyTotp.submittedAt,
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

            </Box>
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

        {selectedTab === 'notifications' ? <SectionCard title={t.account.languageHeading} description={t.account.languageDescription}>
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
            <EmailLanguagePicker preference={emailLanguagePreference} />
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

        {selectedTab === 'notifications' ? <SectionCard title={t.account.appearanceHeading} description={t.account.appearanceDescription}><ColorSchemeSwitcher /></SectionCard> : null}

        {selectedTab === 'playback' && !impersonating && me.data.tenant?.memberId != null && memberVideoAutoplayOverride ? (
          <Box data-account-wide><SectionCard icon={<PlayIcon />}
            title={t.account.playbackHeading}
            description={t.account.playbackIntro}
            data-testid="account-playback"
            headerActions={
              <FormControlLabel
                control={<Switch checked={videoAutoplay} disabled={updatePlayback.isPending} onChange={(event) => updatePlayback.mutate({ videoAutoplay: event.target.checked })} />}
                label={t.account.videoAutoplayLabel}
              />
            }
          >
            <FormHelperText>{t.account.videoAutoplayHint}</FormHelperText>
          </SectionCard></Box>
        ) : null}

        {selectedTab === 'profile' && (billingPortalUrl || !impersonating) ? <Stack data-account-compact useFlexGap spacing="1.5rem">
        {billingPortalUrl ? (
          <Box><SectionCard title={t.account.billingHeading} description={t.account.billingIntro}>
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
          </SectionCard></Box>
        ) : null}

        {!impersonating ? (
          <AccountExportCard pending={dataExport.isFetching} error={dataExport.error} onDownload={() => void downloadDataExport()} />
        ) : null}

        </Stack> : null}

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
          <AccountSupportForm success={support.isSuccess} error={support.error} supportSubject={supportSubject} supportBody={supportBody} pending={support.isPending} onSubjectChange={setSupportSubject} onBodyChange={setSupportBody} onSubmit={(input) => support.mutate(input)} />
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

        {selectedTab === 'profile' ? <AccountErasureCard
          request={erasureRequest.data?.request ?? null}
          pending={erasureRequest.isPending} error={erasureRequest.error}
          createPending={createErasureRequest.isPending} createError={createErasureRequest.error}
          cancelPending={cancelErasureRequest.isPending} cancelError={cancelErasureRequest.error}
          email={email} erasureConfirmEmail={erasureConfirmEmail} onConfirmEmailChange={setErasureConfirmEmail}
          onCreate={(input) => createErasureRequest.mutate(input)} onCancel={() => cancelErasureRequest.mutate(undefined)} onRetry={() => void erasureRequest.refetch()}
        /> : null}
      </AccountPanel>
    </MemberSurface>
  );
};
