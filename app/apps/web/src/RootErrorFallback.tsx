import { Box, Button, Link, Paper, Typography } from '@mui/material';

import { ApiError } from '#core/client/index.js';

import { localizeErrorCode, useTranslations, type Messages } from './i18n/index.js';
import { activeTraceId } from './observability.js';

const headingFor = (error: unknown, t: Messages): string => {
  if (!(error instanceof ApiError)) return t.errors.headingGeneric;
  switch (error.appError.code) {
    case 'unauthorized':
      return t.errors.headingSessionEnded;
    case 'invalid_credentials':
      return t.errors.headingInvalidCredentials;
    case 'forbidden':
      return t.errors.headingForbidden;
    case 'banned':
      return t.errors.headingForbidden;
    case 'impersonation_read_only':
      return t.errors.headingImpersonationReadOnly;
    case 'not_found':
      return t.errors.headingNotFound;
    case 'tenant_not_found':
      return t.errors.headingTenantNotFound;
    case 'locker_phone_invalid':
    case 'validation':
      return t.errors.headingValidation;
    case 'organization_managed':
      return t.errors.headingForbidden;
    case 'conflict':
    case 'fulfilment_conflict':
    case 'delivery_correction_shipped':
    case 'delivery_correction_shipment_bought':
    case 'feed_cursor_reset':
      return t.errors.headingConflict;
    case 'slug_reserved':
      return t.errors.headingSlugReserved;
    case 'sold_out':
      return t.errors.headingSoldOut;
    case 'integration_not_configured':
    case 'integration_auth':
    case 'integration_unavailable':
    case 'unavailable':
    case 'rate_limited':
    case 'not_consented':
    case 'suppressed':
    case 'unsubscribed':
    case 'pending_confirmation':
    case 'ses_not_configured':
    case 'broadcasts_disabled':
    case 'transactional_platform_cap_reached':
    case 'invoice_exemption_basis_missing':
    case 'shipping_required':
    case 'shipx_unavailable':
    case 'shipx_rejected':
    case 'workspace_quota_exceeded':
    case 'internal':
      return t.errors.headingGeneric;
  }
};

const detailFor = (error: unknown, t: Messages): string =>
  error instanceof ApiError ? localizeErrorCode(error.appError.code, t) : t.errors.detailGeneric;

const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

interface RootErrorFallbackProps {
  error: unknown;
  traceId: string | undefined;
}

/**
 * Presentational fallback for the root error boundary. Shows the taxonomy-aware
 * message and, whenever tracing is active, the trace id so a user can paste it
 * into a support request; it is simply absent when tracing is not configured.
 */
export const RootErrorFallback = ({ error, traceId }: RootErrorFallbackProps) => {
  const t = useTranslations();
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        role="alert"
        sx={{ width: '100%', maxWidth: '23rem', px: '1.8rem', pt: '2rem', pb: '1.6rem' }}
      >
        <Typography variant="h1" sx={{ mb: '0.4rem' }}>
          {headingFor(error, t)}
        </Typography>
        <Typography variant="body2" sx={{ mb: '1.4rem' }}>
          {detailFor(error, t)}
        </Typography>
        {traceId === undefined ? null : (
          <Box sx={{ mb: '1.4rem' }}>
            <Typography variant="caption" component="p">
              {t.errors.traceId} <code>{traceId}</code>
            </Typography>
            <Typography variant="caption" component="p" data-testid="root-error-trace-hint">
              {t.errors.traceIdHint}
            </Typography>
          </Box>
        )}
        {isUnauthorized(error) ? (
          <Button variant="contained" fullWidth href="/login" data-testid="root-error-sign-in">
            {t.auth.signInLink}
          </Button>
        ) : (
          <Button variant="contained" fullWidth onClick={() => window.location.reload()}>
            {t.common.reload}
          </Button>
        )}
        <Box sx={{ mt: '1rem', display: 'flex', justifyContent: 'center' }}>
          <Link href="/" variant="body2" data-testid="root-error-start">
            {t.errors.backToStart}
          </Link>
        </Box>
      </Paper>
    </Box>
  );
};

/** Render-prop entry for the boundary: binds the live trace id. */
export const renderRootErrorFallback = (error: unknown) => (
  <RootErrorFallback error={error} traceId={activeTraceId()} />
);
