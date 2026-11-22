import { Alert, Button, Stack } from '@mui/material';

import { localizeError, useTranslations } from '../../../i18n/index.js';
import { hasConfiguredBaseDomain, isTenantHost, tenantUrl } from '../../../lib/tenant.js';
import { useVisitorSignOut } from './visitor-sign-out.js';

export const ForeignTenantNotice = ({
  email,
  hostname,
}: {
  email: string;
  hostname: string;
}) => {
  const t = useTranslations();
  const signOut = useVisitorSignOut();

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
