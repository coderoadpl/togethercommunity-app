import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  Alert,
  Box,
  Chip,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  SvgIcon,
  ThemeProvider,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { styled, useTheme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';

import { useTenantBranding } from '../../branding.js';
import { BuildStamp } from '../../components/ui/BuildStamp.js';
import { ColorSchemeSwitcher } from '../../components/ui/ColorSchemeSwitcher.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { NotificationBell } from '../../NotificationBell.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { actions } from '../../api.js';
import { AppShell, BrandLoader, StatusView } from '../../components/layout/index.js';
import { localizePanelError, useTranslations, type Messages } from '../../i18n/index.js';
import { forgetLoginIdentifier } from '../../lib/login-identifier.js';
import { tenantHue } from '../../lib/tenant.js';
import { applyBranding } from '../../theme-branding.js';
import { persistedJsonPreference, useColorScheme } from '../../theme-mode.js';
import {
  AppBarTitle,
  AppBarWordmark,
  BreakAllText,
  createThemeForMode,
  Eyebrow,
  PanelNavItem,
} from '../../theme.js';
import {
  AccountIcon,
  CouponsIcon,
  CoursesIcon,
  DashboardIcon,
  IntegrationsIcon,
  LessonsIcon,
  MarketingActivityIcon,
  MarketingCampaignsIcon,
  MarketingConsentsIcon,
  MarketingDocumentsIcon,
  MarketingLayoutsIcon,
  MarketingSendsIcon,
  MembersIcon,
  MenuIcon,
  ProductsIcon,
  ReportsIcon,
  SalesIcon,
  SettingsIcon,
  SignOutIcon,
  SpacesIcon,
} from './panel-icons.js';
import { PanelContextProvider, type PanelTenant } from './panel-context.js';

type PanelSection =
  | 'dashboard'
  | 'products'
  | 'courses'
  | 'lessons'
  | 'members'
  | 'reports'
  | 'spaces'
  | 'sales'
  | 'coupons'
  | 'integrations'
  | 'marketingActivity'
  | 'marketingSends'
  | 'marketingCampaigns'
  | 'marketingConsents'
  | 'marketingDocuments'
  | 'marketingLayouts'
  | 'settings';

interface SectionDescriptor {
  id: PanelSection;
  to: string;
  exact?: boolean;
}

type NavigationGroupId =
  | 'content'
  | 'offer'
  | 'community'
  | 'sales'
  | 'marketing';

interface NavigationGroupDescriptor {
  id: NavigationGroupId;
  sections: SectionDescriptor[];
}

const navigationGroupStateSchema = z.object({
  content: z.boolean(),
  offer: z.boolean(),
  community: z.boolean(),
  sales: z.boolean(),
  marketing: z.boolean(),
});

type NavigationGroupState = z.infer<typeof navigationGroupStateSchema>;

const defaultNavigationGroupState: NavigationGroupState = {
  content: true,
  offer: true,
  community: true,
  sales: true,
  marketing: false,
};

const navigationGroupPreference = persistedJsonPreference(
  'together-nav-groups',
  (value) => {
    const result = navigationGroupStateSchema.safeParse(value);
    return result.success ? result.data : undefined;
  },
  defaultNavigationGroupState,
);

const overviewDescriptor: SectionDescriptor = { id: 'dashboard', to: '/panel', exact: true };
const integrationsDescriptor: SectionDescriptor = { id: 'integrations', to: '/panel/integrations' };
const settingsDescriptor: SectionDescriptor = { id: 'settings', to: '/panel/settings' };

const sectionDescriptors: NavigationGroupDescriptor[] = [
  {
    id: 'content',
    sections: [
      { id: 'courses', to: '/panel/courses' },
      { id: 'lessons', to: '/panel/lessons' },
    ],
  },
  {
    id: 'offer',
    sections: [
      { id: 'products', to: '/panel/products' },
      { id: 'coupons', to: '/panel/sales/coupons' },
    ],
  },
  {
    id: 'community',
    sections: [
      { id: 'members', to: '/panel/members' },
      { id: 'spaces', to: '/panel/spaces' },
      { id: 'reports', to: '/panel/reports' },
    ],
  },
  {
    id: 'sales',
    sections: [
      { id: 'sales', to: '/panel/sales' },
    ],
  },
  {
    id: 'marketing',
    sections: [
      { id: 'marketingCampaigns', to: '/panel/marketing/campaigns' },
      { id: 'marketingActivity', to: '/panel/marketing/activity' },
      { id: 'marketingSends', to: '/panel/marketing/sends' },
      { id: 'marketingLayouts', to: '/panel/marketing/layouts' },
      { id: 'marketingConsents', to: '/panel/marketing/consents' },
      { id: 'marketingDocuments', to: '/panel/marketing/documents' },
    ],
  },
];

const roleLabel = (t: Messages, role: PanelTenant['staffRole']): string =>
  role === 'owner' ? t.tenant.roleOwner : role === 'admin' ? t.tenant.roleAdmin : t.tenant.roleMember;

const isActive = (pathname: string, to: string, exact: boolean): boolean =>
  to === '/panel/sales' && pathname.startsWith('/panel/sales/coupons')
    ? false
    : exact
      ? pathname === to || pathname === `${to}/`
      : pathname === to || pathname.startsWith(`${to}/`);

const SectionIcon = ({ id }: { id: PanelSection }) => {
  switch (id) {
    case 'dashboard':
      return <DashboardIcon />;
    case 'products':
      return <ProductsIcon />;
    case 'courses':
      return <CoursesIcon />;
    case 'lessons':
      return <LessonsIcon />;
    case 'members':
      return <MembersIcon />;
    case 'reports':
      return <ReportsIcon />;
    case 'spaces':
      return <SpacesIcon />;
    case 'sales':
      return <SalesIcon />;
    case 'coupons':
      return <CouponsIcon />;
    case 'integrations':
      return <IntegrationsIcon />;
    case 'marketingActivity':
      return <MarketingActivityIcon />;
    case 'marketingSends':
      return <MarketingSendsIcon />;
    case 'marketingCampaigns':
      return <MarketingCampaignsIcon />;
    case 'marketingConsents':
      return <MarketingConsentsIcon />;
    case 'marketingDocuments':
      return <MarketingDocumentsIcon />;
    case 'marketingLayouts':
      return <MarketingLayoutsIcon />;
    case 'settings':
      return <SettingsIcon />;
  }
};

const ExpandIcon = ({ expanded }: { expanded: boolean }) => (
  <SvgIcon
    fontSize="small"
    aria-hidden
    viewBox="0 0 24 24"
    sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}
  >
    <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
  </SvgIcon>
);

const NavCountBadge = styled('span')(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: theme.palette.text.primary,
  color: theme.palette.background.default,
  borderRadius: '999px',
  minWidth: '18px',
  height: '18px',
  padding: '0 5px',
  fontSize: '0.6875rem',
  fontWeight: 600,
}));

const navigationGroupHeaderSx = {
  alignItems: 'center',
  display: 'flex',
  minHeight: '2rem',
  mt: '0.5rem',
  px: '1rem',
  py: 0,
};

const NavigationGroupLabel = ({ label }: { label: string }) => (
  <Typography variant="overline" component="span">
    {label}
  </Typography>
);

const NavigationItem = ({
  descriptor,
  pathname,
  onNavigate,
  openReportCount,
  grouped = true,
}: {
  descriptor: SectionDescriptor;
  pathname: string;
  onNavigate: (to: string) => void;
  openReportCount: number | undefined;
  grouped?: boolean;
}) => {
  const t = useTranslations();
  const { id, to, exact } = descriptor;
  const active = isActive(pathname, to, exact ?? false);

  return (
    <PanelNavItem
      data-testid={`section-${id}`}
      selected={active}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(to)}
      sx={{ pl: grouped ? '1rem' : undefined }}
    >
      <ListItemIcon>
        <SectionIcon id={id} />
      </ListItemIcon>
      <ListItemText primary={t.sections[id]} />
      {id === 'reports' && openReportCount !== undefined ? (
        <NavCountBadge data-testid="reports-open-count">{openReportCount}</NavCountBadge>
      ) : null}
    </PanelNavItem>
  );
};

const PanelNav = ({ onNavigate }: { onNavigate: (to: string) => void }) => {
  const t = useTranslations();
  const { pathname } = useLocation();
  const openReports = useQuery(actions.reports({ status: 'open', limit: 1 }));
  const openDmReports = useQuery(actions.dmReports({ status: 'open', limit: 1 }));
  const openReportCount = openReports.data === undefined && openDmReports.data === undefined
    ? undefined
    : (openReports.data?.openCount ?? 0) + (openDmReports.data?.openCount ?? 0);
  const failedReportQuery = openReports.isError ? openReports : openDmReports.isError ? openDmReports : null;
  const [groupState, setGroupState] = useState<NavigationGroupState>(navigationGroupPreference.load);

  const toggleGroup = (groupId: NavigationGroupId) => {
    const next = { ...groupState, [groupId]: !groupState[groupId] };
    navigationGroupPreference.save(next);
    setGroupState(next);
  };

  return (
    <List component="nav" aria-label={t.sections.aria} sx={{ px: '0.6rem', py: '0.5rem' }}>
      <NavigationItem
        descriptor={overviewDescriptor}
        pathname={pathname}
        onNavigate={onNavigate}
        openReportCount={undefined}
        grouped={false}
      />
      {sectionDescriptors.map((group) => {
        const active = group.sections.some((descriptor) =>
          isActive(pathname, descriptor.to, descriptor.exact ?? false));
        const expanded = active || groupState[group.id];
        const controlsId = `panel-navigation-${group.id}`;

        return (
          <Box component="li" key={group.id} sx={{ listStyle: 'none' }}>
            <ListItemButton
              data-testid={`group-${group.id}`}
              aria-expanded={expanded}
              aria-controls={controlsId}
              onClick={() => toggleGroup(group.id)}
              sx={navigationGroupHeaderSx}
            >
              <NavigationGroupLabel label={t.navigationGroups[group.id]} />
              <ExpandIcon expanded={expanded} />
            </ListItemButton>
            <Collapse in={expanded} timeout="auto" unmountOnExit>
              <List
                component="div"
                disablePadding
                id={controlsId}
              >
                {group.sections.map((descriptor) => (
                  <NavigationItem
                    key={descriptor.id}
                    descriptor={descriptor}
                    pathname={pathname}
                    onNavigate={onNavigate}
                    openReportCount={openReportCount}
                  />
                ))}
              </List>
            </Collapse>
          </Box>
        );
      })}
      <Divider component="li" sx={{ mt: '0.75rem', mb: '0.5rem' }} />
      <NavigationItem
        descriptor={integrationsDescriptor}
        pathname={pathname}
        onNavigate={onNavigate}
        openReportCount={undefined}
        grouped={false}
      />
      <NavigationItem
        descriptor={settingsDescriptor}
        pathname={pathname}
        onNavigate={onNavigate}
        openReportCount={undefined}
        grouped={false}
      />
      {failedReportQuery === null ? null : (
        <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(failedReportQuery.error, t), retry: { label: t.common.retry, onRetry: () => void failedReportQuery.refetch() } }} />
      )}
    </List>
  );
};

const UserMenu = ({
  email,
  role,
  onSignOut,
  pending,
}: {
  email: string;
  role: PanelTenant['staffRole'];
  onSignOut: () => void;
  pending: boolean;
}) => {
  const t = useTranslations();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Tooltip title={t.panel.accountMenu}>
        <IconButton
          color="inherit"
          edge="end"
          data-testid="user-menu"
          aria-label={t.panel.accountMenu}
          aria-haspopup="true"
          aria-expanded={open ? true : undefined}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
          sx={{ minHeight: '44px', minWidth: '44px' }}
        >
          <AccountIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: { sx: { minWidth: '15rem', maxWidth: '20rem', mt: '0.35rem' } },
          list: { sx: { py: '0.35rem' } },
        }}
      >
        <Box sx={{ px: '1rem', py: '0.75rem' }}>
          <Eyebrow variant="overline" component="p">
            {t.panel.signedInAs}
          </Eyebrow>
          <BreakAllText variant="body2" data-testid="user-menu-email">
            {email}
          </BreakAllText>
          <Chip variant="outlined" size="small" label={roleLabel(t, role)} sx={{ mt: '0.625rem' }} />
        </Box>
        <Divider />
        <Box sx={{ display: { xs: 'grid', sm: 'none' }, gap: '0.5rem', px: '1rem', py: '0.75rem' }}>
          <LanguageSwitcher inline />
          <ColorSchemeSwitcher compact />
        </Box>
        <Divider sx={{ display: { xs: 'block', sm: 'none' } }} />
        <MenuItem
          data-testid="sign-out"
          disabled={pending}
          sx={{ minHeight: '44px', px: '1rem' }}
          onClick={() => {
            setAnchorEl(null);
            onSignOut();
          }}
        >
          <ListItemIcon>
            <SignOutIcon />
          </ListItemIcon>
          <ListItemText primary={t.tenant.signOut} />
        </MenuItem>
      </Menu>
    </>
  );
};

const PanelShell = ({ tenant, email }: { tenant: PanelTenant; email: string }) => {
  const t = useTranslations();
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const [mobileOpen, setMobileOpen] = useState(false);

  const signOut = useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      forgetLoginIdentifier();
      queryClient.clear();
      await navigate({ to: '/login' });
    },
  });

  const goTo = (to: string) => {
    setMobileOpen(false);
    void navigate({ to });
  };

  const nav = <PanelNav onNavigate={goTo} />;

  return (
    <>
    <AppShell
      isDesktop={isDesktop}
      mobileNavigationOpen={mobileOpen}
      onMobileNavigationClose={() => setMobileOpen(false)}
      mobileNavigationCloseLabel={t.panel.closeNavigation}
      navigation={nav}
      footer={(
        <BuildStamp />
      )}
      brand={
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            px: '1.25rem',
            pt: '0.9rem',
            pb: '0.75rem',
          }}
        >
          <AppBarTitle component="span" noWrap data-testid="tenant-name">
            {tenant.name}
          </AppBarTitle>
          <AppBarWordmark
            src={theme.palette.mode === 'dark'
              ? '/brand/together-horizontal-dark.svg'
              : '/brand/together-horizontal-light.svg'}
            alt={t.common.appName}
            data-testid="panel-brand-lockup"
          />
        </Box>
      }
      header={
        <>
          {isDesktop ? null : (
            <Tooltip title={t.panel.openNavigation}>
              <IconButton
                edge="start"
                color="inherit"
                data-testid="open-navigation"
                aria-label={t.panel.openNavigation}
                onClick={() => setMobileOpen(true)}
                sx={{ minHeight: '44px', minWidth: '44px' }}
              >
                <MenuIcon />
              </IconButton>
            </Tooltip>
          )}
          {isDesktop ? null : (
            <AppBarTitle component="span" noWrap>
              {tenant.name}
            </AppBarTitle>
          )}
          <Box sx={{ flex: 1 }} />
          <Box
            sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: '0.75rem' }}
          >
            <ColorSchemeSwitcher compact />
            <LanguageSwitcher inline />
          </Box>
          <NotificationBell />
          <UserMenu
            email={email}
            role={tenant.staffRole}
            pending={signOut.isPending}
            onSignOut={() => signOut.mutate()}
          />
        </>
      }
    >
      <Outlet />
    </AppShell>
    <Snackbar open={signOut.isError} autoHideDuration={6000} onClose={() => signOut.reset()}>
      <Alert severity="error" onClose={() => signOut.reset()}>{signOut.isError ? localizePanelError(signOut.error, t) : ''}</Alert>
    </Snackbar>
    </>
  );
};

const PanelErrorShell = ({ message, onRetry }: { message: string; onRetry: () => void }) => {
  const t = useTranslations();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AppShell
      isDesktop={isDesktop}
      mobileNavigationOpen={mobileOpen}
      onMobileNavigationClose={() => setMobileOpen(false)}
      mobileNavigationCloseLabel={t.panel.closeNavigation}
      state={{ kind: 'error', message, retry: { label: t.common.retry, onRetry } }}
      navigation={<List component="nav" aria-label={t.sections.aria} />}
      footer={(
        <BuildStamp />
      )}
      brand={
        <Box sx={{ display: 'flex', minWidth: 0, px: '1.25rem', pt: '0.9rem', pb: '0.75rem' }}>
          <AppBarWordmark
            src={theme.palette.mode === 'dark'
              ? '/brand/together-horizontal-dark.svg'
              : '/brand/together-horizontal-light.svg'}
            alt={t.common.appName}
          />
        </Box>
      }
      header={
        <>
          {isDesktop ? null : (
            <Tooltip title={t.panel.openNavigation}>
              <IconButton
                edge="start"
                color="inherit"
                data-testid="open-navigation"
                aria-label={t.panel.openNavigation}
                onClick={() => setMobileOpen(true)}
                sx={{ minHeight: '44px', minWidth: '44px' }}
              >
                <MenuIcon />
              </IconButton>
            </Tooltip>
          )}
          <Box sx={{ flex: 1 }} />
        </>
      }
    />
  );
};

export const PanelLayout = () => {
  const navigate = useNavigate();
  const t = useTranslations();
  const me = useQuery(actions.me);
  const { resolvedScheme } = useColorScheme();

  useSuppressGlobalChrome();

  const unauthorized = me.error instanceof ApiError && me.error.appError.code === 'unauthorized';
  const tenant = me.data?.tenant ?? null;
  const noTenant = me.isSuccess && !tenant;
  const memberOnly = tenant !== null && !tenant.staffRole;

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
    else if (noTenant) void navigate({ to: '/' });
    else if (memberOnly) void navigate({ to: '/my' });
  }, [unauthorized, noTenant, memberOnly, navigate]);

  const branding = useTenantBranding();
  const theme = useMemo(
    () => applyBranding(
      createThemeForMode('shadcn', tenant ? tenantHue(tenant.slug) : 0, resolvedScheme),
      branding,
    ),
    [tenant, branding, resolvedScheme],
  );

  if (me.isPending || unauthorized || noTenant || memberOnly) {
    return (
      <ThemeProvider theme={theme}>
        <BrandLoader caption={t.bootSplash.opening} />
      </ThemeProvider>
    );
  }
  if (me.isError) {
    return (
      <ThemeProvider theme={theme}>
        <PanelErrorShell message={localizePanelError(me.error, t)} onRetry={() => void me.refetch()} />
      </ThemeProvider>
    );
  }
  if (!tenant || !tenant.staffRole) return null;

  return (
    <ThemeProvider theme={theme}>
      <PanelContextProvider value={{ tenant, email: me.data.email, emailVerified: me.data.emailVerified }}>
        <PanelShell tenant={tenant} email={me.data.email} />
      </PanelContextProvider>
    </ThemeProvider>
  );
};
