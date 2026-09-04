import { useEffect, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { ThemeProvider, useTheme, type Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';

import {
  EMPTY_TENANT_BRANDING,
  resolveTenantLogo,
  type TenantBranding,
  type TenantSocialLink,
} from '#core/domain/index.js';

import { actions } from './api.js';
import { SocialLinksFooter } from './branding-social.js';
import { useTranslations } from './i18n/index.js';
import { isConfiguredBaseDomainHost } from './lib/tenant.js';
import { applyBranding } from './theme-branding.js';
import { CompactWordmark, ShellWordmark, Wordmark } from './theme.js';

/**
 * Branding rides on the public offer the SPA already fetches at boot
 * (TenantGate), so reading it here costs no extra request.
 */
const useTenantOffer = (enabled = !isConfiguredBaseDomainHost(window.location.hostname)): {
  name: string;
  branding: TenantBranding;
  socialLinks: TenantSocialLink[];
} | null => {
  const offer = useQuery({ ...actions.publicOffer, enabled });
  if (offer.data === undefined) return null;
  return {
    name: offer.data.tenant.name,
    branding: offer.data.tenant.branding,
    socialLinks: offer.data.tenant.socialLinks,
  };
};

export const useTenantBranding = (): TenantBranding | null =>
  useTenantOffer()?.branding ?? null;

/**
 * The active MUI palette mode already carries the resolved colour scheme, so the
 * variant follows a live theme toggle without reading the preference again.
 */
const useThemedLogo = (branding: TenantBranding): string | null => {
  const theme = useTheme();
  return resolveTenantLogo(branding, theme.palette.mode === 'dark' ? 'dark' : 'light');
};

export const TenantSocialLinks = ({
  links: providedLinks,
}: {
  links?: TenantSocialLink[];
} = {}) => {
  const t = useTranslations();
  const tenantLinks = useTenantOffer(providedLinks === undefined)?.socialLinks ?? [];
  const links = providedLinks ?? tenantLinks;
  if (links.length === 0) return null;
  return <SocialLinksFooter links={links} ariaLabel={t.branding.socialLinksAria} />;
};

export const TenantLogo = () => {
  const tenant = useTenantOffer();
  const logoUrl = useThemedLogo(tenant?.branding ?? EMPTY_TENANT_BRANDING);
  if (tenant === null) return null;
  if (logoUrl === null) {
    return (
      <ShellWordmark component="p" variant="h3" noWrap data-testid="tenant-name-mark">
        {tenant.name}
      </ShellWordmark>
    );
  }
  return (
    <Box
      component="img"
      src={logoUrl}
      alt={tenant.name}
      data-testid="tenant-logo"
      sx={{
        display: 'block',
        height: '2rem',
        maxWidth: '14rem',
        objectFit: 'contain',
        objectPosition: 'left center',
      }}
    />
  );
};

export const BrandMark = ({
  size = 'display',
  tenantAware = true,
}: {
  size?: 'display' | 'compact';
  tenantAware?: boolean;
}) => {
  const theme = useTheme();
  const tenant = useTenantOffer(tenantAware);
  const logoUrl = useThemedLogo(tenant?.branding ?? EMPTY_TENANT_BRANDING);
  const compact = size === 'compact';
  if (tenant === null) {
    return (
      <Box
        component="img"
        src={`/brand/together-horizontal-${theme.palette.mode}.svg`}
        alt="Together"
        sx={{ display: 'block', height: compact ? '1.5rem' : '2.5rem', mb: compact ? '0.2rem' : '0.6rem' }}
      />
    );
  }
  if (logoUrl === null) {
    if (compact) {
      return (
        <CompactWordmark variant="h1" data-testid="tenant-brand-name" sx={{ mb: '0.2rem' }}>
          {tenant.name}
        </CompactWordmark>
      );
    }
    return (
      <Wordmark variant="h1" data-testid="tenant-brand-name" sx={{ mb: '0.2rem' }}>
        {tenant.name}
      </Wordmark>
    );
  }
  return (
    <Box
      component="img"
      src={logoUrl}
      alt={tenant.name}
      data-testid="tenant-brand-logo"
      sx={{
        display: 'block',
        height: compact ? '1.5rem' : '2.25rem',
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
