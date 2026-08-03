import { useEffect, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';

import type { TenantBranding } from '#core/domain/index.js';

import { actions } from './api.js';
import { applyBranding } from './theme-branding.js';
import { Wordmark } from './theme.js';

/**
 * Branding rides on the public offer the SPA already fetches at boot
 * (TenantGate), so reading it here costs no extra request.
 */
const useTenantOffer = (): { name: string; branding: TenantBranding } | null => {
  const offer = useQuery(actions.publicOffer);
  if (offer.data === undefined) return null;
  return { name: offer.data.tenant.name, branding: offer.data.tenant.branding };
};

export const useTenantBranding = (): TenantBranding | null =>
  useTenantOffer()?.branding ?? null;

/** Tenant logo for the member header (LedgerHeader slot); nothing without branding. */
export const TenantLogo = () => {
  const tenant = useTenantOffer();
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
export const BrandMark = () => {
  const tenant = useTenantOffer();
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
}: {
  children: ReactNode;
}) => {
  const branding = useTenantBranding();
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
