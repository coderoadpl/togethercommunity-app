import { useEffect } from 'react';
import {
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { ThemeSwitcher } from '../../components/ui/ThemeSwitcher.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { BreakAllText } from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';

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
      <MemberSurface
        title={t.account.title}
        eyebrow={t.account.heading}
        state={{ kind: 'loading', label: t.common.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (me.isError) {
    return (
      <MemberSurface
        title={t.account.title}
        eyebrow={t.account.heading}
        state={{ kind: 'error', message: localizeError(me.error, t) }}
      />
    );
  }

  const email = me.data.email;
  const billingPortalUrl = tenantSettings.data?.settings.billingPortalUrl ?? null;

  return (
    <MemberSurface title={t.account.title} eyebrow={t.account.heading}>
      <Stack component="section" useFlexGap spacing="1.5rem">
        <SectionCard title={t.account.signedInAs}>
          <BreakAllText variant="body1" data-testid="account-email">
            {email}
          </BreakAllText>
        </SectionCard>

        <SectionCard title={t.account.passwordHeading} description={t.account.passwordIntro}>
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
              <StatusView state={{ kind: 'error', message: localizeError(requestPasswordReset.error, t) }} />
            ) : null}
        </SectionCard>

        {billingPortalUrl ? (
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

        <SectionCard title={t.account.preferencesHeading} description={t.account.preferencesIntro}>
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
            <LanguageSwitcher inline />
            <ThemeSwitcher inline />
          </Stack>
        </SectionCard>
      </Stack>
    </MemberSurface>
  );
};
