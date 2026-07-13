import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Drawer,
  FormControl,
  FormLabel,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  OutlinedInput,
  Paper,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { ThemeSwitcher } from '../../components/ui/ThemeSwitcher.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { actions } from '../../api.js';
import { useTranslations, type Messages } from '../../i18n/index.js';
import { tenantHue, tenantUrl } from '../../lib/tenant.js';
import { useThemeMode } from '../../theme-mode.js';
import {
  AppBarTitle,
  AppBarWordmark,
  BreakAllText,
  CardTitle,
  createThemeForMode,
  Eyebrow,
  PanelNavItem,
  TenantSwatch,
} from '../../theme.js';
import {
  AccountIcon,
  CoursesIcon,
  IntegrationsIcon,
  MembersIcon,
  MenuIcon,
  ProductsIcon,
  SalesIcon,
  SettingsIcon,
  SignOutIcon,
} from './panel-icons.js';
import { CoursesPanel } from './courses/CoursesPanel.js';
import { MembersPanel } from './members/MembersPanel.js';
import { ProductsPanel } from './products/ProductsPanel.js';

type TenantContext = {
  id: string;
  slug: string;
  name: string;
  staffRole: 'owner' | 'admin' | null;
  memberId: string | null;
};

type CreatorSection = 'products' | 'courses' | 'sales' | 'members' | 'integrations' | 'settings';

const creatorSectionIds: CreatorSection[] = [
  'products',
  'courses',
  'sales',
  'members',
  'integrations',
  'settings',
];

const drawerWidth = 248;

const roleLabel = (t: Messages, role: 'owner' | 'admin' | null): string =>
  role === 'owner' ? t.tenant.roleOwner : role === 'admin' ? t.tenant.roleAdmin : t.tenant.roleMember;

export const TenantHomePage = () => {
  const navigate = useNavigate();
  const t = useTranslations();
  const me = useQuery(actions.me);

  const unauthorized = me.error instanceof ApiError && me.error.appError.code === 'unauthorized';

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [unauthorized, navigate]);

  if (me.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem' }}>
        <Typography variant="h2" component="p" sx={{ py: 6 }}>
          {t.tenant.openingWorkspace}
        </Typography>
      </Container>
    );
  }
  if (unauthorized) return null;
  if (me.isError) {
    return (
      <Container sx={{ maxWidth: '44rem' }}>
        <Alert sx={{ mt: 4 }}>{me.error.message}</Alert>
      </Container>
    );
  }

  return me.data.tenant ? (
    <TenantHome tenant={me.data.tenant} email={me.data.email} />
  ) : (
    <PickTenant />
  );
};

const PickTenant = () => {
  const t = useTranslations();
  const tenants = useQuery(actions.tenants);
  const [name, setName] = useState('');
  const [slugInput, setSlugInput] = useState('');
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const slugPreview = slugInput || name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const createTenant = useMutation({
    ...actions.createTenant,
    onSuccess: async (data) => {
      setCreatedSlug(data.tenant.slug);
      await queryClient.invalidateQueries();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createTenant.mutate({ name, slug: slugPreview });
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        sx={{ width: '100%', maxWidth: '29rem', px: '1.8rem', pt: '2rem', pb: '1.6rem' }}
      >
        <CardTitle variant="h1">{t.tenant.choose}</CardTitle>
        <Eyebrow variant="overline" component="p">
          {t.tenant.eachOwnDomain}
        </Eyebrow>
        {tenants.isPending ? (
          <Typography variant="h2" component="p" sx={{ py: 2 }}>
            {t.tenant.loading}
          </Typography>
        ) : null}
        <List sx={{ mt: '1.2rem' }} disablePadding>
          {tenants.data?.tenants.map((m) => (
            <ListItem key={m.tenant.id} disablePadding>
              <ListItemButton component="a" href={tenantUrl(m.tenant.slug)} sx={{ px: '0.3rem' }}>
                <ListItemText
                  primary={m.tenant.name}
                  secondary={tenantUrl(m.tenant.slug)}
                  slotProps={{ primary: { sx: { fontWeight: 700 } }, secondary: { variant: 'caption' } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        <Box component="form" onSubmit={submit} sx={{ mt: '1.5rem', display: 'grid', gap: '1rem' }}>
          <Typography variant="h2" component="h2">
            {t.tenant.create}
          </Typography>
          <FormControl fullWidth>
            <FormLabel htmlFor="tenant-name">{t.tenant.nameLabel}</FormLabel>
            <OutlinedInput
              id="tenant-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="tenant-slug">{t.tenant.slugLabel}</FormLabel>
            <OutlinedInput
              id="tenant-slug"
              value={slugInput}
              placeholder={slugPreview}
              onChange={(event) => setSlugInput(event.target.value)}
            />
          </FormControl>
          <Typography variant="caption" component="p">
            {slugPreview ? tenantUrl(slugPreview) : t.tenant.enterNameToPreview}
          </Typography>
          <Button type="submit" variant="contained" disabled={createTenant.isPending || !slugPreview}>
            {createTenant.isPending ? t.tenant.creating : t.tenant.createButton}
          </Button>
          {createTenant.isError ? (
            <Alert>
              {createTenant.error instanceof ApiError
                ? createTenant.error.appError.message
                : createTenant.error.message}
            </Alert>
          ) : null}
          {createdSlug ? (
            <Link href={tenantUrl(createdSlug)}>{t.tenant.open({ url: tenantUrl(createdSlug) })}</Link>
          ) : null}
        </Box>
      </Paper>
    </Box>
  );
};

const TenantHome = ({ tenant, email }: { tenant: TenantContext; email: string }) => {
  const { mode } = useThemeMode();
  const theme = useMemo(() => createThemeForMode(mode, tenantHue(tenant.slug)), [mode, tenant.slug]);

  return (
    <ThemeProvider theme={theme}>
      {tenant.staffRole ? (
        <CreatorShell tenant={tenant} email={email} />
      ) : (
        <MemberHomeRedirect />
      )}
    </ThemeProvider>
  );
};

const MemberHomeRedirect = () => {
  const navigate = useNavigate();
  const t = useTranslations();

  useEffect(() => {
    void navigate({ to: '/my' });
  }, [navigate]);

  return (
    <Container sx={{ maxWidth: '44rem', py: 6 }}>
      <Typography variant="h2" component="p">
        {t.tenant.openingProducts}
      </Typography>
    </Container>
  );
};

const mutationErrorMessage = (error: Error): string =>
  error instanceof ApiError ? error.appError.message : error.message;

const SectionIcon = ({ id }: { id: CreatorSection }) => {
  switch (id) {
    case 'products':
      return <ProductsIcon />;
    case 'courses':
      return <CoursesIcon />;
    case 'sales':
      return <SalesIcon />;
    case 'members':
      return <MembersIcon />;
    case 'integrations':
      return <IntegrationsIcon />;
    case 'settings':
      return <SettingsIcon />;
  }
};

const PanelNav = ({
  section,
  onSelect,
}: {
  section: CreatorSection;
  onSelect: (section: CreatorSection) => void;
}) => {
  const t = useTranslations();
  return (
    <List component="nav" aria-label={t.sections.aria} sx={{ px: '0.6rem', py: '0.5rem' }}>
      {creatorSectionIds.map((id) => (
        <PanelNavItem
          key={id}
          data-testid={`section-${id}`}
          selected={section === id}
          aria-current={section === id ? 'page' : undefined}
          onClick={() => onSelect(id)}
        >
          <ListItemIcon>
            <SectionIcon id={id} />
          </ListItemIcon>
          <ListItemText primary={t.sections[id]} />
        </PanelNavItem>
      ))}
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
  role: TenantContext['staffRole'];
  onSignOut: () => void;
  pending: boolean;
}) => {
  const t = useTranslations();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  return (
    <>
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

const SectionContent = ({ section }: { section: CreatorSection }) => {
  const t = useTranslations();
  switch (section) {
    case 'products':
      return <ProductsPanel />;
    case 'courses':
      return <CoursesPanel />;
    case 'members':
      return <MembersPanel />;
    case 'settings':
      return <SecurityPanel />;
    case 'sales':
    case 'integrations':
      return (
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <Typography variant="h2" component="h2">
            {t.sections[section]}
          </Typography>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            {t.sections.comingSoon}
          </Typography>
        </Paper>
      );
  }
};

const CreatorShell = ({ tenant, email }: { tenant: TenantContext; email: string }) => {
  const t = useTranslations();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const [section, setSection] = useState<CreatorSection>('products');
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useSuppressGlobalChrome();

  const signOut = useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/login' });
    },
  });

  const selectSection = (next: CreatorSection) => {
    setSection(next);
    setMobileOpen(false);
  };

  const nav = <PanelNav section={section} onSelect={selectSection} />;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (appBarTheme) => appBarTheme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: '0.75rem' }}>
          {isDesktop ? null : (
            <IconButton
              edge="start"
              color="inherit"
              data-testid="open-navigation"
              aria-label={t.panel.openNavigation}
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon />
            </IconButton>
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
        <Box sx={{ maxWidth: '60rem', mx: 'auto', px: { xs: '1.25rem', md: '2rem' }, py: '2rem' }}>
          <SectionContent section={section} />
        </Box>
      </Box>
    </Box>
  );
};

const SecurityPanel = () => {
  const t = useTranslations();
  const [passkeyName, setPasskeyName] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const registerPasskey = useMutation(actions.registerPasskey);
  const enableTwoFactor = useMutation(actions.enableTwoFactor);
  const verifyTotp = useMutation(actions.verifyTotp);

  const addPasskey = (event: FormEvent) => {
    event.preventDefault();
    registerPasskey.mutate({ name: passkeyName.trim() || t.security.defaultPasskeyName });
  };

  const enrollTwoFactor = (event: FormEvent) => {
    event.preventDefault();
    enableTwoFactor.mutate({ password });
  };

  const submitTotp = (event: FormEvent) => {
    event.preventDefault();
    verifyTotp.mutate({ code: totpCode.trim() });
  };

  return (
    <Paper elevation={1} sx={{ p: '1.5rem' }}>
      <Stack useFlexGap spacing="1.75rem">
        <Typography variant="h2" component="h2">
          {t.security.heading}
        </Typography>

        <Box component="form" onSubmit={addPasskey} sx={{ display: 'grid', gap: '0.8rem' }}>
          <Eyebrow variant="overline" component="h3">
            {t.security.passkeys}
          </Eyebrow>
          <FormControl fullWidth>
            <FormLabel htmlFor="passkey-name">{t.security.passkeyNameLabel}</FormLabel>
            <OutlinedInput
              id="passkey-name"
              value={passkeyName}
              onChange={(event) => setPasskeyName(event.target.value)}
              inputProps={{ 'data-testid': 'passkey-name' }}
              placeholder={t.security.defaultPasskeyName}
            />
          </FormControl>
          <Button type="submit" variant="outlined" data-testid="add-passkey" disabled={registerPasskey.isPending}>
            {registerPasskey.isPending ? t.security.addingPasskey : t.security.addPasskey}
          </Button>
          {registerPasskey.isSuccess ? (
            <Typography variant="caption" component="p" data-testid="passkey-added">
              {t.security.passkeyAdded}
            </Typography>
          ) : null}
          {registerPasskey.isError ? <Alert>{mutationErrorMessage(registerPasskey.error)}</Alert> : null}
        </Box>

        <Box component="form" onSubmit={enrollTwoFactor} sx={{ display: 'grid', gap: '0.8rem' }}>
          <Eyebrow variant="overline" component="h3">
            {t.security.twoFactor}
          </Eyebrow>
          <FormControl fullWidth>
            <FormLabel htmlFor="enable-2fa-password">{t.security.accountPasswordLabel}</FormLabel>
            <OutlinedInput
              id="enable-2fa-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              inputProps={{ 'data-testid': 'enable-2fa-password' }}
              autoComplete="current-password"
            />
          </FormControl>
          <Button type="submit" variant="outlined" data-testid="enable-2fa" disabled={enableTwoFactor.isPending}>
            {enableTwoFactor.isPending ? t.security.enabling : t.security.enableTwoFactor}
          </Button>
          {enableTwoFactor.isError ? <Alert>{mutationErrorMessage(enableTwoFactor.error)}</Alert> : null}
        </Box>

        {enableTwoFactor.data ? (
          <Box sx={{ display: 'grid', gap: '0.8rem' }}>
            <Eyebrow variant="overline" component="h3">
              {t.security.scanOrCopyKey}
            </Eyebrow>
            <FormControl fullWidth>
              <FormLabel htmlFor="totp-uri">{t.security.otpauthUriLabel}</FormLabel>
              <OutlinedInput
                id="totp-uri"
                readOnly
                value={enableTwoFactor.data.totpURI}
                inputProps={{ 'data-testid': 'totp-uri' }}
              />
            </FormControl>
            <Box component="ul" sx={{ display: 'grid', gap: '0.2rem', pl: '1.2rem', m: 0 }}>
              {enableTwoFactor.data.backupCodes.map((code) => (
                <Typography key={code} component="li" variant="caption">
                  {code}
                </Typography>
              ))}
            </Box>
            <Box component="form" onSubmit={submitTotp} sx={{ display: 'grid', gap: '0.8rem' }}>
              <FormControl fullWidth>
                <FormLabel htmlFor="verify-totp-code">{t.security.authenticatorCodeLabel}</FormLabel>
                <OutlinedInput
                  id="verify-totp-code"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  inputProps={{ 'data-testid': 'verify-totp-code' }}
                  autoComplete="one-time-code"
                />
              </FormControl>
              <Button type="submit" variant="contained" data-testid="verify-totp" disabled={verifyTotp.isPending}>
                {verifyTotp.isPending ? t.security.verifying : t.security.verifyCode}
              </Button>
              {verifyTotp.isSuccess ? (
                <Typography variant="caption" component="p" data-testid="totp-verified">
                  {t.security.twoFactorOn}
                </Typography>
              ) : null}
              {verifyTotp.isError ? <Alert>{mutationErrorMessage(verifyTotp.error)}</Alert> : null}
            </Box>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
};
