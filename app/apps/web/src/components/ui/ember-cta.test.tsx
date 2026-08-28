import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createThemeForMode, EmberCtaButton, type ResolvedColorScheme } from '../../theme.js';

const renderedColor = (scheme: ResolvedColorScheme) => {
  render(
    <ThemeProvider theme={createThemeForMode('shadcn', undefined, scheme)}>
      <EmberCtaButton variant="contained">Odblokuj dostęp</EmberCtaButton>
    </ThemeProvider>,
  );
  return getComputedStyle(screen.getByRole('button', { name: 'Odblokuj dostęp' })).color;
};

describe('EmberCtaButton', () => {
  it('keeps the ember ink on the contained variant in the light scheme', () => {
    expect(renderedColor('light')).toBe('rgb(28, 18, 11)');
  });

  it('keeps the ember ink on the contained variant in the dark scheme', () => {
    expect(renderedColor('dark')).toBe('rgb(28, 18, 11)');
  });
});
