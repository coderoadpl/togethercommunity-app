import { Suspense, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Alert, AppBar, Box, Button, IconButton, Toolbar, Tooltip, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../../api.js';
import { TenantLogo } from '../../../branding.js';
import { StatusView } from '../../../components/layout/index.js';
import { useSuppressGlobalChrome } from '../../../components/ui/app-chrome.js';
import { ColorSchemeCycleButton } from '../../../components/ui/ColorSchemeSwitcher.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { NotificationBell } from '../../../NotificationBell.js';
import { MemberAccountMenu } from '../MemberAccountMenu.js';
import { StudioIcon } from '../account-icons.js';
import { useCanOpenStudio, useViewerKind } from '../viewer.js';
import { CourseLoading } from '../CourseLoading.js';
import { AnonShell } from './AnonShell.js';
import { CourseBreadcrumbs } from './CourseBreadcrumbs.js';
import { CourseSidebar } from './CourseSidebar.js';
import { ImpersonationBanner } from './ImpersonationBanner.js';
import { MemberBottomBar } from './MemberBottomBar.js';
import { courseContextFromPath, memberHomePath } from './member-nav.js';
import { CourseProgramSheet, MemberMenuSheet } from './MemberMenuSheet.js';
import { MemberSidebar } from './MemberSidebar.js';
import { BrandLink, SidebarColumn } from './shell-chrome.js';
import { ProgramIcon } from './shell-icons.js';

const TOOLBAR_MIN_HEIGHT = 52;

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isNotFound = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'not_found';

export const MemberShell = () => {
  useSuppressGlobalChrome();
  const t = useTranslations();
  const theme = useTheme();
  const me = useQuery(actions.me);
  const viewer = useViewerKind();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const courseContext = courseContextFromPath(pathname);
  const courseStructure = useQuery({
    ...actions.courseStructure(courseContext?.courseId ?? ''),
    enabled: viewer === 'member' && courseContext !== null,
  });
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [openSheet, setOpenSheet] = useState<'menu' | 'program' | null>(null);
  const [mobileKeyboardActive, setMobileKeyboardActive] = useState(false);
  const canOpenStudio = useCanOpenStudio();
  const shellRef = useRef<HTMLDivElement>(null);
  const appBarRef = useRef<HTMLElement>(null);
  const mobileKeyboardAnchorRef = useRef<Element | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const appBar = appBarRef.current;
    if (shell === null || appBar === null) return;
    const measure = () => shell.style.setProperty('--member-app-bar-height', `${appBar.getBoundingClientRect().height}px`);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(appBar);
    return () => observer.disconnect();
  }, [viewer]);

  useEffect(() => {
    setOpenSheet(null);
    mobileKeyboardAnchorRef.current = null;
    setMobileKeyboardActive(false);
  }, [pathname]);

  useEffect(() => {
    const shell = shellRef.current;
    const anchor = mobileKeyboardAnchorRef.current;
    if (!mobileKeyboardActive || shell === null || anchor === null) return;
    const observer = new MutationObserver(() => {
      if (anchor.isConnected || mobileKeyboardAnchorRef.current !== anchor) return;
      mobileKeyboardAnchorRef.current = null;
      setMobileKeyboardActive(false);
    });
    observer.observe(shell, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [mobileKeyboardActive]);

  const tenant = me.data?.tenant ?? null;
  const isMember = viewer === 'member';
  const identity = isMember && tenant !== null && me.data !== undefined
    ? {
      name: tenant.displayName ?? me.data.name,
      email: me.data.email,
      avatarUrl: me.data.avatarUrl,
      tenantName: tenant.name,
    }
    : null;

  const courseNotFound = courseStructure.isError && isNotFound(courseStructure.error);
  const activeCourseContext = courseContext !== null && !courseNotFound ? courseContext : null;
  const lessonCrumbs = activeCourseContext === null || activeCourseContext.lessonId === null
    ? null
    : { courseId: activeCourseContext.courseId, lessonId: activeCourseContext.lessonId };
  const hasMobileNavigation = identity !== null && !isDesktop;
  const showBannedBanner = tenant?.banned === true;
  const closeSheet = () => setOpenSheet(null);
  const mobileKeyboardAnchor = (target: EventTarget): Element | null =>
    target instanceof Element ? target.closest('[data-mobile-keyboard-anchor]') : null;
  const handleMobileFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!hasMobileNavigation) return;
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return;
    const anchor = mobileKeyboardAnchor(event.target);
    if (anchor === null) return;
    if (mobileKeyboardAnchorRef.current === anchor) return;
    mobileKeyboardAnchorRef.current = anchor;
    setMobileKeyboardActive(true);
    anchor.scrollIntoView({ block: 'center' });
  };
  const handleMobileBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!hasMobileNavigation) return;
    const anchor = mobileKeyboardAnchor(event.target);
    if (anchor === null) return;
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    if (mobileKeyboardAnchorRef.current !== anchor) return;
    mobileKeyboardAnchorRef.current = null;
    setMobileKeyboardActive(false);
  };

  const memberSidebar = identity === null ? null : (
    <MemberSidebar
      name={identity.name}
      email={identity.email}
      avatarUrl={identity.avatarUrl}
      variant="drawer"
    />
  );

  const sidebar = identity === null || !isDesktop ? null : activeCourseContext === null ? memberSidebar : (
    <CourseSidebar
      courseId={activeCourseContext.courseId}
      currentLessonId={activeCourseContext.lessonId}
      tenantName={identity.tenantName}
      notFoundFallback={memberSidebar}
    />
  );

  const mobileNavigation = !hasMobileNavigation || identity === null ? null : (
    <>
      {mobileKeyboardActive ? null : (
        <MemberBottomBar menuOpen={openSheet === 'menu'} onOpenMenu={() => setOpenSheet('menu')} />
      )}
      <MemberMenuSheet
        open={openSheet === 'menu'}
        onClose={closeSheet}
        name={identity.name}
        email={identity.email}
        avatarUrl={identity.avatarUrl}
      />
      {activeCourseContext === null ? null : (
        <CourseProgramSheet
          open={openSheet === 'program'}
          onClose={closeSheet}
          courseId={activeCourseContext.courseId}
          currentLessonId={activeCourseContext.lessonId}
          tenantName={identity.tenantName}
          notFoundFallback={(
            <MemberSidebar
              name={identity.name}
              email={identity.email}
              avatarUrl={identity.avatarUrl}
              variant="sheet"
            />
          )}
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
      {showBannedBanner ? <Alert severity="info">{t.community.bannedBanner}</Alert> : null}
    </>
  );

  const outlet = courseContext === null ? <Outlet /> : (
    <Suspense fallback={<CourseLoading lesson={courseContext.lessonId !== null} anonymous={viewer === 'anonymous'} />}>
      <Outlet />
    </Suspense>
  );

  if (viewer === 'anonymous') {
    return (
      <AnonShell>
        {notices}
        {outlet}
      </AnonShell>
    );
  }

  return (
    <>
      <Box
        ref={shellRef}
        onFocusCapture={handleMobileFocus}
        onBlurCapture={handleMobileBlur}
        sx={{ display: 'flex', minHeight: '100vh', '--member-app-bar-height': `${TOOLBAR_MIN_HEIGHT + 1}px` }}
      >
        {sidebar === null ? null : (
          <SidebarColumn
            component="aside"
            sx={activeCourseContext === null ? undefined : {
              top: 'var(--member-app-bar-height)',
              mt: 'var(--member-app-bar-height)',
              height: 'calc(100dvh - var(--member-app-bar-height))',
              maxHeight: 'calc(100dvh - var(--member-app-bar-height))',
              overflowY: 'auto',
            }}
          >
            {sidebar}
          </SidebarColumn>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <AppBar ref={appBarRef} position="sticky">
            <Toolbar variant="dense" sx={{ minHeight: `${TOOLBAR_MIN_HEIGHT}px`, px: '1.25rem', gap: '0.75rem' }}>
              {lessonCrumbs === null ? (
                <Box sx={{ display: { xs: 'flex', md: 'none' }, flex: '1 1 auto', minWidth: 0 }}>
                  {brand}
                </Box>
              ) : null}
              <Box
                data-testid="shell-breadcrumbs"
                sx={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  overflow: 'hidden',
                }}
              >
                {lessonCrumbs === null ? null : (
                  <CourseBreadcrumbs
                    courseId={lessonCrumbs.courseId}
                    lessonId={lessonCrumbs.lessonId}
                  />
                )}
              </Box>
              {hasMobileNavigation && activeCourseContext !== null ? (
                <>
                  <IconButton
                    color="inherit"
                    size="small"
                    aria-label={t.shell.programButton}
                    aria-haspopup="dialog"
                    aria-expanded={openSheet === 'program' ? true : undefined}
                    onClick={() => setOpenSheet('program')}
                    data-testid="program-button"
                    sx={{ display: { xs: 'inline-flex', sm: 'none' }, flexShrink: 0 }}
                  >
                    <ProgramIcon />
                  </IconButton>
                  <Button
                    color="inherit"
                    size="small"
                    startIcon={<ProgramIcon />}
                    aria-haspopup="dialog"
                    aria-expanded={openSheet === 'program' ? true : undefined}
                    onClick={() => setOpenSheet('program')}
                    data-testid="program-button-wide"
                    sx={{ display: { xs: 'none', sm: 'inline-flex' }, flexShrink: 0 }}
                  >
                    {t.shell.programButton}
                  </Button>
                </>
              ) : null}
              {canOpenStudio ? (
                <Tooltip title={t.account.menuStudio}>
                  <Button
                    component={Link}
                    to="/panel"
                    color="inherit"
                    size="small"
                    startIcon={<StudioIcon />}
                    data-testid="member-studio-link"
                    sx={{ minHeight: '44px', minWidth: '44px', flexShrink: 0 }}
                  >
                    {t.account.menuStudio}
                  </Button>
                </Tooltip>
              ) : null}
              <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center' }}>
                <ColorSchemeCycleButton />
              </Box>
              {identity === null ? null : (
                <>
                  <NotificationBell />
                  <MemberAccountMenu />
                </>
              )}
            </Toolbar>
            <ImpersonationBanner />
          </AppBar>
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              minWidth: 0,
              px: { xs: '1.25rem', md: '1.5rem' },
              pt: { xs: '1.25rem', md: '2rem' },
              pb: hasMobileNavigation ? 'calc(4.5rem + env(safe-area-inset-bottom))' : '2rem',
            }}
          >
            {notices}
            {outlet}
          </Box>
        </Box>
      </Box>
      {mobileNavigation}
    </>
  );
};
