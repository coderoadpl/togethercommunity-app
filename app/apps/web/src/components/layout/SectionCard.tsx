import type { FormEvent, ReactNode } from 'react';
import { Paper, Stack, Typography } from '@mui/material';

interface SectionCardProps {
  /** Always an h2 — eyebrows stay eyebrows (inventory rows 26/38/39). */
  title: ReactNode;
  description?: ReactNode;
  /** Footer action row, right-aligned (Zapisz, Testuj połączenie). */
  actions?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  'data-testid'?: string;
}

export const SectionCard = ({
  title,
  description,
  actions,
  onSubmit,
  children,
  'data-testid': testId,
}: SectionCardProps) => (
  <Paper
    elevation={1}
    component={onSubmit === undefined ? 'div' : 'form'}
    onSubmit={onSubmit}
    sx={{ p: '1.5rem' }}
    data-testid={testId}
  >
    <Typography variant="h2" component="h2">
      {title}
    </Typography>
    {description !== undefined && (
      <Typography variant="body2" color="text.secondary" sx={{ mt: '0.35rem' }}>
        {description}
      </Typography>
    )}
    <Stack useFlexGap sx={{ mt: '1rem', rowGap: '1rem' }}>
      {children}
    </Stack>
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
