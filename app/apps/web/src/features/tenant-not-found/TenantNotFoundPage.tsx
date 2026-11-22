import { useEffect, type ReactNode } from 'react';
import { Button, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { BootErrorCard } from '../../components/layout/BootErrorCard.js';
import { BrandLoader } from '../../components/layout/BrandLoader.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { isTenantHost, tenantUrl } from '../../lib/tenant.js';
import { CardTitle } from '../../theme.js';

const TenantNotFoundPage = () => {
  const t = useTranslations();
  return (
    <FocusCard eyebrow={t.tenantNotFound.eyebrow} data-testid="tenant-not-found">
      <CardTitle variant="h1">{t.tenantNotFound.title}</CardTitle>
      <Typography variant="body1" sx={{ mt: '1rem' }}>
        {t.tenantNotFound.body}
      </Typography>
      <Button
        component="a"
        href={tenantUrl('start')}
        variant="contained"
        fullWidth
        sx={{ mt: '1.5rem' }}
        data-testid="tenant-not-found-start"
      >
        {t.tenantNotFound.startCta}
      </Button>
      <Typography variant="caption" component="p" sx={{ mt: '1rem' }}>
        {t.tenantNotFound.hint}
      </Typography>
    </FocusCard>
  );
};

/**
 * Probes the public offer at SPA boot. On a tenant subdomain that fails to
 * resolve (`tenant_not_found`), a friendly 404 replaces the app instead of the
 * misleading login page; the apex picker and valid tenants render normally.
 */
export const TenantGate = ({
  children,
  hostname = window.location.hostname,
}: {
  children: ReactNode;
  hostname?: string;
}) => {
  const t = useTranslations();
  const { setTenantDefaultLanguage } = useLanguage();
  const onTenantHost = isTenantHost(hostname);
  const offer = useQuery({ ...actions.publicOffer, enabled: onTenantHost });
  const defaultLanguage = offer.data?.tenant.defaultLanguage;

  useEffect(() => {
    if (defaultLanguage !== undefined) setTenantDefaultLanguage(defaultLanguage);
  }, [defaultLanguage, setTenantDefaultLanguage]);

  if (!onTenantHost) return <>{children}</>;
  if (offer.isPending) {
    return <BrandLoader caption={t.common.loading} data-testid="tenant-gate-pending" />;
  }
  if (offer.error instanceof ApiError && offer.error.appError.code === 'tenant_not_found') {
    return <TenantNotFoundPage />;
  }
  if (offer.isError) {
    return (
      <BootErrorCard
        eyebrow={t.errors.bootEyebrow}
        title={t.errors.headingGeneric}
        message={localizeError(offer.error, t)}
        retry={{ label: t.common.retry, onRetry: () => void offer.refetch() }}
        data-testid="tenant-gate-error"
      />
    );
  }
  return <>{children}</>;
};
