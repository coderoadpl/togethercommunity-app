import { useId, type ReactNode } from 'react';
import { Box, Stack, Typography, useMediaQuery } from '@mui/material';
import { keyframes, useTheme } from '@mui/material/styles';

const markPulse = keyframes({
  '0%, 100%': { transform: 'scale(0.92)' },
  '50%': { transform: 'scale(1)' },
});

const glowBreath = keyframes({
  '0%, 100%': { opacity: 0.55 },
  '50%': { opacity: 1 },
});

interface BrandLoaderProps {
  caption?: ReactNode;
  scope?: 'viewport' | 'container';
  'data-testid'?: string;
}

export const BrandLoader = ({
  caption,
  scope = 'viewport',
  'data-testid': testId,
}: BrandLoaderProps) => {
  const theme = useTheme();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const glowId = `brand-loader-glow-${useId().replaceAll(':', '')}`;
  const viewport = scope === 'viewport';

  return (
    <Stack
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={typeof caption === 'string' ? caption : undefined}
      className={reducedMotion ? 'BrandLoader-root BrandLoader-reducedMotion' : 'BrandLoader-root'}
      data-motion={reducedMotion ? 'reduced' : 'animated'}
      data-testid={testId}
      useFlexGap
      sx={{
        width: '100%',
        minHeight: viewport ? '100vh' : { xs: '18rem', sm: 'min(32rem, calc(100vh - 12rem))' },
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        p: '2rem',
        ...(viewport
          ? { '@supports (height: 100dvh)': { minHeight: '100dvh' } }
          : {}),
        '& .BrandLoader-glow': {
          animation: reducedMotion ? 'none' : `${glowBreath} 1.6s ease-in-out infinite`,
        },
      }}
    >
      <Box
        component="svg"
        viewBox="-275 -275 550 550"
        aria-hidden="true"
        className="BrandLoader-mark"
        data-testid="brand-loader-mark"
        style={{ animation: reducedMotion ? 'none' : undefined }}
        sx={{
          display: 'block',
          width: '5rem',
          height: '5rem',
          flex: '0 0 auto',
          transformOrigin: 'center',
          transform: reducedMotion ? 'scale(1)' : undefined,
          animation: reducedMotion ? 'none' : `${markPulse} 1.6s ease-in-out infinite`,
        }}
      >
        <defs>
          <radialGradient id={glowId} cx="0" cy="0" r="175" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F49A5E" stopOpacity="0.55" />
            <stop offset="0.8" stopColor="#F49A5E" stopOpacity="0.55" />
            <stop offset="0.85" stopColor="#F49A5E" stopOpacity="0.2921" />
            <stop offset="0.9" stopColor="#F49A5E" stopOpacity="0.1197" />
            <stop offset="0.944" stopColor="#F49A5E" stopOpacity="0.0334" />
            <stop offset="0.976" stopColor="#F49A5E" stopOpacity="0.0052" />
            <stop offset="1" stopColor="#F49A5E" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g opacity={theme.palette.mode === 'light' ? 0.62 : 1}>
          <circle
            cx="0"
            cy="0"
            r="175"
            fill={`url(#${glowId})`}
            className="BrandLoader-glow"
            data-testid="brand-loader-glow"
            style={{
              opacity: reducedMotion ? 1 : undefined,
              animation: reducedMotion ? 'none' : undefined,
            }}
          />
        </g>
        <circle cx="0" cy="0" r="140" fill="#F49A5E" />
        <circle cx="0" cy="0" r="100" fill="#E8682A" />
      </Box>
      {caption !== undefined ? (
        <Typography variant="caption" component="div" color="text.secondary" align="center">
          {caption}
        </Typography>
      ) : null}
    </Stack>
  );
};
