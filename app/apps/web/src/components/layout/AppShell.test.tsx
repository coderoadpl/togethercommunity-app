import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './AppShell.js';

describe('AppShell', () => {
  it('renders desktop chrome and the page outlet slot', () => {
    render(
      <AppShell
        isDesktop
        mobileNavigationOpen={false}
        onMobileNavigationClose={vi.fn()}
        header={<span>Acme header</span>}
        navigation={<nav><a href="/panel/products">Products</a></nav>}
      >
        <p>Panel content</p>
      </AppShell>,
    );

    expect(screen.getByRole('banner')).toHaveTextContent('Acme header');
    expect(screen.getByRole('navigation')).toHaveTextContent('Products');
    expect(screen.getByRole('main')).toHaveTextContent('Panel content');
  });

  it('renders the temporary navigation when opened on mobile', () => {
    render(
      <AppShell
        isDesktop={false}
        mobileNavigationOpen
        onMobileNavigationClose={vi.fn()}
        header={<span>Mobile header</span>}
        navigation={<nav><a href="/panel/products">Products</a></nav>}
      >
        <p>Panel content</p>
      </AppShell>,
    );

    expect(screen.getByRole('navigation')).toHaveTextContent('Products');
  });
});
