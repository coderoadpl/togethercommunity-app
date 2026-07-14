import { useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { BreakAllText, CardTitle, Eyebrow, LedgerHeader } from '../../theme.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

export const MemberAccountPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const me = useQuery(actions.me);
  const tenantSettings = useQuery(actions.tenantSettings);

  const unauthorized = isUnauthorized(me.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  const requestPasswordReset = useMutation(actions.requestPasswordReset);

  if (me.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Typography variant="h2" component="p">
          {t.common.loading}
        </Typography>
      </Container>
    );
  }

  if (unauthorized) return null;

  if (me.isError) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Alert>{localizeError(me.error, t)}</Alert>
      </Container>
    );
  }

  const email = me.data.email;
  const billingPortalUrl = tenantSettings.data?.settings.billingPortalUrl ?? null;

  return (
    <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', pb: '6rem' }}>
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{t.account.title}</Typography>
          <Box sx={{ flex: 1 }} />
          <Link href="/my">{t.student.myCourses}</Link>
          <Link href="/">{t.common.home}</Link>
        </Stack>
        <Eyebrow variant="overline" component="p">
          {t.account.heading}
        </Eyebrow>
      </LedgerHeader>

      <Stack component="section" useFlexGap spacing="1.5rem" sx={{ mt: '48px' }}>
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <Eyebrow variant="overline" component="p">
            {t.account.signedInAs}
          </Eyebrow>
          <BreakAllText variant="body1" data-testid="account-email">
            {email}
          </BreakAllText>
        </Paper>

        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <Stack useFlexGap spacing="0.8rem">
            <CardTitle variant="h2">{t.account.passwordHeading}</CardTitle>
            <Typography variant="body2">{t.account.passwordIntro}</Typography>
            <Box>
              <Button
                variant="outlined"
                data-testid="account-reset-password"
                disabled={requestPasswordReset.isPending}
                onClick={() => requestPasswordReset.mutate({ email, language })}
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
              <Alert>
                {localizeError(requestPasswordReset.error, t)}
              </Alert>
            ) : null}
          </Stack>
        </Paper>

        {billingPortalUrl ? (
          <Paper elevation={1} sx={{ p: '1.5rem' }}>
            <Stack useFlexGap spacing="0.8rem">
              <CardTitle variant="h2">{t.account.billingHeading}</CardTitle>
              <Typography variant="body2">{t.account.billingIntro}</Typography>
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
            </Stack>
          </Paper>
        ) : null}
      </Stack>
    </Container>
  );
};
