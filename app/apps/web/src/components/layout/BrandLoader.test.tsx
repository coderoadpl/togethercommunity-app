import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createThemeForMode, MEMBER_BACKGROUND } from '../../theme.js';
import { BrandLoader } from './BrandLoader.js';

const stubReducedMotion = (matches: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

afterEach(() => vi.unstubAllGlobals());

describe('BrandLoader', () => {
  it('renders the solo dot as an animated loading status', () => {
    stubReducedMotion(false);
    render(<BrandLoader data-testid="loader" />);

    const loader = screen.getByRole('status');
    expect(loader).toHaveAttribute('aria-busy', 'true');
    expect(loader).toHaveAttribute('data-motion', 'animated');
    expect(screen.getByTestId('brand-loader-mark').querySelectorAll('circle')).toHaveLength(3);
    expect(screen.queryByText(/together/i)).not.toBeInTheDocument();
  });

  it('renders an optional caption slot below the mark', () => {
    stubReducedMotion(false);
    render(<BrandLoader caption={<span>Otwieranie przestrzeni…</span>} />);

    expect(screen.getByText('Otwieranie przestrzeni…')).toBeInTheDocument();
  });

  it('draws the mark in the neutral secondary text token instead of a brand colour', () => {
    stubReducedMotion(false);
    const theme = createThemeForMode('shadcn', undefined, 'light');
    render(<ThemeProvider theme={theme}><BrandLoader /></ThemeProvider>);

    expect(screen.getByTestId('brand-loader-core')).toHaveAttribute('fill', theme.palette.text.secondary);
    expect(screen.getByTestId('brand-loader-ring')).toHaveAttribute('fill', theme.palette.text.secondary);
    expect(screen.getByTestId('brand-loader-mark').innerHTML).not.toMatch(/#F49A5E|#E8682A/i);
  });

  it.each(['light', 'dark'] as const)('paints the member background on the member surface (%s)', (scheme) => {
    stubReducedMotion(false);
    render(
      <ThemeProvider theme={createThemeForMode('shadcn', undefined, scheme)}>
        <BrandLoader surface="member" />
      </ThemeProvider>,
    );

    expect(screen.getByRole('status')).toHaveStyle({ backgroundColor: MEMBER_BACKGROUND[scheme] });
  });

  it('uses the static reduced-motion class and disables both animations', () => {
    stubReducedMotion(true);
    render(<BrandLoader />);

    const loader = screen.getByRole('status');
    expect(loader).toHaveClass('BrandLoader-reducedMotion');
    expect(loader).toHaveAttribute('data-motion', 'reduced');
    expect(screen.getByTestId('brand-loader-mark')).toHaveStyle({ animation: 'none' });
    expect(screen.getByTestId('brand-loader-glow')).toHaveStyle({ animation: 'none', opacity: '1' });
  });
});
