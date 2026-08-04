import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

import { StatusView, type PageState } from './StatusView.js';
import { PAGE_WIDTH } from './widths.js';

interface PanelPageProps {
  /** Quiet h1 (decision D1): title + optional description, no eyebrow or rule. */
  title: ReactNode;
  description?: ReactNode;
  /** Primary action, top-right; wraps under the title on narrow viewports. */
  action?: ReactNode;
  backTo?: ReactNode;
  state?: PageState;
  children?: ReactNode;
  'data-testid'?: string;
}

export const PanelPage = ({
  title,
  description,
  action,
  backTo,
  state,
  children,
  'data-testid': testId,
}: PanelPageProps) => {
  const statusOnly = state !== undefined && state.kind !== 'ready';

  return (
    <Box data-testid={testId} sx={{ maxWidth: PAGE_WIDTH.panel, mx: 'auto' }}>
      <Box component="header" sx={{ mb: '1.5rem' }}>
        {backTo !== undefined && <Box sx={{ mb: '0.75rem' }}>{backTo}</Box>}
        <Stack
          direction="row"
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center', columnGap: '1rem', rowGap: '0.75rem' }}
        >
          <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
            <Typography variant="h1">{title}</Typography>
            {description !== undefined && (
              <Typography variant="body1" color="text.secondary" sx={{ mt: '0.35rem' }}>
                {description}
              </Typography>
            )}
          </Box>
          {action !== undefined && (
            <Box sx={{ flexShrink: 0, '& .MuiButtonBase-root': { minHeight: '44px' } }}>{action}</Box>
          )}
        </Stack>
      </Box>
      <Stack useFlexGap sx={{ rowGap: '1.5rem' }}>
        {statusOnly ? <StatusView state={state} /> : children}
      </Stack>
    </Box>
  );
};
