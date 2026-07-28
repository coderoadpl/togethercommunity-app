import { useEffect, useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

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
  const billingOrders = useQuery(actions.memberBillingOrders);
  const tenantSettings = useQuery(actions.tenantSettings);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportBody, setSupportBody] = useState('');
  const support = useMutation(actions.sendSupportMessage);

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
  const billedOrders = billingOrders.data?.orders ?? [];

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

        {tenantSettings.data?.settings.supportEmail !== null &&
        tenantSettings.data?.settings.supportEmail !== undefined ? (
          <SectionCard
            title={t.support.heading}
            description={t.support.intro}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              support.mutate({ subject: supportSubject, body: supportBody });
            }}
          >
            <FormControl fullWidth>
              <FormLabel htmlFor="support-subject">{t.support.subjectLabel}</FormLabel>
              <OutlinedInput
                id="support-subject"
                value={supportSubject}
                onChange={(event) => setSupportSubject(event.target.value)}
                required
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel htmlFor="support-body">{t.support.bodyLabel}</FormLabel>
              <OutlinedInput
                id="support-body"
                multiline
                minRows={5}
                value={supportBody}
                onChange={(event) => setSupportBody(event.target.value)}
                required
              />
            </FormControl>
            <Button type="submit" variant="contained" disabled={support.isPending}>
              {support.isPending ? t.support.sending : t.support.send}
            </Button>
            {support.isSuccess ? <Typography>{t.support.sent}</Typography> : null}
            {support.isError ? (
              <StatusView state={{ kind: 'error', message: localizeError(support.error, t) }} />
            ) : null}
          </SectionCard>
        ) : null}

        {tenantSettings.data?.settings.supportUrl ? (
          <Button
            component="a"
            href={tenantSettings.data.settings.supportUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t.support.externalLink}
          </Button>
        ) : null}

        {billedOrders.length > 0 ? (
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
