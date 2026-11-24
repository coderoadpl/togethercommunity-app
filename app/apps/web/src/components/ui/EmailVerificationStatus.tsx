import type { ReactNode } from 'react';
import { Alert, Button, Chip, Stack } from '@mui/material';

import { AccountWrappingText } from '../../theme.js';
import { useTranslations } from '../../i18n/index.js';

type VerificationOutcome = 'verified' | 'expired' | 'invalid' | 'providerError';

export const emailVerificationOutcome = ({
  error,
  verification,
}: {
  error: string | null;
  verification: string | null;
}): VerificationOutcome | null => {
  if (error === 'TOKEN_EXPIRED') return 'expired';
  if (error === 'INVALID_TOKEN') return verification === 'verified' ? 'invalid' : null;
  if (error === 'USER_NOT_FOUND' || error === 'INVALID_USER') return 'providerError';
  return verification === 'verified' ? 'verified' : null;
};

export const isFailedEmailVerification = (outcome: VerificationOutcome | null): boolean =>
  outcome !== null && outcome !== 'verified';

export const EmailVerificationResult = ({
  outcome,
  resendAction,
}: {
  outcome: VerificationOutcome | null;
  resendAction: ReactNode;
}) => {
  const t = useTranslations();
  if (outcome === null) return null;
  const resendable = outcome === 'expired' || outcome === 'invalid';
  return (
    <Alert
      severity={outcome === 'verified' ? 'success' : 'error'}
      data-testid={`email-verification-${outcome}`}
      sx={{ mb: '1rem' }}
    >
      {t.emailVerification[outcome]}
      {resendable ? (
        <>
          {' '}
          {resendAction}
        </>
      ) : null}
    </Alert>
  );
};

export const EmailVerificationStatus = ({
  email,
  emailVerified,
  resendPending,
  onResend,
  audience = 'creator',
}: {
  email: string;
  emailVerified: boolean;
  resendPending: boolean;
  onResend: () => void;
  audience?: 'creator' | 'member';
}) => {
  const t = useTranslations();

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem" sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', flexWrap: 'wrap' }} data-testid="email-verification-status">
      <Chip size="small" variant="outlined" color={emailVerified ? 'success' : 'warning'} label={emailVerified ? t.account.verified : t.account.unverified} />
      <AccountWrappingText variant="body2" component="div" sx={{ minWidth: 0, flex: 1 }}>
        {emailVerified
          ? t.emailVerification.verifiedStatus
          : audience === 'member'
            ? t.emailVerification.pendingMember({ email })
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
