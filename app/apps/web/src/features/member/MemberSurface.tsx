import type { ComponentProps, ReactNode } from 'react';
import { Box, ButtonBase, Paper, SvgIcon, Typography } from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Link, useRouterState } from '@tanstack/react-router';

import { TenantSocialLinks } from '../../branding.js';
import { MemberPage } from '../../components/layout/index.js';
import { useTranslations } from '../../i18n/index.js';
import { NotificationBell } from '../../NotificationBell.js';
import { AccountIcon } from './account-icons.js';
import { CommunityIcon } from './community-icons.js';
import { ProductsIcon } from './shell/shell-icons.js';

const CoursesIcon = () => (
  <SvgIcon aria-hidden viewBox="0 0 24 24">
    <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" />
  </SvgIcon>
);

const TabLink = ({
  href,
  label,
  current,
  icon,
}: {
  href: string;
  label: string;
  current: boolean;
  icon: ReactNode;
}) => (
  <ButtonBase
    component={Link}
    to={href}
    aria-current={current ? 'page' : undefined}
    sx={{ minWidth: 0, py: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}
  >
    {icon}
    <Typography variant="caption" component="span" noWrap>
      {label}
    </Typography>
  </ButtonBase>
);

const activeLegacyTab = (pathname: string) => {
  if (
    pathname === '/my'
    || pathname === '/my/courses'
    || pathname.startsWith('/my/courses/')
    || pathname.startsWith('/my/course/')
  ) {
    return 'courses';
  }
  if (pathname.startsWith('/community')) return 'community';
  if (pathname === '/my/products' || pathname.startsWith('/my/products/')) return 'products';
  if (pathname === '/account') return 'account';
  return null;
};

/** Below md the shell mounts no sidebar, so navigation still lives in this bar. */
const BottomNavigation = ({ liveNotifications }: { liveNotifications: boolean }) => {
  const t = useTranslations();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeTab = activeLegacyTab(pathname);
  return (
    <Paper elevation={8} square sx={{ pb: 'env(safe-area-inset-bottom)' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <TabLink
          href="/my"
          label={t.student.mobileCourses}
          current={activeTab === 'courses'}
          icon={<CoursesIcon />}
        />
        <TabLink
          href="/community"
          label={t.community.tab}
          current={activeTab === 'community'}
          icon={<CommunityIcon />}
        />
        <TabLink
          href="/my/products"
          label={t.student.mobileProducts}
          current={activeTab === 'products'}
          icon={<ProductsIcon />}
        />
        <NotificationBell tabLabel={t.notifications.mobileTab} live={liveNotifications} />
        <TabLink
          href="/account"
          label={t.account.menuAccount}
          current={activeTab === 'account'}
          icon={<AccountIcon />}
        />
      </Box>
    </Paper>
  );
};

type Props = Omit<ComponentProps<typeof MemberPage>, 'bottomNav' | 'breadcrumbLabel'> & {
  authenticated?: boolean;
};

export const MemberSurface = ({ authenticated = true, ...props }: Props) => {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const t = useTranslations();
  return (
    <MemberPage
      {...props}
      breadcrumbLabel={t.common.breadcrumbs}
      children={(
        <>
          {props.children}
          <TenantSocialLinks />
        </>
      )}
      bottomNav={authenticated ? <BottomNavigation liveNotifications={mobile} /> : undefined}
    />
  );
};
