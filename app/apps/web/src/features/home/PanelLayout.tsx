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
  ListSubheader,
  Menu,
  MenuItem,
  Snackbar,
  SvgIcon,
  ThemeProvider,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { useTenantBranding } from '../../branding.js';
import { BuildStamp } from '../../components/ui/BuildStamp.js';
import { ColorSchemeSwitcher } from '../../components/ui/ColorSchemeSwitcher.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { NotificationBell } from '../../NotificationBell.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { actions } from '../../api.js';
import { AppShell, BrandLoader, StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations, type Messages } from '../../i18n/index.js';
import { tenantHue } from '../../lib/tenant.js';
import { applyBranding } from '../../theme-branding.js';
import { useColorScheme } from '../../theme-mode.js';
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

type NavigationGroupId =
  | 'content'
  | 'offer'
  | 'community'
  | 'sales'
  | 'marketing';

interface NavigationGroupDescriptor {
  id: NavigationGroupId;
  sections: SectionDescriptor[];
  collapsible?: boolean;
}

const overviewDescriptor: SectionDescriptor = { id: 'dashboard', to: '/panel', exact: true };
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
      { id: 'integrations', to: '/panel/integrations' },
    ],
  },
  {
    id: 'marketing',
    collapsible: true,
    sections: [
      { id: 'marketingCampaigns', to: '/panel/marketing/campaigns' },
      { id: 'marketingActivity', to: '/panel/marketing/activity' },
      { id: 'marketingSends', to: '/panel/marketing/sends' },
      { id: 'marketingLayouts', to: '/panel/marketing/layouts' },
      { id: 'marketingConsents', to: '/panel/marketing/consents' },
      { id: 'marketingDocuments', to: '/panel/marketing/documents' },
      { id: 'marketingSettings', to: '/panel/marketing/settings' },
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
    case 'marketingSettings':
      return <MarketingSettingsIcon />;
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
}: {
  descriptor: SectionDescriptor;
  pathname: string;
  onNavigate: (to: string) => void;
  openReportCount: number | undefined;
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
      sx={{ pl: id === 'dashboard' ? undefined : '1rem' }}
    >
      <ListItemIcon>
        <SectionIcon id={id} />
      </ListItemIcon>
      <ListItemText primary={t.sections[id]} />
      {id === 'reports' && openReportCount !== undefined ? (
        <Chip data-testid="reports-open-count" size="small" label={openReportCount} />
      ) : null}
    </PanelNavItem>
  );
};

const PanelNav = ({ onNavigate }: { onNavigate: (to: string) => void }) => {
  const t = useTranslations();
  const { pathname } = useLocation();
  const openReports = useQuery(actions.reports({ status: 'open', limit: 1 }));
  const [marketingOpen, setMarketingOpen] = useState(pathname.startsWith('/panel/marketing'));

  useEffect(() => {
    if (pathname.startsWith('/panel/marketing')) setMarketingOpen(true);
  }, [pathname]);

  return (
    <List component="nav" aria-label={t.sections.aria} sx={{ px: '0.6rem', py: '0.5rem' }}>
      <NavigationItem
        descriptor={overviewDescriptor}
        pathname={pathname}
        onNavigate={onNavigate}
        openReportCount={undefined}
      />
      {sectionDescriptors.map((group) => (
        <Box component="li" key={group.id} sx={{ listStyle: 'none' }}>
          {group.collapsible ? (
            <ListItemButton
              data-testid={`group-${group.id}`}
              aria-expanded={marketingOpen}
              aria-controls="panel-navigation-marketing"
              onClick={() => setMarketingOpen((open) => !open)}
              sx={navigationGroupHeaderSx}
            >
              <NavigationGroupLabel label={t.navigationGroups[group.id]} />
              <ExpandIcon expanded={marketingOpen} />
            </ListItemButton>
          ) : (
            <ListSubheader
              component="div"
              disableSticky
              data-testid={`group-${group.id}`}
              sx={navigationGroupHeaderSx}
            >
              <NavigationGroupLabel label={t.navigationGroups[group.id]} />
            </ListSubheader>
          )}
          <Collapse
            in={group.collapsible ? marketingOpen : true}
            timeout="auto"
            unmountOnExit={group.collapsible}
          >
            <List
              component="div"
              disablePadding
              id={group.id === 'marketing' ? 'panel-navigation-marketing' : undefined}
            >
              {group.sections.map((descriptor) => (
                <NavigationItem
                  key={descriptor.id}
                  descriptor={descriptor}
                  pathname={pathname}
                  onNavigate={onNavigate}
                  openReportCount={openReports.data?.openCount}
                />
              ))}
            </List>
          </Collapse>
        </Box>
      ))}
      <NavigationItem
        descriptor={settingsDescriptor}
        pathname={pathname}
        onNavigate={onNavigate}
        openReportCount={undefined}
      />
      {openReports.isError ? (
        <StatusView surface={false} state={{ kind: 'error', message: localizeError(openReports.error, t), retry: { label: t.common.retry, onRetry: () => void openReports.refetch() } }} />
      ) : null}
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
        <Box sx={{ display: { xs: 'block', sm: 'none' }, px: '1rem', py: '0.5rem' }}>
          <LanguageSwitcher inline />
        </Box>
        <Divider sx={{ display: { xs: 'block', sm: 'none' } }} />
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
    <>
    <AppShell
      isDesktop={isDesktop}
      mobileNavigationOpen={mobileOpen}
      onMobileNavigationClose={() => setMobileOpen(false)}
      mobileNavigationCloseLabel={t.panel.closeNavigation}
      navigation={nav}
      footer={(
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <ColorSchemeSwitcher />
          <BuildStamp />
        </Box>
      )}
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
            <AppBarWordmark component="span" variant="h3">{t.common.appName}</AppBarWordmark>
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
    <Snackbar open={signOut.isError} autoHideDuration={6000} onClose={() => signOut.reset()}>
      <Alert severity="error" onClose={() => signOut.reset()}>{signOut.isError ? localizeError(signOut.error, t) : ''}</Alert>
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
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <ColorSchemeSwitcher />
          <BuildStamp />
        </Box>
      )}
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
          <AppBarWordmark component="span" variant="h3">{t.common.appName}</AppBarWordmark>
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
        <PanelErrorShell message={localizeError(me.error, t)} onRetry={() => void me.refetch()} />
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
