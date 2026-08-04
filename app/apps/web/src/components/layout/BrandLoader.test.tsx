import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
