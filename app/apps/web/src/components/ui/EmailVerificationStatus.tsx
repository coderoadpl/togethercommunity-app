import { Alert, Button, Stack, Typography } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';

type VerificationOutcome = 'verified' | 'expired' | 'invalid' | 'providerError' | null;

const verificationOutcome = (): VerificationOutcome => {
  const search = new URLSearchParams(window.location.search);
  const error = search.get('error');
  if (error === 'TOKEN_EXPIRED') return 'expired';
  if (error === 'INVALID_TOKEN') return 'invalid';
  if (error === 'USER_NOT_FOUND' || error === 'INVALID_USER') return 'providerError';
  return search.get('verification') === 'verified' ? 'verified' : null;
};

export const EmailVerificationResult = () => {
  const t = useTranslations();
  const outcome = verificationOutcome();
  if (outcome === null) return null;
  return (
    <Alert
      severity={outcome === 'verified' ? 'success' : 'error'}
      data-testid={`email-verification-${outcome}`}
      sx={{ mb: '1rem' }}
    >
      {t.emailVerification[outcome]}
    </Alert>
  );
};

export const EmailVerificationStatus = ({
  email,
  emailVerified,
  resendPending,
  resendSent,
  resendError,
  onResend,
}: {
  email: string;
  emailVerified: boolean;
  resendPending: boolean;
  resendSent: boolean;
  resendError: boolean;
  onResend: () => void;
}) => {
  const t = useTranslations();

  return (
    <Stack useFlexGap spacing="0.8rem" data-testid="email-verification-status">
      <Typography variant="body2">
        {emailVerified
          ? t.emailVerification.verifiedStatus
          : t.emailVerification.pending({ email })}
      </Typography>
      {!emailVerified ? (
        <Button
          variant="outlined"
          data-testid="resend-verification-email"
          disabled={resendPending}
          onClick={onResend}
        >
          {resendPending ? t.emailVerification.sending : t.emailVerification.resend}
        </Button>
      ) : null}
      {resendSent ? <Alert severity="success">{t.emailVerification.sent}</Alert> : null}
      {resendError ? <Alert severity="error">{t.emailVerification.providerError}</Alert> : null}
    </Stack>
  );
};
