import { FingerprintIcon } from './account-icons.js';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormHelperText,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { AccountWrappingText } from '../../theme.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { AccountSection } from './AccountSection.js';
import { AccountHelp } from './AccountHelp.js';
import { Fragment } from 'react';
import { AccountDialog } from './AccountDialog.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { EmbeddedTwoFactorCard } from './EmbeddedTwoFactorCard.js';
import { TwoFactorCard } from './TwoFactorCard.js';
import { useToastError, useToastOutcome } from './Toast.js';

import type { AuthenticationMethodsProps } from './authentication-methods-types.js';
export type { AuthenticationMethodsProps } from './authentication-methods-types.js';

const ignoreSecurityRefresh = () => undefined;

export const AuthenticationMethods = ({
  presentation = 'account',
  passwordCard,
  sessionsCard,
  Card = AccountSection,
  twoFactorEnabled = false,
  onSecurityRefresh = ignoreSecurityRefresh,
  passkeys,
  registerPasskey,
  removePasskey,
  requestPasswordSetup,
  enableTwoFactor,
  verifyTotp,
  disableTwoFactor,
  regenerateBackupCodes,
}: AuthenticationMethodsProps) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [adding, setAdding] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const [proofPassword, setProofPassword] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [confirmingPasskeyId, setConfirmingPasskeyId] = useState<string | null>(null);

  useEffect(() => {
    if (registerPasskey.success) {
      setAdding(false);
      setProofPassword('');
      setPasskeyName('');
    }
  }, [registerPasskey.success]);

  useEffect(() => {
    if (removePasskey.success) {
      setConfirmingPasskeyId(null);
      setProofPassword('');
    }
  }, [removePasskey.success]);

  const addPasskey = (event: FormEvent) => {
    event.preventDefault();
    if (registerPasskey.pending || proofPassword.length === 0) return;
    registerPasskey.run({
      name: passkeyName.trim() || t.security.defaultPasskeyName,
      password: proofPassword,
    });
  };

  const enrollTwoFactor = (event: FormEvent) => {
    event.preventDefault();
    enableTwoFactor.run({ password: twoFactorPassword });
  };

  const submitTotp = (event: FormEvent) => {
    event.preventDefault();
    verifyTotp.run({ code: totpCode.trim() });
  };

  const backupCodes = disableTwoFactor.success &&
      disableTwoFactor.submittedAt >= Math.max(
        enableTwoFactor.submittedAt,
        regenerateBackupCodes.submittedAt,
      )
    ? []
    : regenerateBackupCodes.data ?? enableTwoFactor.data?.backupCodes ?? [];

  useToastOutcome(
    requestPasswordSetup.success,
    t.security.resetSent,
    requestPasswordSetup.error === null ? null : localizeError(requestPasswordSetup.error, t),
  );
  useToastOutcome(
    registerPasskey.success,
    t.security.passkeyAdded,
    registerPasskey.error === null ? null : localizeError(registerPasskey.error, t),
  );
  useToastOutcome(
    removePasskey.success,
    t.security.passkeyRemoved,
    removePasskey.error === null ? null : localizeError(removePasskey.error, t),
  );
  useToastError(enableTwoFactor.error === null ? null : localizeError(enableTwoFactor.error, t));
  useToastOutcome(
    verifyTotp.success,
    t.security.twoFactorOn,
    verifyTotp.error === null ? null : localizeError(verifyTotp.error, t),
  );
  useToastOutcome(
    disableTwoFactor.success,
    t.security.twoFactorOff,
    disableTwoFactor.error === null ? null : localizeError(disableTwoFactor.error, t),
  );
  useToastOutcome(
    regenerateBackupCodes.success,
    t.security.backupCodesRegenerated,
    regenerateBackupCodes.error === null ? null : localizeError(regenerateBackupCodes.error, t),
  );

  const passkeyForm = (
<Box component="form" onSubmit={addPasskey} sx={{ display: 'grid', gap: '0.8rem' }}>
          <FormControl fullWidth>
            <FormLabel htmlFor="passkey-name">{t.security.passkeyNameLabel}</FormLabel>
            <OutlinedInput
              id="passkey-name"
              value={passkeyName}
              onChange={(event) => setPasskeyName(event.target.value)}
              inputProps={{ 'data-testid': 'passkey-name' }}
              placeholder={t.security.defaultPasskeyName}
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="passkey-proof-password">
              {t.security.passkeyPasswordLabel}
            </FormLabel>
            <OutlinedInput
              id="passkey-proof-password"
              type="password"
              value={proofPassword}
              onChange={(event) => setProofPassword(event.target.value)}
              inputProps={{ 'data-testid': 'passkey-proof-password', 'aria-describedby': 'passkey-proof-hint' }}
              autoComplete="current-password"
            />
            <FormHelperText id="passkey-proof-hint">{t.security.passkeyProofShort}</FormHelperText>
          </FormControl>
          <Box>
            <Button
              type="submit"
              variant="outlined"
              data-testid="add-passkey"
              disabled={registerPasskey.pending || proofPassword.length === 0}
            >
              {registerPasskey.pending ? t.security.addingPasskey : t.security.addPasskey}
            </Button>
          </Box>
          {registerPasskey.error ? <Alert severity="error">{localizeError(registerPasskey.error, t)}</Alert> : null}
        </Box>
  );
  const passkeyHelp = (
<AccountHelp inline={presentation === 'embedded'} title={t.security.passkeyHelp} testId="passkey-help">
          <Typography variant="body2">{t.security.passkeyIntro}</Typography>
        <Box sx={{ display: 'grid', gap: '0.4rem', justifyItems: 'start' }}>
          <Typography variant="caption">{t.security.passkeyPasswordlessHint}</Typography>
          <Button
            type="button"
            size="small"
            variant="text"
            data-testid="passkey-set-password"
            disabled={requestPasswordSetup.pending}
            onClick={() => requestPasswordSetup.run()}
          >
            {requestPasswordSetup.pending
              ? t.security.resetSending
              : t.security.passkeySetPassword}
          </Button>
        </Box>
        </AccountHelp>
  );

  const passkeyCard = (

      <Box>
      <Card icon={<FingerprintIcon />} title={t.security.passkeys} description={t.security.passkeyDescription}
        headerActions={<Chip size="small" variant="outlined" label={passkeys.pending ? t.common.loading : passkeys.error || passkeys.data === undefined ? t.security.passkeysUnavailable : t.security.passkeyCount({ count: passkeys.data.length })} />}>
        {passkeys.pending ? <Typography variant="body2">{t.security.loadingPasskeys}</Typography> : null}
        {passkeys.data !== undefined && passkeys.data.length === 0 ? (
          <Typography variant="body2" data-testid="passkeys-empty">
            {t.security.noPasskeys}
          </Typography>
        ) : null}
        {passkeys.data?.map((passkey) => (
          <Fragment key={passkey.id}>
          <Divider />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            useFlexGap
            spacing="0.6rem"
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            data-testid={`passkey-${passkey.id}`}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'flex-start' }}>
                <FingerprintIcon />
                <AccountWrappingText variant="body2" sx={{ minWidth: 0 }}>
                  {passkey.name.length > 0 ? passkey.name : t.security.unnamedPasskey}
                </AccountWrappingText>
              </Stack>
              <Typography variant="caption">
                {t.security.passkeyAddedAt({
                  date: new Date(passkey.createdAt).toLocaleDateString(language),
                })}
              </Typography>
            </Box>
            <Button size="small" color="error" onClick={() => { if (presentation === 'account') setProofPassword(''); setConfirmingPasskeyId(passkey.id); }}>
              {t.security.removePasskey}
            </Button>
          </Stack>
          </Fragment>
        ))}
        {passkeys.error ? (
          <Box>
            <Alert severity="error">{localizeError(passkeys.error, t)}</Alert>
            <Button size="small" sx={{ mt: '0.5rem' }} onClick={passkeys.retry}>
              {t.common.retry}
            </Button>
          </Box>
        ) : null}
        {presentation === 'account' ? <>
          <Box><Button variant="contained" data-testid="add-passkey-open" onClick={() => { setProofPassword(''); setAdding(true); }}>{t.security.addPasskey}</Button></Box>
          <AccountDialog open={adding} title={t.security.addPasskey} pending={registerPasskey.pending || requestPasswordSetup.pending} onClose={() => { setAdding(false); setProofPassword(''); }}>
            {passkeyForm}
            {passkeyHelp}

            {requestPasswordSetup.error ? <Alert severity="error">{localizeError(requestPasswordSetup.error, t)}</Alert> : null}
          </AccountDialog>
        </> : <>{passkeyHelp}{passkeyForm}</>}
        <ConfirmDialog open={confirmingPasskeyId !== null} title={t.security.confirmRemovePasskey} confirmLabel={t.security.confirmRemovePasskey} cancelLabel={t.common.cancel}
          pending={removePasskey.pending} confirmDisabled={proofPassword.length === 0} onClose={() => { setConfirmingPasskeyId(null); setProofPassword(''); }}
          onConfirm={() => { if (confirmingPasskeyId !== null) removePasskey.run({ id: confirmingPasskeyId, password: proofPassword }); }}
          body={<>
          <FormControl fullWidth>
            <FormLabel htmlFor="remove-passkey-proof-password">
              {t.security.passkeyPasswordLabel}
            </FormLabel>
            <OutlinedInput
              id="remove-passkey-proof-password"
              type="password"
              value={proofPassword}
              onChange={(event) => setProofPassword(event.target.value)}
              inputProps={{ 'data-testid': 'remove-passkey-proof-password', 'aria-describedby': 'remove-passkey-proof-hint' }}
              autoComplete="current-password"
            />
            <FormHelperText id="remove-passkey-proof-hint">{t.security.passkeyProofShort}</FormHelperText>
          </FormControl>
            {removePasskey.error ? <Alert severity="error">{localizeError(removePasskey.error, t)}</Alert> : null}
          </>}
        />
      </Card>
      </Box>


  );
  const twoFactorCard = presentation === 'embedded' ? (<EmbeddedTwoFactorCard
        Card={Card}
        enableTwoFactor={enableTwoFactor}
        verifyTotp={verifyTotp}
        disableTwoFactor={disableTwoFactor}
        regenerateBackupCodes={regenerateBackupCodes}
        twoFactorPassword={twoFactorPassword}
        setTwoFactorPassword={setTwoFactorPassword}
        totpCode={totpCode}
        setTotpCode={setTotpCode}
        enrollTwoFactor={enrollTwoFactor}
        submitTotp={submitTotp}
        backupCodes={backupCodes}
      />) : <TwoFactorCard Card={Card} enableTwoFactor={enableTwoFactor} verifyTotp={verifyTotp} disableTwoFactor={disableTwoFactor} regenerateBackupCodes={regenerateBackupCodes} backupCodes={backupCodes} twoFactorEnabled={twoFactorEnabled} onSecurityRefresh={onSecurityRefresh} />;
  return <Box sx={{ display: 'grid', gap: '1rem', alignItems: 'start', '@media (min-width: 1024px)': { gridTemplateColumns: presentation === 'account' ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: '1.5rem' } }}>
    {presentation === 'account' ? <>
      <Stack spacing="1rem" sx={{ minWidth: 0 }}>{passwordCard}{twoFactorCard}</Stack>
      <Stack spacing="1rem" sx={{ minWidth: 0 }}>{passkeyCard}{sessionsCard}</Stack>
    </> : <>{passkeyCard}{twoFactorCard}</>}
  </Box>;
};
