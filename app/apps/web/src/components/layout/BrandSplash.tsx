import { useEffect, useState, type ReactNode } from 'react';
import { Box, Stack } from '@mui/material';

import { BootIndicator, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

const SLOW_START_MS = 4_000;

interface BrandSplashProps {
  ariaLabel: string;
  buildStamp: ReactNode;
  tenantLabel: string;
  warmingLabel: string;
  wordmark: string;
}

export const BrandSplash = ({
  ariaLabel,
  buildStamp,
  tenantLabel,
  warmingLabel,
  wordmark,
}: BrandSplashProps) => {
  const [slowStart, setSlowStart] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlowStart(true), SLOW_START_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      sx={{ minHeight: '100vh', display: 'grid', gridTemplateRows: '1fr auto', p: '1.5rem' }}
    >
      <Stack
        useFlexGap
        sx={{
          alignSelf: 'center',
          justifySelf: 'center',
          alignItems: 'center',
          width: '100%',
          maxWidth: '23rem',
          rowGap: '0.9rem',
        }}
      >
        <Wordmark variant="h1">{wordmark}</Wordmark>
        <Eyebrow variant="overline" component="p">
          {tenantLabel}
        </Eyebrow>
        <BootIndicator data-testid="boot-indicator" />
        <Box sx={{ display: 'flex', alignItems: 'center', minHeight: '1.5rem' }}>
          {slowStart ? (
            <FinePrint variant="caption" component="p">
              {warmingLabel}
            </FinePrint>
          ) : null}
        </Box>
      </Stack>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        {buildStamp}
      </Box>
    </Box>
  );
};
