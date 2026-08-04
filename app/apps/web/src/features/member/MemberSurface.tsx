import type { ComponentProps, ReactNode } from 'react';
import { Alert, Box, ButtonBase, Link, Paper, Stack, SvgIcon, Typography } from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';

import { TenantLogo, TenantSocialLinks } from '../../branding.js';
import { actions } from '../../api.js';
import { MemberPage } from '../../components/layout/index.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { useTranslations } from '../../i18n/index.js';
import { NotificationBell } from '../../NotificationBell.js';
import { MemberAccountMenu } from './MemberAccountMenu.js';
import { AccountIcon } from './account-icons.js';
import { CommunityIcon } from './community-icons.js';

const CoursesIcon = () => (
  <SvgIcon aria-hidden viewBox="0 0 24 24">
    <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" />
  </SvgIcon>
);

const ProductsIcon = () => (
  <SvgIcon aria-hidden viewBox="0 0 24 24">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-.9-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z" />
  </SvgIcon>
);

const HeaderNavigation = ({ liveNotifications }: { liveNotifications: boolean }) => {
  const t = useTranslations();
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', columnGap: '1rem' }}
    >
      <Link href="/my">{t.student.myCourses}</Link>
      <Link href="/community">{t.community.tab}</Link>
      <Link href="/my/products">{t.student.myProducts}</Link>
      <NotificationBell live={liveNotifications} />
      <MemberAccountMenu />
    </Stack>
  );
};

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
    component="a"
    href={href}
    aria-current={current ? 'page' : undefined}
    sx={{ minWidth: 0, py: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}
  >
    {icon}
    <Typography variant="caption" component="span">
      {label}
    </Typography>
  </ButtonBase>
);

const BottomNavigation = ({ liveNotifications }: { liveNotifications: boolean }) => {
  const t = useTranslations();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <Paper elevation={8} square sx={{ pb: 'env(safe-area-inset-bottom)' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <TabLink
          href="/my"
          label={t.student.myCourses}
          current={
            pathname === '/my'
            || pathname === '/my/courses'
            || pathname.startsWith('/my/courses/')
            || pathname.startsWith('/my/course/')
          }
          icon={<CoursesIcon />}
        />
        <TabLink
          href="/community"
          label={t.community.tab}
          current={pathname.startsWith('/community')}
          icon={<CommunityIcon />}
        />
        <TabLink
          href="/my/products"
          label={t.student.myProducts}
          current={pathname === '/my/products' || pathname.startsWith('/my/products/')}
          icon={<ProductsIcon />}
        />
        <NotificationBell tabLabel={t.notifications.heading} live={liveNotifications} />
        <TabLink
          href="/account"
          label={t.account.menuAccount}
          current={pathname === '/account'}
          icon={<AccountIcon />}
        />
      </Box>
    </Paper>
  );
};

type Props = Omit<ComponentProps<typeof MemberPage>, 'logo' | 'nav' | 'bottomNav'> & {
  authenticated?: boolean;
};

export const MemberSurface = ({ authenticated = true, ...props }: Props) => {
  useSuppressGlobalChrome();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const t = useTranslations();
  const me = useQuery({ ...actions.me, enabled: authenticated });
  return (
    <MemberPage
      {...props}
      children={(
        <>
          {me.data?.tenant?.banned === true ? <Alert severity="info">{t.community.bannedBanner}</Alert> : null}
          {props.children}
          <TenantSocialLinks />
        </>
      )}
      logo={<TenantLogo />}
      nav={authenticated
        ? <HeaderNavigation liveNotifications={!mobile} />
        : <Link href="/login">{t.auth.signInLink}</Link>}
      bottomNav={authenticated ? <BottomNavigation liveNotifications={mobile} /> : undefined}
    />
  );
};
