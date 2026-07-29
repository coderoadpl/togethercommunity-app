import type { FormEvent, ReactNode } from 'react';
import { Box, Divider, Paper } from '@mui/material';

import { Eyebrow, Wordmark } from '../../theme.js';
import { PAGE_WIDTH } from './widths.js';

interface FocusCardProps {
  eyebrow: ReactNode;
  width?: 'narrow' | 'wide';
  brand?: ReactNode;
  footer?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  'data-testid'?: string;
}

const CARD_WIDTH = { narrow: PAGE_WIDTH.focusNarrow, wide: PAGE_WIDTH.focusWide } as const;

const defaultBrand = (
  <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
    Together
  </Wordmark>
);

export const FocusCard = ({
  eyebrow,
  width = 'narrow',
  brand = defaultBrand,
  footer,
  onSubmit,
  children,
  'data-testid': testId,
}: FocusCardProps) => (
  <Box
    component="main"
    sx={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      px: '1.5rem',
      pb: '1.5rem',
      // Extra top inset on phones so the floating dev chrome (language/theme
      // switchers) cannot overlap the card (decision D4 follow-up).
      pt: { xs: '4rem', sm: '1.5rem' },
    }}
  >
    <Paper
      variant="outlined"
      component={onSubmit === undefined ? 'div' : 'form'}
      onSubmit={onSubmit}
      sx={{
        width: '100%',
        maxWidth: CARD_WIDTH[width],
        px: '1.8rem',
        pt: '2rem',
        pb: '1.6rem',
        animation: 'settle 0.45s ease-out both',
      }}
      data-testid={testId}
    >
      {brand}
      <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
        {eyebrow}
      </Eyebrow>
      {children}
      {footer !== undefined && (
        <>
          <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
          {footer}
        </>
      )}
    </Paper>
  </Box>
);
