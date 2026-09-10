import type { FormEvent, ReactNode } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

interface SectionCardProps {
  title: ReactNode;
  mobilePadding?: boolean;
  description?: ReactNode;
  actions?: ReactNode;
  headerActions?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children?: ReactNode;
  'data-testid'?: string;
}

export const SectionCard = ({
  title,
  mobilePadding = false,
  description,
  actions,
  headerActions,
  onSubmit,
  children,
  'data-testid': testId,
}: SectionCardProps) => (
  <Paper
    elevation={1}
    component={onSubmit === undefined ? 'div' : 'form'}
    onSubmit={onSubmit}
    sx={{ p: mobilePadding ? '1rem' : '1.5rem', '@media (min-width: 1024px)': { p: '1.5rem' }, minWidth: 0 }}
    data-testid={testId}
  >
    {headerActions === undefined ? (
      <>
        <Typography variant="h2" component="h2">
          {title}
        </Typography>
        {description !== undefined && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: '0.35rem' }}>
            {description}
          </Typography>
        )}
      </>
    ) : (
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h2" component="h2">
            {title}
          </Typography>
          {description !== undefined && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: '0.35rem' }}>
              {description}
            </Typography>
          )}
        </Box>
        <Stack direction="row" useFlexGap sx={{ columnGap: '0.75rem', flexWrap: 'wrap' }}>
          {headerActions}
        </Stack>
      </Box>
    )}
    {children === undefined || children === null ? null : (
      <Stack useFlexGap sx={{ mt: '1rem', rowGap: '1rem' }}>
        {children}
      </Stack>
    )}
    {actions !== undefined && (
      <Stack
        direction="row"
        useFlexGap
        sx={{ mt: '1.25rem', columnGap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}
      >
        {actions}
      </Stack>
    )}
  </Paper>
);
