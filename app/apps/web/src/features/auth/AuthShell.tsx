import type { ReactNode } from 'react';
import { ThemeProvider, useTheme, type Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { communitySpacePath } from '#core/contract/index.js';

import { publicAssetUrl } from '../../theme-public-asset.js';
import { actions } from '../../api.js';
import { BrandMark, TenantSocialLinks } from '../../branding.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { ColorSchemeCycleButton } from '../../components/ui/ColorSchemeSwitcher.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { useTranslations } from '../../i18n/index.js';
import { isConfiguredBaseDomainHost, usesPlatformAuthSurface } from '../../lib/tenant.js';
import {
  AuthAccentLink,
  AuthBrandRow,
  AuthColumn,
  AuthControls,
  AuthFooter,
  AuthFooterLink,
  AuthFooterRow,
  AuthGlow,
  AuthHeader,
  AuthHelp,
  authInk,
  AuthMain,
  AuthPage,
  AuthPoweredBy,
  AuthPoweredByLogo,
  AuthPublicNav,
  AuthPublicNavLink,
  AuthStage,
} from './auth-chrome.js';
import { CommunityOutlineIcon, CoursesOutlineIcon } from './auth-icons.js';

interface AuthShellProps {
  hostname?: string;
  footer?: ReactNode;
  children: ReactNode;
}

const authSurfaceTheme = (outer: Theme): Theme => ({
  ...outer,
  linkColor: authInk(outer),
});

const PoweredByTogether = ({ separated = false }: { separated?: boolean }) => {
  const t = useTranslations();
  const theme = useTheme();
  return (
    <AuthPoweredBy data-testid="auth-powered-by" sx={separated ? { mt: '0.35rem' } : undefined}>
      <span>{t.auth.poweredBy}</span>
      <AuthPoweredByLogo
        src={publicAssetUrl(`/brand/together-horizontal-${theme.palette.mode}.svg`)}
        alt="Together"
        data-testid="auth-together-logo"
      />
    </AuthPoweredBy>
  );
};

const usePublicSurface = (hostname: string) => {
  const offer = useQuery({ ...actions.publicOffer, enabled: !isConfiguredBaseDomainHost(hostname) });
  const navigation = useQuery(actions.publicNavigation);

  return {
    tenantName: offer.data?.tenant.name ?? null,
    legal: offer.data?.tenant.legal ?? null,
    supportUrl: offer.data?.tenant.support.url ?? null,
    socialLinks: offer.data?.tenant.socialLinks ?? [],
    homeSpaceId: navigation.data?.navigation.defaultHomeSpaceId ?? null,
    hasCourses: (navigation.data?.navigation.courses.length ?? 0) > 0,
  };
};

const TenantFooter = ({ hostname }: { hostname: string }) => {
  const t = useTranslations();
  const { tenantName, legal, supportUrl, socialLinks, homeSpaceId, hasCourses } = usePublicSurface(hostname);
  const hasLegal = legal?.termsUrl != null || legal?.privacyUrl != null;
  const hasPublicNav = hasCourses || homeSpaceId !== null;

  return (
    <AuthFooter component="footer" data-testid="auth-footer">
      {hasCourses && tenantName !== null ? (
        <AuthHelp component="p" data-testid="auth-footer-access">
          {t.auth.noAccessPrompt}{' '}
          <AuthAccentLink component={Link} to="/" data-testid="auth-footer-courses">
            {t.auth.noAccessLink({ tenant: tenantName })}
          </AuthAccentLink>
        </AuthHelp>
      ) : null}
      {supportUrl === null ? null : (
        <AuthHelp component="p" data-testid="auth-footer-help">
          {t.auth.cannotSignInPrompt}{' '}
          <AuthAccentLink href={supportUrl} data-testid="auth-footer-support">
            {t.auth.cannotSignInLink}
          </AuthAccentLink>
        </AuthHelp>
      )}
      {hasLegal ? (
        <AuthFooterRow data-testid="auth-footer-links">
          {legal?.termsUrl == null ? null : (
            <AuthFooterLink href={legal.termsUrl} data-testid="auth-footer-terms">
              {t.consent.terms}
            </AuthFooterLink>
          )}
          {legal?.privacyUrl == null ? null : (
            <AuthFooterLink href={legal.privacyUrl} data-testid="auth-footer-privacy">
              {t.auth.privacyPolicy}
            </AuthFooterLink>
          )}
        </AuthFooterRow>
      ) : null}
      {socialLinks.length === 0 ? null : <TenantSocialLinks links={socialLinks} />}
      {hasPublicNav ? <TenantPublicNav homeSpaceId={homeSpaceId} hasCourses={hasCourses} /> : null}
      <PoweredByTogether separated={hasPublicNav} />
    </AuthFooter>
  );
};

const TenantPublicNav = ({ homeSpaceId, hasCourses }: { homeSpaceId: string | null; hasCourses: boolean }) => {
  const t = useTranslations();

  return (
    <AuthPublicNav component="nav" aria-label={t.auth.publicNavLabel} data-testid="auth-public-nav">
      {hasCourses ? (
        <AuthPublicNavLink component={Link} to="/" data-testid="auth-public-nav-courses">
          <CoursesOutlineIcon />
          {t.auth.publicNavCourses}
        </AuthPublicNavLink>
      ) : null}
      {homeSpaceId === null ? null : (
        <AuthPublicNavLink
          component={Link}
          to={communitySpacePath(homeSpaceId)}
          data-testid="auth-public-nav-community"
        >
          <CommunityOutlineIcon />
          {t.auth.publicNavCommunity}
        </AuthPublicNavLink>
      )}
    </AuthPublicNav>
  );
};

export const AuthShell = ({
  hostname = window.location.hostname,
  footer,
  children,
}: AuthShellProps) => {
  useSuppressGlobalChrome();
  const t = useTranslations();
  const theme = useTheme();
  const platformSurface = usesPlatformAuthSurface(hostname);

  return (
    <ThemeProvider theme={authSurfaceTheme}>
      <AuthPage>
        {theme.brandAccent === undefined ? null : (
          <AuthGlow accent={theme.brandAccent} aria-hidden data-testid="auth-glow" />
        )}
        <AuthHeader component="header">
          <AuthBrandRow component={Link} to="/" aria-label={t.shell.start} data-testid="auth-brand">
            <BrandMark size="shell" tenantAware={!isConfiguredBaseDomainHost(hostname)} />
          </AuthBrandRow>
          <AuthControls role="group" aria-label={t.auth.preferences}>
            <LanguageSwitcher inline />
            <ColorSchemeCycleButton />
          </AuthControls>
        </AuthHeader>
        <AuthStage>
          <AuthColumn>
            <AuthMain component="main">
              {children}
              {footer}
            </AuthMain>
            {platformSurface ? (
              <AuthFooter component="footer" data-testid="auth-footer">
                <PoweredByTogether />
              </AuthFooter>
            ) : (
              <TenantFooter hostname={hostname} />
            )}
          </AuthColumn>
        </AuthStage>
      </AuthPage>
    </ThemeProvider>
  );
};
