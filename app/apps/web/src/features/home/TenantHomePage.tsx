import { useEffect, useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  ThemeProvider,
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
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        sx={{ width: '100%', maxWidth: '23rem', px: '1.8rem', pt: '2rem', pb: '1.6rem' }}
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
      </Paper>
    </Box>
  );
};

const TenantHome = ({
  tenant,
  email,
}: {
  tenant: { id: string; slug: string; name: string; staffRole: string | null; memberId: string | null };
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

        <Box component="section" sx={{ mt: '48px' }}>
          <Typography variant="h2" component="h2" sx={{ mb: '24px' }}>
            Your workspace
          </Typography>
          <Typography variant="h2" component="p" sx={{ py: '24px' }}>
            — the creator panel arrives in a later stage —
          </Typography>
        </Box>
      </Container>
    </ThemeProvider>
  );
};
