import type { ReactNode } from 'react';
import { ThemeProvider, useTheme, type Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { communitySpacePath } from '#core/contract/index.js';

import { actions } from '../../api.js';
import { BrandMark, TenantSocialLinks } from '../../branding.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { ColorSchemeCycleButton } from '../../components/ui/ColorSchemeSwitcher.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { useTranslations } from '../../i18n/index.js';
import { isConfiguredBaseDomainHost, usesPlatformAuthSurface } from '../../lib/tenant.js';
import {
  AuthBrandRow,
  AuthColumn,
  AuthControls,
  AuthFooter,
  AuthFooterLink,
  AuthFooterRow,
  AuthGlow,
  AuthHeader,
  authLinkInk,
  AuthMain,
  AuthPage,
  AuthPoweredBy,
  AuthPoweredByLogo,
  AuthStage,
} from './auth-chrome.js';

interface AuthShellProps {
  hostname?: string;
  footer?: ReactNode;
  children: ReactNode;
}

const authSurfaceTheme = (outer: Theme): Theme => ({
  ...outer,
  linkColor: authLinkInk(outer.palette.primary.main, outer.palette.mode),
});

const PoweredByTogether = () => {
  const t = useTranslations();
  const theme = useTheme();
  return (
    <AuthPoweredBy data-testid="auth-powered-by">
      <span>{t.auth.poweredBy}</span>
      <AuthPoweredByLogo
        src={`/brand/together-horizontal-${theme.palette.mode}.svg`}
        alt="Together"
        data-testid="auth-together-logo"
      />
    </AuthPoweredBy>
  );
};

const TenantFooter = ({ hostname }: { hostname: string }) => {
  const t = useTranslations();
  const offer = useQuery({ ...actions.publicOffer, enabled: !isConfiguredBaseDomainHost(hostname) });
  const navigation = useQuery(actions.publicNavigation);

  const legal = offer.data?.tenant.legal ?? null;
  const supportUrl = offer.data?.tenant.support.url ?? null;
  const homeSpaceId = navigation.data?.navigation.defaultHomeSpaceId ?? null;
  const hasCourses = (navigation.data?.navigation.courses.length ?? 0) > 0;

  return (
    <AuthFooter component="footer" data-testid="auth-footer">
      <AuthFooterRow data-testid="auth-footer-links">
        {hasCourses ? (
          <AuthFooterLink component={Link} to="/" data-testid="auth-footer-courses">
            {t.auth.footerCourses}
          </AuthFooterLink>
        ) : null}
        {homeSpaceId === null ? null : (
          <AuthFooterLink
            component={Link}
            to={communitySpacePath(homeSpaceId)}
            data-testid="auth-footer-community"
          >
            {t.auth.footerCommunity}
          </AuthFooterLink>
        )}
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
        {supportUrl === null ? null : (
          <AuthFooterLink href={supportUrl} data-testid="auth-footer-support">
            {t.auth.cannotSignIn}
          </AuthFooterLink>
        )}
      </AuthFooterRow>
      {offer.data === undefined || offer.data.tenant.socialLinks.length === 0 ? null : (
        <TenantSocialLinks links={offer.data.tenant.socialLinks} />
      )}
      <PoweredByTogether />
    </AuthFooter>
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
