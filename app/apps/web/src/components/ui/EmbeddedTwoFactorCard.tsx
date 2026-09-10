import { ShieldCheckIcon } from './account-icons.js';
import type { FormEvent } from 'react';
import { Box, Button, Chip, FormControl, FormLabel, OutlinedInput, Stack, Typography } from '@mui/material';
import { useTranslations } from '../../i18n/index.js';
import { AccountSection } from './AccountSection.js';
import { CopyField } from './CopyField.js';
import type { AuthenticationMethodsProps } from './authentication-methods-types.js';

type TwoFactorCardProps = Pick<AuthenticationMethodsProps, 'Card' | 'enableTwoFactor' | 'verifyTotp' | 'disableTwoFactor' | 'regenerateBackupCodes'> & {
  twoFactorPassword: string;
  setTwoFactorPassword(value: string): void;
  totpCode: string;
  setTotpCode(value: string): void;
  enrollTwoFactor(event: FormEvent): void;
  submitTotp(event: FormEvent): void;
  backupCodes: string[];
};

export const EmbeddedTwoFactorCard = ({ Card = AccountSection, enableTwoFactor, verifyTotp, disableTwoFactor, regenerateBackupCodes, twoFactorPassword, setTwoFactorPassword, totpCode, setTotpCode, enrollTwoFactor, submitTotp, backupCodes }: TwoFactorCardProps) => {
  const t = useTranslations();
  return (
      <Box data-account-wide>
      <Card icon={<ShieldCheckIcon />} title={t.security.twoFactor} description={t.security.twoFactorDescription}
        headerActions={<Chip size="small" variant="outlined" label={enableTwoFactor.data && !verifyTotp.success && !disableTwoFactor.success ? t.security.twoFactorStatusIncomplete : t.security.twoFactorStatusUnknown} />}>

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
              variant="contained"
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

        {enableTwoFactor.data && !disableTwoFactor.success ? (
          <Box sx={{ display: 'grid', gap: '0.8rem' }}>
            <Typography variant="body2">
              {t.security.scanOrCopyKey}
            </Typography>
            <CopyField
              mono
              label={t.security.otpauthUriLabel}
              value={enableTwoFactor.data.totpURI}
              testId="totp-uri"
            />
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
          </Box>
        ) : null}
      </Card>
      </Box>
  );
};
