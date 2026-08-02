import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrandSplash } from './BrandSplash.js';

const props = {
  ariaLabel: 'Opening the creator panel',
  buildStamp: <span data-testid="build-stamp">v0.1.0</span>,
  tenantLabel: 'space acme.localhost',
  warmingLabel: 'Warming up your space…',
  wordmark: 'Together',
};

describe('BrandSplash', () => {
  afterEach(() => vi.useRealTimers());

  it('renders the pending creator bootstrap without app chrome', () => {
    render(<BrandSplash {...props} />);

    const status = screen.getByRole('status', { name: props.ariaLabel });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: props.wordmark })).toBeInTheDocument();
    expect(screen.getByText(props.tenantLabel)).toBeInTheDocument();
    expect(screen.getByTestId('boot-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('build-stamp')).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('shows the warming message at the four-second threshold', () => {
    vi.useFakeTimers();
    render(<BrandSplash {...props} />);

    act(() => {
      vi.advanceTimersByTime(3_999);
    });
    expect(screen.queryByText(props.warmingLabel)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(props.warmingLabel)).toBeInTheDocument();
  });
});
