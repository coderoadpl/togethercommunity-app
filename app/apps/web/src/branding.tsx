import { useEffect, type ReactNode } from 'react';
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
import { LogoImage } from './components/ui/LogoImage.js';
import { useTranslations } from './i18n/index.js';
import { isConfiguredBaseDomainHost } from './lib/tenant.js';
import { publicAssetUrl } from './theme-public-asset.js';
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
  return <LogoImage surface="sidebar" src={logoUrl} alt={tenant.name} data-testid="tenant-logo" />;
};

type BrandMarkSize = 'display' | 'compact' | 'shell';

const BRAND_SURFACE = { display: 'card', compact: 'compact', shell: 'sidebar' } as const;
const BRAND_LOGO_INSET = { display: '0.45rem', compact: '0.2rem', shell: 0 } as const;
const BRAND_TOGETHER_INSET = { display: '0.6rem', compact: '0.2rem', shell: 0 } as const;

const BrandWordmark = ({ size, name }: { size: BrandMarkSize; name: string }) => {
  if (size === 'shell') {
    return (
      <ShellWordmark component="p" variant="h3" noWrap data-testid="tenant-brand-name">
        {name}
      </ShellWordmark>
    );
  }
  if (size === 'compact') {
    return (
      <CompactWordmark variant="h1" data-testid="tenant-brand-name" sx={{ mb: '0.2rem' }}>
        {name}
      </CompactWordmark>
    );
  }
  return (
    <Wordmark variant="h1" data-testid="tenant-brand-name" sx={{ mb: '0.2rem' }}>
      {name}
    </Wordmark>
  );
};

export const BrandMark = ({
  size = 'display',
  tenantAware = true,
}: {
  size?: BrandMarkSize;
  tenantAware?: boolean;
}) => {
  const theme = useTheme();
  const tenant = useTenantOffer(tenantAware);
  const logoUrl = useThemedLogo(tenant?.branding ?? EMPTY_TENANT_BRANDING);
  if (tenant === null) {
    return (
      <LogoImage
        surface={BRAND_SURFACE[size]}
        src={publicAssetUrl(`/brand/together-horizontal-${theme.palette.mode}.svg`)}
        alt="Together"
        sx={{ mb: BRAND_TOGETHER_INSET[size] }}
      />
    );
  }
  if (logoUrl === null) return <BrandWordmark size={size} name={tenant.name} />;
  return (
    <LogoImage
      surface={BRAND_SURFACE[size]}
      src={logoUrl}
      alt={tenant.name}
      data-testid="tenant-brand-logo"
      sx={{ mb: BRAND_LOGO_INSET[size] }}
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
