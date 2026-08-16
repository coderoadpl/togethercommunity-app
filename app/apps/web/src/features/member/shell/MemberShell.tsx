import type { ReactNode } from 'react';
import { Alert, AppBar, Box, Button, Toolbar, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../../api.js';
import { TenantLogo } from '../../../branding.js';
import { AppShell, StatusView } from '../../../components/layout/index.js';
import { useSuppressGlobalChrome } from '../../../components/ui/app-chrome.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { MemberAccountMenu } from '../MemberAccountMenu.js';
import { memberHomePath } from './member-nav.js';
import { MemberSidebar } from './MemberSidebar.js';
import { BrandLink } from './shell-chrome.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

export const MemberShell = () => {
  useSuppressGlobalChrome();
  const t = useTranslations();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const me = useQuery(actions.me);
  const tenant = me.data?.tenant ?? null;
  const isMember = tenant !== null && (tenant.memberId !== null || tenant.staffRole !== null);
  const identity = isMember && me.data !== undefined
    ? { name: me.data.name, email: me.data.email }
    : null;

  const brand = (
    <BrandLink component={Link} to={memberHomePath()} data-testid="shell-brand">
      <TenantLogo />
    </BrandLink>
  );

  const notices: ReactNode = (
    <>
      {me.isError && !isUnauthorized(me.error) ? (
        <StatusView
          surface={false}
          state={{
            kind: 'error',
            message: localizeError(me.error, t),
            retry: { label: t.common.retry, onRetry: () => void me.refetch() },
          }}
        />
      ) : null}
      {tenant?.banned === true ? <Alert severity="info">{t.community.bannedBanner}</Alert> : null}
    </>
  );

  if (!isMember && !me.isPending) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <AppBar position="fixed">
          <Toolbar sx={{ gap: '0.75rem' }}>
            {brand}
            <Box sx={{ flex: 1 }} />
            <Button component={Link} to="/login" color="inherit" size="small">
              {t.auth.signInLink}
            </Button>
          </Toolbar>
        </AppBar>
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <Toolbar />
          <Box sx={{ px: { xs: '1.25rem', md: '2rem' }, py: '2rem' }}>
            {notices}
            <Outlet />
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <AppShell
      isDesktop={isDesktop}
      mobileNavigationOpen={false}
      onMobileNavigationClose={() => undefined}
      mobileNavigationCloseLabel={t.panel.closeNavigation}
      header={(
        <>
          <Box sx={{ display: { xs: 'flex', md: 'none' }, minWidth: 0 }}>{brand}</Box>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: { xs: 'none', md: 'flex' } }}>
            <MemberAccountMenu />
          </Box>
        </>
      )}
      navigation={identity === null ? null : (
        <MemberSidebar
          name={identity.name}
          email={identity.email}
          liveNotifications={isDesktop}
        />
      )}
    >
      {notices}
      <Outlet />
    </AppShell>
  );
};
