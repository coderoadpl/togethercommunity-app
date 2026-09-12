import { Alert, Button, Stack } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { forgetLoginIdentifier } from '../../../lib/login-identifier.js';
import { hasConfiguredBaseDomain, isTenantHost, tenantUrl } from '../../../lib/tenant.js';

export const ForeignTenantNotice = ({
  email,
  hostname,
}: {
  email: string;
  hostname: string;
}) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      forgetLoginIdentifier();
      queryClient.clear();
      await navigate({ to: '/login' });
    },
  });

  if (!hasConfiguredBaseDomain() || !isTenantHost(hostname)) return null;
  return (
    <Alert severity="info" role="status" data-testid="foreign-tenant-notice" sx={{ mb: 3, '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' } }}>
      {t.tenant.visitorNotice({ email })}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: 'flex-start' }}>
        <Button component="a" href={tenantUrl('start')} size="small" sx={{ minHeight: '44px' }}>
          {t.tenant.visitorOwnCommunity}
        </Button>
        <Button size="small" disabled={signOut.isPending} onClick={() => signOut.mutate()} sx={{ minHeight: '44px' }}>
          {t.tenant.visitorSwitchAccount}
        </Button>
      </Stack>
      {signOut.isError ? <Alert severity="error" sx={{ mt: 1 }}>{localizeError(signOut.error, t)}</Alert> : null}
    </Alert>
  );
};
