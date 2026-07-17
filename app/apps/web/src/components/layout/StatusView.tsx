import type { ReactNode } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';

import { CardTitle, EmptyStateContent } from '../../theme.js';

export type PageState =
  | { kind: 'ready' }
  | { kind: 'loading'; label: ReactNode }
  | { kind: 'error'; message: ReactNode; retry?: { label: ReactNode; onRetry: () => void } }
  | { kind: 'empty'; icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }
  | { kind: 'not-found'; icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode };

interface StatusViewProps {
  state: PageState;
  'data-testid'?: string;
}

export const StatusView = ({ state, 'data-testid': testId }: StatusViewProps) => {
  switch (state.kind) {
    case 'ready':
      return null;
    case 'loading':
      return (
        <Typography variant="h2" component="p" data-testid={testId}>
          {state.label}
        </Typography>
      );
    case 'error':
      return (
        <Box data-testid={testId}>
          <Alert>{state.message}</Alert>
          {state.retry !== undefined && (
            <Box sx={{ mt: '0.75rem' }}>
              <Button variant="outlined" onClick={state.retry.onRetry}>
                {state.retry.label}
              </Button>
            </Box>
          )}
        </Box>
      );
    case 'empty':
    case 'not-found':
      return (
        <Paper elevation={1} sx={{ p: '2.5rem' }} data-testid={testId} data-state={state.kind}>
          <EmptyStateContent useFlexGap sx={{ rowGap: '0.75rem' }}>
            {state.icon}
            <CardTitle variant="h2">{state.title}</CardTitle>
            {state.body !== undefined && <Typography variant="body1">{state.body}</Typography>}
            {state.action !== undefined && <Box sx={{ mt: '0.25rem' }}>{state.action}</Box>}
          </EmptyStateContent>
        </Paper>
      );
  }
};
