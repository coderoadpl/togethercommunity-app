import type { ReactNode } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';

import { CardTitle, EmptyStateContent } from '../../theme.js';

export type PageState =
  | { kind: 'ready' }
  | { kind: 'loading'; label: ReactNode }
  | { kind: 'error'; message: ReactNode; retry: { label: ReactNode; onRetry: () => void } }
  | { kind: 'empty'; icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }
  | { kind: 'not-found'; icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode };

interface StatusViewProps {
  state: PageState;
  surface?: boolean;
  'data-testid'?: string;
}

export const StatusView = ({ state, surface = true, 'data-testid': testId }: StatusViewProps) => {
  switch (state.kind) {
    case 'ready':
      return null;
    case 'loading':
      return (
        <Typography
          variant="h2"
          component="p"
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-testid={testId}
        >
          {state.label}
        </Typography>
      );
    case 'error':
      return (
        <Box data-testid={testId} sx={{ width: '100%' }}>
          <Alert severity="error">{state.message}</Alert>
          <Box sx={{ mt: '0.75rem' }}>
            <Button variant="outlined" fullWidth onClick={state.retry.onRetry}>
              {state.retry.label}
            </Button>
          </Box>
        </Box>
      );
    case 'empty':
    case 'not-found': {
      const content = (
        <EmptyStateContent
          useFlexGap
          sx={{ rowGap: '0.75rem' }}
          {...(!surface ? { 'data-testid': testId, 'data-state': state.kind } : {})}
        >
          {state.icon}
          <CardTitle variant="h2">{state.title}</CardTitle>
          {state.body !== undefined && (
            <Typography variant="body1" component="div">
              {state.body}
            </Typography>
          )}
          {state.action !== undefined && <Box sx={{ mt: '0.25rem' }}>{state.action}</Box>}
        </EmptyStateContent>
      );
      return surface ? (
        <Paper elevation={1} sx={{ p: '2.5rem' }} data-testid={testId} data-state={state.kind}>
          {content}
        </Paper>
      ) : content;
    }
  }
};
