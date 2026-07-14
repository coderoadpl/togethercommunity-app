import type { ReactNode } from 'react';
import { Box, Container, Paper, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { useTranslations } from '../../i18n/index.js';
import { hostHasTenantSubdomain } from '../../lib/tenant.js';
import { CardTitle, Eyebrow } from '../../theme.js';

export const TenantNotFoundPage = () => {
  const t = useTranslations();
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        data-testid="tenant-not-found"
        sx={{ width: '100%', maxWidth: '32rem', px: '2rem', py: '2.5rem' }}
      >
        <Eyebrow variant="overline" component="p" align="center">
          404
        </Eyebrow>
        <CardTitle variant="h1" align="center" sx={{ mt: '0.5rem' }}>
          {t.tenantNotFound.title}
        </CardTitle>
        <Typography variant="body1" align="center" sx={{ mt: '1rem' }}>
          {t.tenantNotFound.body}
        </Typography>
        <Typography variant="caption" component="p" align="center" sx={{ mt: '1rem' }}>
          {t.tenantNotFound.hint}
        </Typography>
      </Paper>
    </Box>
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
  const onSubdomain = hostHasTenantSubdomain(hostname);
  const offer = useQuery({ ...actions.publicOffer, enabled: onSubdomain });

  if (!onSubdomain) return <>{children}</>;
  if (offer.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem' }} data-testid="tenant-gate-pending">
        <Box sx={{ py: 6 }} />
      </Container>
    );
  }
  if (offer.error instanceof ApiError && offer.error.appError.code === 'tenant_not_found') {
    return <TenantNotFoundPage />;
  }
  return <>{children}</>;
};
