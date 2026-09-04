import { styled, type SxProps, type Theme } from '@mui/material/styles';

export type LogoSurface = 'sidebar' | 'appbar' | 'card' | 'compact';

const MAX_HEIGHTS: Record<LogoSurface, string> = {
  sidebar: '2rem',
  appbar: '1.25rem',
  card: '2.5rem',
  compact: '1.5rem',
};

const Logo = styled('img', {
  shouldForwardProp: (prop) => prop !== 'surface',
})<{ surface: LogoSurface }>(({ surface }) => ({
  display: 'block',
  width: 'auto',
  height: 'auto',
  maxWidth: '100%',
  maxHeight: MAX_HEIGHTS[surface],
  // A replaced element takes min-width:auto from its intrinsic width, so inside
  // a flex header a wide wordmark refuses to shrink and is cut off at the edge.
  minWidth: 0,
  objectFit: 'contain',
  objectPosition: 'left center',
}));

export const LogoImage = ({
  src,
  alt,
  surface,
  sx,
  'data-testid': testId,
}: {
  src: string;
  alt: string;
  surface: LogoSurface;
  sx?: SxProps<Theme>;
  'data-testid'?: string;
}) => <Logo src={src} alt={alt} surface={surface} sx={sx} data-testid={testId} />;
