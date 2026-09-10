import { Alert, Button, Chip, Stack } from '@mui/material';

import { AccountWrappingText } from '../../theme.js';
import { useTranslations } from '../../i18n/index.js';
import { useToastOutcome } from './Toast.js';

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
  useToastOutcome(
    resendSent,
    t.emailVerification.sent,
    resendError ? t.emailVerification.providerError : null,
  );

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem" sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', flexWrap: 'wrap' }} data-testid="email-verification-status">
      <Chip size="small" variant="outlined" color={emailVerified ? 'success' : 'warning'} label={emailVerified ? t.account.verified : t.account.unverified} />
      <AccountWrappingText variant="body2" component="div" sx={{ minWidth: 0, flex: 1 }}>
        {emailVerified
          ? t.emailVerification.verifiedStatus
          : t.emailVerification.pending({ email })}
      </AccountWrappingText>
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
    </Stack>
  );
};
