import { useEffect, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';

import type { TenantBranding } from '@core/domain/index.js';

import { actions } from './api.js';
import { hostHasTenantSubdomain } from './lib/tenant.js';
import { applyBranding } from './theme-branding.js';
import { Wordmark } from './theme.js';

/**
 * Branding rides on the public offer the SPA already fetches at boot
 * (TenantGate), so reading it here costs no extra request. Off tenant
 * subdomains (the apex picker) there is no tenant and thus no branding.
 */
const useTenantOffer = (hostname?: string): { name: string; branding: TenantBranding } | null => {
  const onSubdomain = hostHasTenantSubdomain(hostname ?? window.location.hostname);
  const offer = useQuery({ ...actions.publicOffer, enabled: onSubdomain });
  if (!onSubdomain || offer.data === undefined) return null;
  return { name: offer.data.tenant.name, branding: offer.data.tenant.branding };
};

export const useTenantBranding = (hostname?: string): TenantBranding | null =>
  useTenantOffer(hostname)?.branding ?? null;

/** Tenant logo for the member header (LedgerHeader slot); nothing without branding. */
export const TenantLogo = ({ hostname }: { hostname?: string } = {}) => {
  const tenant = useTenantOffer(hostname);
  if (tenant === null || tenant.branding.logoUrl === null) return null;
  return (
    <Box
      component="img"
      src={tenant.branding.logoUrl}
      alt={tenant.name}
      data-testid="tenant-logo"
      sx={{
        display: 'block',
        height: '2rem',
        maxWidth: '14rem',
        objectFit: 'contain',
        objectPosition: 'left center',
        mb: '0.9rem',
      }}
    />
  );
};

/** FocusCard brand slot (login/checkout): tenant logo, or the stock wordmark. */
export const BrandMark = ({ hostname }: { hostname?: string } = {}) => {
  const tenant = useTenantOffer(hostname);
  if (tenant === null || tenant.branding.logoUrl === null) {
    return (
      <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
        Together
      </Wordmark>
    );
  }
  return (
    <Box
      component="img"
      src={tenant.branding.logoUrl}
      alt={tenant.name}
      data-testid="tenant-brand-logo"
      sx={{
        display: 'block',
        height: '2.25rem',
        maxWidth: '16rem',
        objectFit: 'contain',
        objectPosition: 'left center',
        mb: '0.45rem',
      }}
    />
  );
};

/**
 * Applies the tenant accent over whatever theme is active and injects the
 * tenant favicon. Without branding it hands the outer theme through untouched
 * and leaves the document head alone — exactly today's look.
 */
export const TenantBrandingBoundary = ({
  children,
  hostname,
}: {
  children: ReactNode;
  hostname?: string;
}) => {
  const branding = useTenantBranding(hostname);
  const faviconUrl = branding?.faviconUrl ?? null;

  useEffect(() => {
    if (faviconUrl === null) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = faviconUrl;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [faviconUrl]);

  return (
    <ThemeProvider theme={(outer: Theme) => applyBranding(outer, branding)}>{children}</ThemeProvider>
  );
};
