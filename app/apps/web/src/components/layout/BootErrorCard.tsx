import type { ReactNode } from 'react';
import { Button, Typography } from '@mui/material';

import { CardTitle } from '../../theme.js';
import { FocusCard } from './FocusCard.js';

export const BootErrorCard = ({
  eyebrow,
  title,
  message,
  retry,
  'data-testid': testId,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  message: ReactNode;
  retry: { label: ReactNode; onRetry: () => void };
  'data-testid': string;
}) => (
  <FocusCard eyebrow={eyebrow} data-testid={testId}>
    <CardTitle variant="h1">{title}</CardTitle>
    <Typography variant="body1" role="alert" sx={{ mt: '1rem' }}>
      {message}
    </Typography>
    <Button variant="contained" fullWidth onClick={retry.onRetry} sx={{ mt: '1.5rem' }}>
      {retry.label}
    </Button>
  </FocusCard>
);
