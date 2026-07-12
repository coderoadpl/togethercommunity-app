import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  FormLabel,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  OutlinedInput,
  Paper,
  Stack,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { tenantHue, tenantUrl } from '../../lib/tenant.js';
import { useThemeMode } from '../../theme-mode.js';
import {
  CardTitle,
  createThemeForMode,
  Eyebrow,
  HeaderMeta,
  HeaderMetaBreak,
  LedgerHeader,
  TenantSwatch,
} from '../../theme.js';
import { ProductsPanel } from './products/ProductsPanel.js';

type TenantContext = {
  id: string;
  slug: string;
  name: string;
  staffRole: 'owner' | 'admin' | null;
  memberId: string | null;
};

type CreatorSection = 'products' | 'sales' | 'members' | 'integrations' | 'settings';

const creatorSections: { id: CreatorSection; label: string }[] = [
  { id: 'products', label: 'Products' },
  { id: 'sales', label: 'Sales' },
  { id: 'members', label: 'Members' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'settings', label: 'Settings' },
];

export const TenantHomePage = () => {
  const navigate = useNavigate();
  const me = useQuery(actions.me);

  const unauthorized = me.error instanceof ApiError && me.error.appError.code === 'unauthorized';

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [unauthorized, navigate]);

  if (me.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem' }}>
        <Typography variant="h2" component="p" sx={{ py: 6 }}>
          opening the workspace…
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
        <CardTitle variant="h1">Choose a tenant</CardTitle>
        <Eyebrow variant="overline" component="p">
          every tenant lives on its own domain
        </Eyebrow>
        {tenants.isPending ? (
          <Typography variant="h2" component="p" sx={{ py: 2 }}>
            loading…
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
            Create a tenant
          </Typography>
          <FormControl fullWidth>
            <FormLabel htmlFor="tenant-name">name</FormLabel>
            <OutlinedInput
              id="tenant-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="tenant-slug">slug</FormLabel>
            <OutlinedInput
              id="tenant-slug"
              value={slugInput}
              placeholder={slugPreview}
              onChange={(event) => setSlugInput(event.target.value)}
            />
          </FormControl>
          <Typography variant="caption" component="p">
            {slugPreview ? tenantUrl(slugPreview) : 'Enter a name to preview the tenant URL.'}
          </Typography>
          <Button type="submit" variant="contained" disabled={createTenant.isPending || !slugPreview}>
            {createTenant.isPending ? 'creating tenant…' : 'create tenant'}
          </Button>
          {createTenant.isError ? (
            <Alert>
              {createTenant.error instanceof ApiError
                ? createTenant.error.appError.message
                : createTenant.error.message}
            </Alert>
          ) : null}
          {createdSlug ? <Link href={tenantUrl(createdSlug)}>Open {tenantUrl(createdSlug)}</Link> : null}
        </Box>
      </Paper>
    </Box>
  );
};

const TenantHome = ({
  tenant,
  email,
}: {
  tenant: TenantContext;
  email: string;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mode } = useThemeMode();
  const theme = useMemo(() => createThemeForMode(mode, tenantHue(tenant.slug)), [mode, tenant.slug]);

  const signOut = useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/login' });
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', pb: '6rem' }}>
        <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
          <Stack
            direction="row"
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'baseline', columnGap: '1rem', rowGap: '0.6rem' }}
          >
            <TenantSwatch aria-hidden sx={{ width: '0.85rem', height: '0.85rem' }} />
            <Typography variant="h1">{tenant.name}</Typography>
            <HeaderMeta variant="overline">{window.location.hostname}</HeaderMeta>
            <Box sx={{ flex: 1 }} />
            <Chip variant="outlined" label={tenant.staffRole ?? 'member'} />
          </Stack>
          <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
            <HeaderMetaBreak variant="overline">{email}</HeaderMetaBreak>
            <Box sx={{ flex: 1 }} />
            <Button variant="text" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
              sign out
            </Button>
          </Stack>
        </LedgerHeader>

        {tenant.staffRole ? <CreatorPanel /> : <MemberHomeRedirect />}
      </Container>
    </ThemeProvider>
  );
};

const MemberHomeRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: '/my' });
  }, [navigate]);

  return (
    <Box component="section" sx={{ mt: '48px' }}>
      <Typography variant="h2" component="p">
        opening your products…
      </Typography>
    </Box>
  );
};

const CreatorPanel = () => {
  const [section, setSection] = useState<CreatorSection>('products');

  const changeSection = (_event: MouseEvent<HTMLElement>, value: CreatorSection | null) => {
    if (value) setSection(value);
  };

  return (
    <Box component="section" sx={{ mt: '48px' }}>
      <Stack useFlexGap spacing="1.5rem">
        <ToggleButtonGroup
          exclusive
          value={section}
          onChange={changeSection}
          aria-label="Creator sections"
          sx={{ flexWrap: 'wrap' }}
        >
          {creatorSections.map((item) => (
            <ToggleButton key={item.id} value={item.id}>
              {item.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {section === 'products' ? (
          <ProductsPanel />
        ) : (
          <Paper elevation={1} sx={{ p: '1.5rem' }}>
            <Typography variant="h2" component="h2">
              {creatorSections.find((item) => item.id === section)?.label}
            </Typography>
            <Typography variant="body1" sx={{ mt: '1rem' }}>
              Coming soon.
            </Typography>
          </Paper>
        )}
      </Stack>
    </Box>
  );
};
