import type { ReactNode } from 'react';
import { AppBar, Box, Toolbar, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Link } from '@tanstack/react-router';

import { TenantLogo } from '../../../branding.js';
import { useSuppressGlobalChrome } from '../../../components/ui/app-chrome.js';
import { ColorSchemeCycleButton } from '../../../components/ui/ColorSchemeSwitcher.js';
import { useToastError } from '../../../components/ui/Toast.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { AnonSidebar } from './AnonSidebar.js';
import { anonHomePath } from './member-nav.js';
import { BrandLink, PublicSignInButton, SidebarColumn } from './shell-chrome.js';
import { useVisitorSignOut } from './visitor-sign-out.js';

const COMPACT_PUBLIC_HEADER_QUERY = '(max-width:399px)';

const VisitorAccount = ({ email }: { email: string }) => {
  const t = useTranslations();
  const signOut = useVisitorSignOut();
  useToastError(signOut.isError ? localizeError(signOut.error, t) : null);
  return (
    <>
      <Typography
        variant="caption"
        component="p"
        noWrap
        color="text.secondary"
        data-testid="anon-visitor-email"
        sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0, maxWidth: '16rem' }}
      >
        {email}
      </Typography>
      <PublicSignInButton
        color="inherit"
        size="small"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
        data-testid="anon-sign-out"
      >
        {t.tenant.signOut}
      </PublicSignInButton>
    </>
  );
};

export const AnonShell = ({
  children,
  visitorEmail = null,
}: {
  children: ReactNode;
  visitorEmail?: string | null;
}) => {
  useSuppressGlobalChrome();
  const t = useTranslations();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const compactBrand = useMediaQuery(COMPACT_PUBLIC_HEADER_QUERY);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {isDesktop ? (
        <SidebarColumn component="aside">
          <AnonSidebar variant="drawer" />
        </SidebarColumn>
      ) : null}
      <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
        <AppBar position="sticky">
          <Toolbar variant="dense" sx={{ minHeight: '52px', px: '1.25rem', gap: '0.75rem' }}>
            <Box sx={{ display: { xs: 'flex', md: 'none' }, minWidth: 0 }}>
              <BrandLink
                component={Link}
                to={anonHomePath()}
                data-testid="shell-brand"
              >
                <TenantLogo compact={compactBrand} />
              </BrandLink>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <ColorSchemeCycleButton />
            </Box>
            {visitorEmail === null ? (
              <PublicSignInButton
                component={Link}
                to="/login"
                color="inherit"
                size="small"
              >
                {t.auth.signInLink}
              </PublicSignInButton>
            ) : (
              <VisitorAccount email={visitorEmail} />
            )}
          </Toolbar>
        </AppBar>
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            px: { xs: '1.25rem', md: '1.5rem' },
            pt: '2rem',
            pb: '2rem',
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
};
