import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import * as QRCode from 'qrcode';

import { localizeError, useTranslations } from '../../i18n/index.js';
import { copyText } from '../../lib/clipboard.js';
import { AccountBackupCode, AccountQrCanvas } from '../../theme.js';
import { AccountDialog } from './AccountDialog.js';
import { AccountHelp } from './AccountHelp.js';
import { ShieldCheckIcon } from './account-icons.js';
import { AccountSection } from './AccountSection.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { CopyField } from './CopyField.js';
import type { AuthenticationMethodsProps } from './authentication-methods-types.js';

type Props = Pick<
  AuthenticationMethodsProps,
  'Card' | 'enableTwoFactor' | 'verifyTotp' | 'disableTwoFactor' | 'regenerateBackupCodes'
> & {
  backupCodes: string[];
  twoFactorEnabled: boolean;
  onSecurityRefresh(): void;
};

type Step = 'password' | 'qr' | 'verify' | 'codes' | 'done';
type Mode = 'enable' | 'disable' | 'regenerate' | 'regenerated' | null;

const secretFrom = (totpUri: string): string => {
  try {
    return new URL(totpUri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
};

const TotpQrCode = ({ value, label }: { value: string; label: string }) => {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvas.current === null) return;
    void QRCode.toCanvas(canvas.current, value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    }).catch(() => undefined);
  }, [value]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <AccountQrCanvas
        ref={canvas}
        role="img"
        aria-label={label}
        data-testid="two-factor-qr-code"
      />
    </Box>
  );
};

const BackupCodes = ({
  codes,
  finishLabel,
  onFinish,
}: {
  codes: string[];
  finishLabel: string;
  onFinish(): void;
}) => {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = `${codes.join('\n')}\n`;

  const copyAll = async () => {
    if (await copyText(text)) setCopied(true);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'two-factor-backup-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack useFlexGap spacing="1rem" data-testid="backup-codes">
      <Typography variant="body2">{t.security.backupCodesIntro}</Typography>
      {codes.length > 0 ? <>
        <Box component="ul" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '0.35rem 1rem', pl: '1.5rem', my: 0 }}>
          {codes.map((backupCode) => <AccountBackupCode key={backupCode} component="li">{backupCode}</AccountBackupCode>)}
        </Box>
        <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" data-testid="backup-codes-copy" onClick={() => void copyAll()}>
            {copied ? t.security.backupCodesCopied : t.security.copyBackupCodes}
          </Button>
          <Button variant="outlined" data-testid="backup-codes-download" onClick={download}>
            {t.security.downloadBackupCodes}
          </Button>
        </Stack>
        <FormControlLabel
          control={<Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)} />}
          label={t.security.backupCodesSaved}
        />
      </> : null}
      <Box>
        <Button variant="contained" data-testid="two-factor-finish" disabled={codes.length > 0 && !saved} onClick={onFinish}>
          {finishLabel}
        </Button>
      </Box>
    </Stack>
  );
};

export const TwoFactorCard = ({
  Card = AccountSection,
  enableTwoFactor,
  verifyTotp,
  disableTwoFactor,
  regenerateBackupCodes,
  backupCodes,
  twoFactorEnabled,
  onSecurityRefresh,
}: Props) => {
  const t = useTranslations();
  const [mode, setMode] = useState<Mode>(null);
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const verifiedInRun = useRef(false);

  useEffect(() => {
    if (mode === 'enable' && step === 'password' && enableTwoFactor.success && enableTwoFactor.submittedAt > startedAt) {
      setPassword('');
      setStep('qr');
    }
    if (mode === 'enable' && step === 'verify' && verifyTotp.success && verifyTotp.submittedAt > startedAt) {
      verifiedInRun.current = true;
      setCode('');
      setStep('codes');
    }
    if (mode === 'regenerate' && regenerateBackupCodes.success && regenerateBackupCodes.submittedAt > startedAt) {
      setPassword('');
      setMode('regenerated');
    }
    if (mode === 'disable' && disableTwoFactor.success && disableTwoFactor.submittedAt > startedAt) {
      setPassword('');
      setMode(null);
      onSecurityRefresh();
    }
  }, [
    disableTwoFactor.submittedAt,
    disableTwoFactor.success,
    enableTwoFactor.submittedAt,
    enableTwoFactor.success,
    mode,
    onSecurityRefresh,
    regenerateBackupCodes.submittedAt,
    regenerateBackupCodes.success,
    startedAt,
    step,
    verifyTotp.submittedAt,
    verifyTotp.success,
  ]);

  const close = () => {
    if (verifiedInRun.current) {
      verifiedInRun.current = false;
      onSecurityRefresh();
    }
    setMode(null);
    setStep('password');
    setPassword('');
    setCode('');
  };
  const openEnable = () => {
    verifiedInRun.current = false;
    setPassword('');
    setCode('');
    setStep('password');
    setStartedAt(enableTwoFactor.submittedAt);
    setMode('enable');
  };
  const openManagement = (next: 'disable' | 'regenerate') => {
    setPassword('');
    setStartedAt(next === 'disable' ? disableTwoFactor.submittedAt : regenerateBackupCodes.submittedAt);
    setMode(next);
  };
  const submitPassword = () => {
    if (password.length === 0 || enableTwoFactor.pending) return;
    enableTwoFactor.run({ password });
  };
  const submitCode = (nextCode: string) => {
    if (nextCode.length !== 6 || verifyTotp.pending) return;
    setStartedAt(verifyTotp.submittedAt);
    verifyTotp.run({ code: nextCode });
  };
  const submitManagement = () => {
    if (password.length === 0) return;
    if (mode === 'regenerate' && !regenerateBackupCodes.pending) regenerateBackupCodes.run({ password });
    if (mode === 'disable' && !disableTwoFactor.pending) disableTwoFactor.run({ password });
  };
  const passwordField = (
    <FormControl fullWidth>
      <FormLabel htmlFor="enable-2fa-password">{t.security.accountPasswordLabel}</FormLabel>
      <OutlinedInput
        id="enable-2fa-password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || mode === 'enable') return;
          event.preventDefault();
          submitManagement();
        }}
        inputProps={{ 'data-testid': 'enable-2fa-password' }}
      />
    </FormControl>
  );
  const enrollment = enableTwoFactor.data;
  const enrollmentCodes = enrollment?.backupCodes ?? [];

  return (
    <Card
      icon={<ShieldCheckIcon />}
      title={t.security.twoFactor}
      description={t.security.twoFactorDescription}
      headerActions={<Chip size="small" color={twoFactorEnabled ? 'success' : 'default'} variant="outlined" label={twoFactorEnabled ? t.security.twoFactorStatusOn : t.security.twoFactorStatusOff} />}
    >
      {twoFactorEnabled ? (
        <Stack data-testid="two-factor-manage" direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" data-testid="regenerate-backup-codes" onClick={() => openManagement('regenerate')}>
            {t.security.regenerateBackupCodes}
          </Button>
          <Button color="error" variant="text" data-testid="disable-2fa-open" onClick={() => openManagement('disable')}>
            {t.security.disableTwoFactor}
          </Button>
        </Stack>
      ) : (
        <Box>
          <Button variant="contained" data-testid="enable-2fa-open" onClick={openEnable}>
            {t.security.enableTwoFactor}
          </Button>
        </Box>
      )}

      <AccountDialog open={mode === 'enable'} title={t.security.twoFactor} pending={enableTwoFactor.pending || verifyTotp.pending} onClose={close}>
        <Typography variant="body2" data-testid="two-factor-step">{t.security.wizardSteps[step]}</Typography>
        {step === 'password' ? (
          <Box component="form" onSubmit={(event) => { event.preventDefault(); submitPassword(); }} sx={{ display: 'grid', gap: '1rem' }}>
            {passwordField}
            <Box><Button type="submit" variant="contained" disabled={enableTwoFactor.pending || password.length === 0} data-testid="enable-2fa">{enableTwoFactor.pending ? t.security.enabling : t.security.continueSetup}</Button></Box>
            {enableTwoFactor.error ? <Alert severity="error">{localizeError(enableTwoFactor.error, t)}</Alert> : null}
          </Box>
        ) : null}
        {step === 'qr' && enrollment !== undefined ? (
          <Stack useFlexGap spacing="1rem">
            <Typography variant="body2">{t.security.scanQrCode}</Typography>
            <TotpQrCode value={enrollment.totpURI} label={t.security.qrCodeLabel} />
            <AccountHelp title={t.security.manualSetup} testId="two-factor-manual-setup">
              <Stack useFlexGap spacing="0.75rem" sx={{ mt: '0.75rem' }}>
                <CopyField mono label={t.security.secretLabel} value={secretFrom(enrollment.totpURI)} testId="totp-secret" />
                <CopyField mono label={t.security.otpauthUriLabel} value={enrollment.totpURI} testId="totp-uri" />
              </Stack>
            </AccountHelp>
            <Box><Button variant="contained" data-testid="two-factor-next" onClick={() => { setStartedAt(verifyTotp.submittedAt); setStep('verify'); }}>{t.security.continueSetup}</Button></Box>
          </Stack>
        ) : null}
        {step === 'verify' ? (
          <Box component="form" onSubmit={(event) => { event.preventDefault(); submitCode(code); }} sx={{ display: 'grid', gap: '1rem' }}>
            <FormControl fullWidth error={verifyTotp.error !== null}>
              <FormLabel htmlFor="verify-totp-code">{t.security.authenticatorCodeLabel}</FormLabel>
              <OutlinedInput
                id="verify-totp-code"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => {
                  const nextCode = event.target.value.replace(/\D/gu, '').slice(0, 6);
                  setCode(nextCode);
                  submitCode(nextCode);
                }}
                inputProps={{ 'data-testid': 'verify-totp-code', inputMode: 'numeric', maxLength: 6 }}
              />
            </FormControl>
            {verifyTotp.error ? <Alert severity="error" data-testid="verify-totp-error">{localizeError(verifyTotp.error, t)}</Alert> : null}
            <Box><Button variant="contained" type="submit" data-testid="verify-totp" disabled={verifyTotp.pending || code.length !== 6}>{verifyTotp.pending ? t.security.verifying : t.security.verifyCode}</Button></Box>
          </Box>
        ) : null}
        {step === 'codes' ? (
          <BackupCodes
            codes={enrollmentCodes}
            finishLabel={t.security.finishSetup}
            onFinish={() => {
              verifiedInRun.current = false;
              setStep('done');
              onSecurityRefresh();
            }}
          />
        ) : null}
        {step === 'done' ? (
          <Stack useFlexGap spacing="1rem" data-testid="two-factor-done">
            <Typography>{t.security.setupComplete}</Typography>
            <Box><Button variant="contained" data-testid="two-factor-done-close" onClick={close}>{t.common.close}</Button></Box>
          </Stack>
        ) : null}
      </AccountDialog>

      <ConfirmDialog
        open={mode === 'regenerate'}
        title={t.security.regenerateBackupCodes}
        body={<>{passwordField}{regenerateBackupCodes.error ? <Alert severity="error">{localizeError(regenerateBackupCodes.error, t)}</Alert> : null}</>}
        confirmLabel={regenerateBackupCodes.pending ? t.security.regeneratingBackupCodes : t.security.regenerateBackupCodes}
        cancelLabel={t.common.cancel}
        pending={regenerateBackupCodes.pending}
        confirmDisabled={password.length === 0}
        confirmColor="primary"
        confirmTestId="regenerate-backup-codes-confirm"
        onConfirm={submitManagement}
        onClose={close}
      />
      <AccountDialog open={mode === 'regenerated'} title={t.security.regenerateBackupCodes} onClose={close}>
        {backupCodes.length > 0 ? <BackupCodes codes={backupCodes} finishLabel={t.common.close} onFinish={close} /> : null}
      </AccountDialog>
      <ConfirmDialog
        open={mode === 'disable'}
        title={t.security.disableTwoFactor}
        body={<><Typography>{t.security.disableTwoFactorConfirm}</Typography>{passwordField}{disableTwoFactor.error ? <Alert severity="error">{localizeError(disableTwoFactor.error, t)}</Alert> : null}</>}
        confirmLabel={disableTwoFactor.pending ? t.security.disablingTwoFactor : t.security.disableTwoFactor}
        cancelLabel={t.common.cancel}
        pending={disableTwoFactor.pending}
        confirmDisabled={password.length === 0}
        confirmTestId="disable-2fa"
        onConfirm={submitManagement}
        onClose={close}
      />
    </Card>
  );
};
