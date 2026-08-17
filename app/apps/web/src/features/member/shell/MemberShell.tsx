import { useEffect, useState, type ReactNode } from 'react';
import { Alert, AppBar, Box, Button, Toolbar, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../../api.js';
import { TenantLogo } from '../../../branding.js';
import { StatusView } from '../../../components/layout/index.js';
import { useSuppressGlobalChrome } from '../../../components/ui/app-chrome.js';
import { ColorSchemeSwitcher } from '../../../components/ui/ColorSchemeSwitcher.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { NotificationBell } from '../../../NotificationBell.js';
import { MemberAccountMenu } from '../MemberAccountMenu.js';
import { CourseSidebar } from './CourseSidebar.js';
import { MemberBottomBar } from './MemberBottomBar.js';
import { courseContextFromPath, memberHomePath } from './member-nav.js';
import { CourseProgramSheet, MemberMenuSheet } from './MemberMenuSheet.js';
import { MemberSidebar } from './MemberSidebar.js';
import { BrandLink, SidebarColumn } from './shell-chrome.js';
import { ProgramIcon } from './shell-icons.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

export const MemberShell = () => {
  useSuppressGlobalChrome();
  const t = useTranslations();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const me = useQuery(actions.me);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const courseContext = courseContextFromPath(pathname);
  const [openSheet, setOpenSheet] = useState<'menu' | 'program' | null>(null);

  useEffect(() => {
    setOpenSheet(null);
  }, [pathname]);

  const tenant = me.data?.tenant ?? null;
  const isMember = tenant !== null && (tenant.memberId !== null || tenant.staffRole !== null);
  const identity = isMember && tenant !== null && me.data !== undefined
    ? { name: me.data.name, email: me.data.email, tenantName: tenant.name }
    : null;

  const hasMobileNavigation = identity !== null && !isDesktop;
  const closeSheet = () => setOpenSheet(null);

  const sidebar = identity === null || !isDesktop ? null : courseContext === null ? (
    <MemberSidebar name={identity.name} email={identity.email} variant="drawer" />
  ) : (
    <CourseSidebar
      courseId={courseContext.courseId}
      currentLessonId={courseContext.lessonId}
      tenantName={identity.tenantName}
      variant="drawer"
    />
  );

  const mobileNavigation = !hasMobileNavigation || identity === null ? null : (
    <>
      <MemberBottomBar menuOpen={openSheet === 'menu'} onOpenMenu={() => setOpenSheet('menu')} />
      <MemberMenuSheet
        open={openSheet === 'menu'}
        onClose={closeSheet}
        name={identity.name}
        email={identity.email}
      />
      {courseContext === null ? null : (
        <CourseProgramSheet
          open={openSheet === 'program'}
          onClose={closeSheet}
          courseId={courseContext.courseId}
          currentLessonId={courseContext.lessonId}
          tenantName={identity.tenantName}
        />
      )}
    </>
  );

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
    <>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        {sidebar === null ? null : <SidebarColumn component="aside">{sidebar}</SidebarColumn>}
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <AppBar position="sticky">
            <Toolbar variant="dense" sx={{ minHeight: '52px', px: '1.25rem', gap: '0.75rem' }}>
              <Box sx={{ display: { xs: 'flex', md: 'none' }, minWidth: 0 }}>{brand}</Box>
              <Box sx={{ flex: 1 }} />
              {hasMobileNavigation && courseContext !== null ? (
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<ProgramIcon />}
                  aria-haspopup="dialog"
                  aria-expanded={openSheet === 'program' ? true : undefined}
                  onClick={() => setOpenSheet('program')}
                  data-testid="program-button"
                >
                  {t.shell.programButton}
                </Button>
              ) : null}
              {hasMobileNavigation ? <NotificationBell /> : null}
              <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center' }}>
                <ColorSchemeSwitcher compact />
              </Box>
              <Box sx={{ display: { xs: 'none', md: 'flex' } }}>
                <MemberAccountMenu />
              </Box>
            </Toolbar>
          </AppBar>
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              minWidth: 0,
              px: { xs: '1.25rem', md: '1.5rem' },
              pt: '2rem',
              pb: hasMobileNavigation ? 'calc(4.5rem + env(safe-area-inset-bottom))' : '2rem',
            }}
          >
            {notices}
            <Outlet />
          </Box>
        </Box>
      </Box>
      {mobileNavigation}
    </>
  );
};
