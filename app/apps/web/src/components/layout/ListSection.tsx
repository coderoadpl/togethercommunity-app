import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

interface ListSectionToolbar {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
}

interface ListSectionProps {
  /** Section h2 when the list is not the whole page. */
  title?: ReactNode;
  toolbar?: ListSectionToolbar;
  pagination?: ReactNode;
  /** Collection empty before any filtering: hides the toolbar, shows `empty`. */
  isEmpty: boolean;
  empty: ReactNode;
  /** Pass when filters/search match nothing: replaces `children`, toolbar stays. */
  noMatches?: ReactNode;
  children: ReactNode;
  'data-testid'?: string;
}

/** Horizontal scroller for tables that outgrow narrow viewports. */
export const ResponsiveTable = ({
  children,
  'data-testid': testId,
}: {
  children: ReactNode;
  'data-testid'?: string;
}) => (
  <Box sx={{ overflowX: 'auto' }} data-testid={testId}>
    {children}
  </Box>
);

export const ListSection = ({
  title,
  toolbar,
  pagination,
  isEmpty,
  empty,
  noMatches,
  children,
  'data-testid': testId,
}: ListSectionProps) => (
  <Box component="section" data-testid={testId}>
    {title !== undefined && (
      <Typography variant="h2" component="h2" sx={{ mb: '1rem' }}>
        {title}
      </Typography>
    )}
    {isEmpty ? (
      empty
    ) : (
      <>
        {toolbar !== undefined && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            useFlexGap
            sx={{
              mb: '1rem',
              columnGap: '0.75rem',
              rowGap: '0.75rem',
              flexWrap: 'wrap',
              alignItems: { sm: 'center' },
            }}
          >
            {toolbar.search !== undefined && (
              <Box sx={{ flex: { sm: '1 1 14rem' }, minWidth: 0 }}>{toolbar.search}</Box>
            )}
            {toolbar.filters}
            {toolbar.actions !== undefined && (
              <Box sx={{ ml: { sm: 'auto' }, flexShrink: 0 }}>{toolbar.actions}</Box>
            )}
          </Stack>
        )}
        {noMatches ?? children}
        {pagination !== undefined && <Box sx={{ mt: '1rem' }}>{pagination}</Box>}
      </>
    )}
  </Box>
);
