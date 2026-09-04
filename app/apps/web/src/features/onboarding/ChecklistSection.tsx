import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

interface ChecklistSectionProps {
  title: ReactNode;
  description?: ReactNode;
  headerActions?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}

export const ChecklistSection = ({
  title,
  description,
  headerActions,
  children,
  'data-testid': testId,
}: ChecklistSectionProps) => (
  <Box component="section" data-testid={testId} sx={{ minWidth: 0 }}>
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '0.5rem',
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" component="h3">
          {title}
        </Typography>
        {description === undefined ? null : (
          <Typography variant="caption" component="p" color="text.secondary">
            {description}
          </Typography>
        )}
      </Box>
      {headerActions === undefined ? null : (
        <Stack direction="row" useFlexGap sx={{ columnGap: '0.25rem', flexWrap: 'wrap' }}>
          {headerActions}
        </Stack>
      )}
    </Box>
    {children === undefined || children === null ? null : (
      <Stack useFlexGap sx={{ mt: '0.5rem', rowGap: '0.75rem' }}>
        {children}
      </Stack>
    )}
  </Box>
);
