import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  Box,
  Chip,
  Divider,
  IconButton,
  List,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  ThemeProvider,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { useTenantBranding } from '../../branding.js';
import { BuildStamp } from '../../components/ui/BuildStamp.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { NotificationBell } from '../../NotificationBell.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { actions } from '../../api.js';
import { AppShell, BrandSplash } from '../../components/layout/index.js';
import { localizeError, useTranslations, type Messages } from '../../i18n/index.js';
import { tenantHue } from '../../lib/tenant.js';
import { applyBranding } from '../../theme-branding.js';
import {
  AppBarTitle,
  AppBarWordmark,
  BreakAllText,
  createThemeForMode,
  Eyebrow,
  PanelNavItem,
  TenantSwatch,
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
  MarketingSettingsIcon,
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
  | 'marketingSettings'
  | 'settings';

interface SectionDescriptor {
  id: PanelSection;
  to: string;
  exact?: boolean;
}

const sectionDescriptors: SectionDescriptor[] = [
  { id: 'dashboard', to: '/panel', exact: true },
  { id: 'products', to: '/panel/products' },
  { id: 'courses', to: '/panel/courses' },
  { id: 'lessons', to: '/panel/lessons' },
  { id: 'members', to: '/panel/members' },
  { id: 'reports', to: '/panel/reports' },
  { id: 'spaces', to: '/panel/spaces' },
  { id: 'sales', to: '/panel/sales' },
  { id: 'coupons', to: '/panel/sales/coupons' },
  { id: 'integrations', to: '/panel/integrations' },
  { id: 'marketingActivity', to: '/panel/marketing/activity' },
  { id: 'marketingSends', to: '/panel/marketing/sends' },
  { id: 'marketingCampaigns', to: '/panel/marketing/campaigns' },
  { id: 'marketingConsents', to: '/panel/marketing/consents' },
  { id: 'marketingDocuments', to: '/panel/marketing/documents' },
  { id: 'marketingLayouts', to: '/panel/marketing/layouts' },
  { id: 'marketingSettings', to: '/panel/marketing/settings' },
  { id: 'settings', to: '/panel/settings' },
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
    case 'marketingSettings':
      return <MarketingSettingsIcon />;
    case 'settings':
      return <SettingsIcon />;
  }
};

const PanelNav = ({ onNavigate }: { onNavigate: (to: string) => void }) => {
  const t = useTranslations();
  const { pathname } = useLocation();
  const openReports = useQuery(actions.reports({ status: 'open', limit: 1 }));
  return (
    <List component="nav" aria-label={t.sections.aria} sx={{ px: '0.6rem', py: '0.5rem' }}>
      {sectionDescriptors.map(({ id, to, exact }) => {
        const active = isActive(pathname, to, exact ?? false);
        return (
          <PanelNavItem
            key={id}
            data-testid={`section-${id}`}
            selected={active}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(to)}
          >
            <ListItemIcon>
              <SectionIcon id={id} />
            </ListItemIcon>
            <ListItemText primary={t.sections[id]} />
            {id === 'reports' && openReports.data !== undefined ? (
              <Chip
                data-testid="reports-open-count"
                size="small"
                label={openReports.data.openCount}
              />
            ) : null}
          </PanelNavItem>
        );
      })}
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
      >
        <Box sx={{ px: '1rem', py: '0.5rem', maxWidth: '18rem' }}>
          <Eyebrow variant="overline" component="p">
            {t.panel.signedInAs}
          </Eyebrow>
          <BreakAllText variant="body2" data-testid="user-menu-email">
            {email}
          </BreakAllText>
          <Chip variant="outlined" size="small" label={roleLabel(t, role)} sx={{ mt: '0.5rem' }} />
        </Box>
        <Divider />
        <MenuItem
          data-testid="sign-out"
          disabled={pending}
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
    <AppShell
      isDesktop={isDesktop}
      mobileNavigationOpen={mobileOpen}
      onMobileNavigationClose={() => setMobileOpen(false)}
      navigation={nav}
      footer={<BuildStamp />}
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
          <TenantSwatch aria-hidden sx={{ width: '0.8rem', height: '0.8rem' }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <AppBarTitle component="span" noWrap data-testid="tenant-name">
              {tenant.name}
            </AppBarTitle>
            <AppBarWordmark component="span">{t.common.appName}</AppBarWordmark>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Box
            sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: '0.75rem' }}
          >
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
  );
};

const PanelErrorShell = ({ message }: { message: string }) => {
  const t = useTranslations();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AppShell
      isDesktop={isDesktop}
      mobileNavigationOpen={mobileOpen}
      onMobileNavigationClose={() => setMobileOpen(false)}
      state={{ kind: 'error', message }}
      navigation={<List component="nav" aria-label={t.sections.aria} />}
      footer={<BuildStamp />}
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
          <TenantSwatch aria-hidden sx={{ width: '0.8rem', height: '0.8rem' }} />
          <AppBarWordmark component="span">{t.common.appName}</AppBarWordmark>
        </>
      }
    />
  );
};

export const PanelLayout = () => {
  const navigate = useNavigate();
  const t = useTranslations();
  const me = useQuery(actions.me);

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
    () => applyBranding(createThemeForMode('shadcn', tenant ? tenantHue(tenant.slug) : 0), branding),
    [tenant, branding],
  );

  if (me.isPending || unauthorized || noTenant || memberOnly) {
    return (
      <ThemeProvider theme={theme}>
        <BrandSplash
          ariaLabel={t.bootSplash.opening}
          buildStamp={<BuildStamp />}
          tenantLabel={t.bootSplash.tenant({ host: window.location.hostname })}
          warmingLabel={t.bootSplash.warming}
          wordmark={t.common.appName}
        />
      </ThemeProvider>
    );
  }
  if (me.isError) {
    return (
      <ThemeProvider theme={theme}>
        <PanelErrorShell message={localizeError(me.error, t)} />
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
