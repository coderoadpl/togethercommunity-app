import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { Eyebrow } from '../../theme.js';

interface OperationState {
  pending: boolean;
  success: boolean;
  error: Error | null;
}

interface PasskeyRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface AuthenticationMethodsProps {
  passkeys: {
    data: PasskeyRow[] | undefined;
    pending: boolean;
    error: Error | null;
    retry(): void;
  };
  registerPasskey: OperationState & {
    run(input: { name: string; password: string }): void;
  };
  removePasskey: OperationState & {
    run(input: { id: string; password: string }): void;
  };
  requestPasswordSetup: OperationState & {
    run(): void;
  };
  enableTwoFactor: OperationState & {
    data: { totpURI: string; backupCodes: string[] } | undefined;
    submittedAt: number;
    run(input: { password: string }): void;
  };
  verifyTotp: OperationState & {
    run(input: { code: string }): void;
  };
  disableTwoFactor: OperationState & {
    submittedAt: number;
    run(input: { password: string }): void;
  };
  regenerateBackupCodes: OperationState & {
    data: string[] | undefined;
    submittedAt: number;
    run(input: { password: string }): void;
  };
}

export const AuthenticationMethods = ({
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
  const [passkeyName, setPasskeyName] = useState('');
  const [proofPassword, setProofPassword] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [confirmingPasskeyId, setConfirmingPasskeyId] = useState<string | null>(null);

  const addPasskey = (event: FormEvent) => {
    event.preventDefault();
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

  return (
    <Stack useFlexGap spacing="1.75rem">
      <Box component="section" sx={{ display: 'grid', gap: '0.8rem' }}>
        <Eyebrow variant="overline" component="h3">
          {t.security.passkeys}
        </Eyebrow>
        <Typography variant="body2">{t.security.passkeyIntro}</Typography>
        <Typography variant="caption">{t.security.passkeyProofHint}</Typography>
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
        {requestPasswordSetup.success ? (
          <Typography variant="caption" component="p" data-testid="passkey-password-setup-sent">
            {t.security.resetSent}
          </Typography>
        ) : null}
        {requestPasswordSetup.error ? (
          <Alert severity="error">{localizeError(requestPasswordSetup.error, t)}</Alert>
        ) : null}
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
              inputProps={{ 'data-testid': 'passkey-proof-password' }}
              autoComplete="current-password"
            />
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
        </Box>
        {registerPasskey.success ? (
          <Typography variant="caption" component="p" data-testid="passkey-added">
            {t.security.passkeyAdded}
          </Typography>
        ) : null}
        {registerPasskey.error ? <Alert severity="error">{localizeError(registerPasskey.error, t)}</Alert> : null}
        {passkeys.pending ? <Typography variant="body2">{t.security.loadingPasskeys}</Typography> : null}
        {passkeys.data !== undefined && passkeys.data.length === 0 ? (
          <Typography variant="body2" data-testid="passkeys-empty">
            {t.security.noPasskeys}
          </Typography>
        ) : null}
        {passkeys.data?.map((passkey) => (
          <Stack
            key={passkey.id}
            direction={{ xs: 'column', sm: 'row' }}
            useFlexGap
            spacing="0.6rem"
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            data-testid={`passkey-${passkey.id}`}
          >
            <Box>
              <Typography variant="body2">
                {passkey.name.length > 0 ? passkey.name : t.security.unnamedPasskey}
              </Typography>
              <Typography variant="caption">
                {t.security.passkeyAddedAt({
                  date: new Date(passkey.createdAt).toLocaleDateString(language),
                })}
              </Typography>
            </Box>
            {confirmingPasskeyId === passkey.id ? (
              <Stack direction="row" useFlexGap spacing="0.4rem">
                <Button
                  size="small"
                  color="error"
                  variant="contained"
                  disabled={removePasskey.pending || proofPassword.length === 0}
                  onClick={() => removePasskey.run({
                    id: passkey.id,
                    password: proofPassword,
                  })}
                >
                  {removePasskey.pending
                    ? t.security.removingPasskey
                    : t.security.confirmRemovePasskey}
                </Button>
                <Button size="small" onClick={() => setConfirmingPasskeyId(null)}>
                  {t.common.cancel}
                </Button>
              </Stack>
            ) : (
              <Button
                size="small"
                color="error"
                onClick={() => setConfirmingPasskeyId(passkey.id)}
              >
                {t.security.removePasskey}
              </Button>
            )}
          </Stack>
        ))}
        {removePasskey.success ? (
          <Typography variant="caption" data-testid="passkey-removed">
            {t.security.passkeyRemoved}
          </Typography>
        ) : null}
        {removePasskey.error ? <Alert severity="error">{localizeError(removePasskey.error, t)}</Alert> : null}
        {passkeys.error ? (
          <Box>
            <Alert severity="error">{localizeError(passkeys.error, t)}</Alert>
            <Button size="small" sx={{ mt: '0.5rem' }} onClick={passkeys.retry}>
              {t.common.retry}
            </Button>
          </Box>
        ) : null}
      </Box>

      <Box component="section" sx={{ display: 'grid', gap: '0.8rem' }}>
        <Eyebrow variant="overline" component="h3">
          {t.security.twoFactor}
        </Eyebrow>
        <Box component="form" onSubmit={enrollTwoFactor} sx={{ display: 'grid', gap: '0.8rem' }}>
          <FormControl fullWidth>
            <FormLabel htmlFor="enable-2fa-password">{t.security.accountPasswordLabel}</FormLabel>
            <OutlinedInput
              id="enable-2fa-password"
              type="password"
              value={twoFactorPassword}
              onChange={(event) => setTwoFactorPassword(event.target.value)}
              inputProps={{ 'data-testid': 'enable-2fa-password' }}
              autoComplete="current-password"
            />
          </FormControl>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            useFlexGap
            spacing="0.6rem"
            sx={{ flexWrap: 'wrap', alignItems: { sm: 'flex-start' } }}
          >
            <Button
              type="submit"
              variant="outlined"
              data-testid="enable-2fa"
              disabled={enableTwoFactor.pending || twoFactorPassword.length === 0}
            >
              {enableTwoFactor.pending ? t.security.enabling : t.security.enableTwoFactor}
            </Button>
            <Button
              type="button"
              variant="outlined"
              data-testid="regenerate-backup-codes"
              disabled={regenerateBackupCodes.pending || twoFactorPassword.length === 0}
              onClick={() => regenerateBackupCodes.run({ password: twoFactorPassword })}
            >
              {regenerateBackupCodes.pending
                ? t.security.regeneratingBackupCodes
                : t.security.regenerateBackupCodes}
            </Button>
            <Button
              type="button"
              color="error"
              variant="text"
              data-testid="disable-2fa"
              disabled={disableTwoFactor.pending || twoFactorPassword.length === 0}
              onClick={() => disableTwoFactor.run({ password: twoFactorPassword })}
            >
              {disableTwoFactor.pending
                ? t.security.disablingTwoFactor
                : t.security.disableTwoFactor}
            </Button>
          </Stack>
        </Box>
        {enableTwoFactor.error ? <Alert severity="error">{localizeError(enableTwoFactor.error, t)}</Alert> : null}
        {regenerateBackupCodes.error ? (
          <Alert severity="error">{localizeError(regenerateBackupCodes.error, t)}</Alert>
        ) : null}
        {disableTwoFactor.error ? <Alert severity="error">{localizeError(disableTwoFactor.error, t)}</Alert> : null}
        {disableTwoFactor.success ? (
          <Typography variant="caption" data-testid="two-factor-disabled">
            {t.security.twoFactorOff}
          </Typography>
        ) : null}

        {enableTwoFactor.data ? (
          <Box sx={{ display: 'grid', gap: '0.8rem' }}>
            <Eyebrow variant="overline" component="h4">
              {t.security.scanOrCopyKey}
            </Eyebrow>
            <FormControl fullWidth>
              <FormLabel htmlFor="totp-uri">{t.security.otpauthUriLabel}</FormLabel>
              <OutlinedInput
                id="totp-uri"
                readOnly
                value={enableTwoFactor.data.totpURI}
                inputProps={{ 'data-testid': 'totp-uri' }}
              />
            </FormControl>
            <Box component="form" onSubmit={submitTotp} sx={{ display: 'grid', gap: '0.8rem' }}>
              <FormControl fullWidth>
                <FormLabel htmlFor="verify-totp-code">{t.security.authenticatorCodeLabel}</FormLabel>
                <OutlinedInput
                  id="verify-totp-code"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  inputProps={{ 'data-testid': 'verify-totp-code' }}
                  autoComplete="one-time-code"
                />
              </FormControl>
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  data-testid="verify-totp"
                  disabled={verifyTotp.pending || totpCode.trim().length === 0}
                >
                  {verifyTotp.pending ? t.security.verifying : t.security.verifyCode}
                </Button>
              </Box>
            </Box>
            {verifyTotp.success ? (
              <Typography variant="caption" component="p" data-testid="totp-verified">
                {t.security.twoFactorOn}
              </Typography>
            ) : null}
            {verifyTotp.error ? <Alert severity="error">{localizeError(verifyTotp.error, t)}</Alert> : null}
          </Box>
        ) : null}

        {backupCodes.length > 0 ? (
          <Box data-testid="backup-codes">
            <Typography variant="body2">{t.security.backupCodesIntro}</Typography>
            <Box component="ul" sx={{ display: 'grid', gap: '0.2rem', pl: '1.2rem', mb: 0 }}>
              {backupCodes.map((code) => (
                <Typography key={code} component="li" variant="caption">
                  {code}
                </Typography>
              ))}
            </Box>
            {regenerateBackupCodes.success ? (
              <Typography variant="caption" component="p" data-testid="backup-codes-regenerated">
                {t.security.backupCodesRegenerated}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Stack>
  );
};
