import { Alert, Button, Stack } from '@mui/material';

import { useTranslations } from '../../../i18n/index.js';
import { hasConfiguredBaseDomain, isTenantHost, tenantUrl } from '../../../lib/tenant.js';

export const ForeignTenantNotice = ({
  email,
  hostname,
}: {
  email: string;
  hostname: string;
}) => {
  const t = useTranslations();

  if (!hasConfiguredBaseDomain() || !isTenantHost(hostname)) return null;
  return (
    <Alert severity="info" role="status" data-testid="foreign-tenant-notice" sx={{ mb: 3, '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' } }}>
      {t.tenant.visitorNotice({ email })}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: 'flex-start' }}>
        <Button component="a" href={tenantUrl('start')} size="small" sx={{ minHeight: '44px' }}>
          {t.tenant.visitorOwnCommunity}
        </Button>
      </Stack>
    </Alert>
  );
};
