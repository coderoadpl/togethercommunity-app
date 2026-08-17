import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  FormControl,
  FormLabel,
  Link,
  List,
  ListItem,
  ListItemButton,
  OutlinedInput,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { BrandLoader } from '../../components/layout/BrandLoader.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { EmailVerificationStatus } from '../../components/ui/EmailVerificationStatus.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { tenantUrl } from '../../lib/tenant.js';
import { CardTitle, TenantListItemText } from '../../theme.js';

export const TenantHomePage = () => {
  const navigate = useNavigate();
  const t = useTranslations();
  const me = useQuery(actions.me);

  const unauthorized = me.error instanceof ApiError && me.error.appError.code === 'unauthorized';
  const tenant = me.data?.tenant ?? null;
  const staff = tenant !== null && tenant.staffRole !== null;
  const memberOnly = tenant !== null && tenant.staffRole === null;

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
    else if (staff) void navigate({ to: '/panel' });
    else if (memberOnly) void navigate({ to: '/start' });
  }, [unauthorized, staff, memberOnly, navigate]);

  if (me.isPending) {
    return <BrandLoader caption={t.tenant.openingWorkspace} />;
  }
  if (unauthorized || staff || memberOnly) return null;
  if (me.isError) {
    return (
      <Container sx={{ maxWidth: '44rem' }}>
        <Alert severity="error" sx={{ mt: 4 }}>{localizeError(me.error, t)}</Alert>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => void me.refetch()}>{t.common.retry}</Button>
      </Container>
    );
  }

  return <PickTenant account={{ email: me.data.email, emailVerified: me.data.emailVerified }} />;
};

const PickTenant = ({ account }: { account: { email: string; emailVerified: boolean } }) => {
  const t = useTranslations();
  const { language } = useLanguage();
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
  const resendVerification = useMutation(actions.sendVerificationEmail);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createTenant.mutate({ name, slug: slugPreview });
  };
  const slugReserved =
    typeof createTenant.error === 'object' &&
    createTenant.error !== null &&
    'appError' in createTenant.error &&
    typeof createTenant.error.appError === 'object' &&
    createTenant.error.appError !== null &&
    'code' in createTenant.error.appError &&
    createTenant.error.appError.code === 'slug_reserved';

  return (
    <FocusCard eyebrow={t.tenant.eachOwnDomain} width="wide">
        <CardTitle variant="h1">{t.tenant.choose}</CardTitle>
        <Typography variant="body1" sx={{ mt: '0.75rem' }}>
          {t.tenant.welcome}
        </Typography>
        {tenants.isPending ? (
          <Typography variant="h2" component="p" sx={{ py: 2 }}>
            {t.tenant.loading}
          </Typography>
        ) : null}
        {tenants.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(tenants.error, t), retry: { label: t.common.retry, onRetry: () => void tenants.refetch() } }} /> : null}
        <List sx={{ mt: '1.2rem' }} disablePadding>
          {tenants.data?.tenants.map((m) => (
            <ListItem key={m.tenant.id} disablePadding>
              <ListItemButton component="a" href={tenantUrl(m.tenant.slug)} sx={{ px: '0.3rem' }}>
                <TenantListItemText
                  primary={m.tenant.name}
                  secondary={tenantUrl(m.tenant.slug)}
                  slotProps={{ secondary: { variant: 'caption' } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        {!account.emailVerified ? (
          <Box sx={{ mt: '1.5rem' }}>
            <EmailVerificationStatus
              email={account.email}
              emailVerified={false}
              resendPending={resendVerification.isPending}
              resendSent={resendVerification.isSuccess}
              resendError={resendVerification.isError}
              onResend={() => resendVerification.mutate({
                email: account.email,
                callbackURL: new URL('/login?verification=verified', window.location.origin).toString(),
                language,
              })}
            />
          </Box>
        ) : null}
        {tenants.data?.canCreateTenant ? (
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
          {slugReserved ? (
            <Typography color="error" variant="caption" component="p">
              {t.errors.messageSlugReserved({ slug: slugPreview })}
            </Typography>
          ) : null}
          <Button type="submit" variant="contained" disabled={createTenant.isPending || !slugPreview}>
            {createTenant.isPending ? t.tenant.creating : t.tenant.createButton}
          </Button>
          {createTenant.isError ? (
            <Alert severity="error">{localizeError(createTenant.error, t)}</Alert>
          ) : null}
          {createdSlug ? (
            <Link href={tenantUrl(createdSlug)}>{t.tenant.open({ url: tenantUrl(createdSlug) })}</Link>
          ) : null}
          </Box>
        ) : null}
    </FocusCard>
  );
};
