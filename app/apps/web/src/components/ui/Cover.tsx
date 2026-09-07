import { useState } from 'react';
import { useTheme } from '@mui/material/styles';

import { accentGradient, deterministicAccent } from '../../theme-branding.js';
import {
  CoverFallbackBox,
  CoverFallbackMonogram,
  CoverFallbackTitle,
  CoverImageElement,
  type CoverFrame,
} from '../../theme.js';

const monogramOf = (title: string): string =>
  title
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => (word[0] ?? '').toLocaleUpperCase())
    .join('');

const CoverFallback = ({
  title,
  frame = 'card',
  testId,
}: {
  title: string;
  frame?: CoverFrame;
  testId?: string | undefined;
}) => {
  const theme = useTheme();
  const gradient = accentGradient(theme.brandAccent ?? deterministicAccent(title));
  return (
    <CoverFallbackBox frame={frame} gradient={gradient} data-testid={testId}>
      <CoverFallbackMonogram component="span" aria-hidden>
        {monogramOf(title)}
      </CoverFallbackMonogram>
      <CoverFallbackTitle component="span">{title}</CoverFallbackTitle>
    </CoverFallbackBox>
  );
};

/**
 * Three states: the image · the accent fallback · nothing at all. `whenMissing`
 * only decides what an absent cover leaves behind — a cover that fails to load
 * always switches to the fallback, so no loaded screen shows an empty frame.
 */
export const Cover = ({
  src,
  title,
  alt,
  frame = 'card',
  whenMissing = 'fallback',
  testId,
  fallbackTestId,
}: {
  src: string | null;
  title: string;
  alt: string;
  frame?: CoverFrame;
  whenMissing?: 'fallback' | 'omit';
  testId?: string | undefined;
  fallbackTestId?: string | undefined;
}) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src === null) {
    if (whenMissing === 'omit') return null;
    return <CoverFallback title={title} frame={frame} testId={fallbackTestId} />;
  }

  if (failedSrc === src) {
    return <CoverFallback title={title} frame={frame} testId={fallbackTestId} />;
  }

  return (
    <CoverImageElement
      frame={frame}
      src={src}
      alt={alt}
      loading={frame === 'standalone' ? 'eager' : 'lazy'}
      onError={() => setFailedSrc(src)}
      data-testid={testId}
    />
  );
};
