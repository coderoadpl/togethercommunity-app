import type { ReactNode } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';

import { CardTitle, EmptyStateContent, EmptyStateIcon } from '../../theme.js';

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
    case 'empty': {
      const content = (
        <EmptyStateContent
          useFlexGap
          sx={{ rowGap: '0.5rem' }}
          {...(!surface ? { 'data-testid': testId, 'data-state': state.kind } : {})}
        >
          <Box sx={{ alignItems: 'center', display: 'flex', gap: '0.45rem' }}>
            {state.icon ?? (
              <EmptyStateIcon aria-hidden viewBox="0 0 24 24">
                <path d="M4 5h16v14H4V5Zm2 2v10h12V7H6Zm2 4h8v2H8v-2Z" />
              </EmptyStateIcon>
            )}
            <Typography variant="body2" component="h2" color="text.secondary">
              {state.title}
            </Typography>
          </Box>
          {state.body !== undefined && (
            <Typography variant="caption" component="div" color="text.secondary">
              {state.body}
            </Typography>
          )}
          {state.action !== undefined && <Box sx={{ mt: '0.125rem' }}>{state.action}</Box>}
        </EmptyStateContent>
      );
      return surface ? (
        <Paper elevation={1} sx={{ p: '1.25rem' }} data-testid={testId} data-state={state.kind}>
          {content}
        </Paper>
      ) : content;
    }
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
