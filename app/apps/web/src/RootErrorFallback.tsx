import { Box, Button, Paper, Typography } from '@mui/material';

import { ApiError } from '@core/client/index.js';

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
    case 'not_found':
      return t.errors.headingNotFound;
    case 'tenant_not_found':
      return t.errors.headingTenantNotFound;
    case 'validation':
      return t.errors.headingValidation;
    case 'conflict':
      return t.errors.headingConflict;
    case 'integration_not_configured':
    case 'integration_auth':
    case 'integration_unavailable':
    case 'internal':
      return t.errors.headingGeneric;
  }
};

const detailFor = (error: unknown, t: Messages): string =>
  error instanceof ApiError ? localizeErrorCode(error.appError.code, t) : t.errors.detailGeneric;

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
          <Typography variant="caption" component="p" sx={{ mb: '1.4rem' }}>
            {t.errors.traceId} <code>{traceId}</code>
          </Typography>
        )}
        <Button variant="contained" fullWidth onClick={() => window.location.reload()}>
          {t.common.reload}
        </Button>
      </Paper>
    </Box>
  );
};

/** Render-prop entry for the boundary: binds the live trace id. */
export const renderRootErrorFallback = (error: unknown) => (
  <RootErrorFallback error={error} traceId={activeTraceId()} />
);
