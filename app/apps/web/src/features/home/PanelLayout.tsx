import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  AppBar,
  Box,
  Chip,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  ThemeProvider,
  Toolbar,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { useTenantBranding } from '../../branding.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { NotificationBell } from '../../NotificationBell.js';
import { ThemeSwitcher } from '../../components/ui/ThemeSwitcher.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations, type Messages } from '../../i18n/index.js';
import { tenantHue } from '../../lib/tenant.js';
import { applyBranding } from '../../theme-branding.js';
import { useThemeMode } from '../../theme-mode.js';
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
  CoursesIcon,
  DashboardIcon,
  IntegrationsIcon,
  LessonsIcon,
  MembersIcon,
  MenuIcon,
  ProductsIcon,
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
  | 'spaces'
  | 'sales'
  | 'integrations'
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
  { id: 'spaces', to: '/panel/spaces' },
  { id: 'sales', to: '/panel/sales' },
  { id: 'integrations', to: '/panel/integrations' },
  { id: 'marketingSends', to: '/panel/marketing/sends' },
  { id: 'marketingCampaigns', to: '/panel/marketing/campaigns' },
  { id: 'marketingConsents', to: '/panel/marketing/consents' },
  { id: 'marketingDocuments', to: '/panel/marketing/documents' },
  { id: 'marketingLayouts', to: '/panel/marketing/layouts' },
  { id: 'marketingSettings', to: '/panel/marketing/settings' },
  { id: 'settings', to: '/panel/settings' },
];

const drawerWidth = 248;

const roleLabel = (t: Messages, role: PanelTenant['staffRole']): string =>
  role === 'owner' ? t.tenant.roleOwner : role === 'admin' ? t.tenant.roleAdmin : t.tenant.roleMember;

const isActive = (pathname: string, to: string, exact: boolean): boolean =>
  exact ? pathname === to || pathname === `${to}/` : pathname === to || pathname.startsWith(`${to}/`);

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
    case 'spaces':
      return <SpacesIcon />;
    case 'sales':
      return <SalesIcon />;
    case 'integrations':
      return <IntegrationsIcon />;
    case 'marketingSends':
    case 'marketingCampaigns':
    case 'marketingConsents':
    case 'marketingDocuments':
    case 'marketingLayouts':
    case 'marketingSettings':
      return <IntegrationsIcon />;
    case 'settings':
      return <SettingsIcon />;
  }
};

const PanelNav = ({ onNavigate }: { onNavigate: (to: string) => void }) => {
  const t = useTranslations();
  const { pathname } = useLocation();
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

  useSuppressGlobalChrome();

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
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (appBarTheme) => appBarTheme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: '0.75rem' }}>
          {isDesktop ? null : (
            <Tooltip title={t.panel.openNavigation}>
              <IconButton
                edge="start"
                color="inherit"
                data-testid="open-navigation"
                aria-label={t.panel.openNavigation}
                onClick={() => setMobileOpen(true)}
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
          <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: '0.75rem' }}>
            <LanguageSwitcher inline />
            <ThemeSwitcher inline />
          </Box>
          <NotificationBell />
          <UserMenu
            email={email}
            role={tenant.staffRole}
            pending={signOut.isPending}
            onSignOut={() => signOut.mutate()}
          />
        </Toolbar>
      </AppBar>

      <Box sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        {isDesktop ? (
          <Drawer
            variant="permanent"
            open
            sx={{
              display: { xs: 'none', md: 'block' },
              '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
            }}
          >
            <Toolbar />
            {nav}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            sx={{
              display: { xs: 'block', md: 'none' },
              '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
            }}
          >
            <Toolbar />
            {nav}
          </Drawer>
        )}
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Toolbar />
        <Box sx={{ px: { xs: '1.25rem', md: '2rem' }, py: '2rem' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

export const PanelLayout = () => {
  const navigate = useNavigate();
  const t = useTranslations();
  const { mode } = useThemeMode();
  const me = useQuery(actions.me);

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
    () => applyBranding(createThemeForMode(mode, tenant ? tenantHue(tenant.slug) : 0), branding),
    [mode, tenant, branding],
  );

  if (me.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <StatusView state={{ kind: 'loading', label: t.tenant.openingWorkspace }} />
      </Container>
    );
  }
  if (unauthorized || noTenant || memberOnly) return null;
  if (me.isError) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <StatusView state={{ kind: 'error', message: localizeError(me.error, t) }} />
      </Container>
    );
  }
  if (!tenant || !tenant.staffRole) return null;

  return (
    <ThemeProvider theme={theme}>
      <PanelContextProvider value={{ tenant, email: me.data.email }}>
        <PanelShell tenant={tenant} email={me.data.email} />
      </PanelContextProvider>
    </ThemeProvider>
  );
};
