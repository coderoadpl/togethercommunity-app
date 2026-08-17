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
        mobileNavigationCloseLabel="Close navigation"
        header={<span>Acme header</span>}
        navigation={<nav><a href="/panel/products">Products</a></nav>}
        brand={<span data-testid="shell-brand">Acme</span>}
        footer={<span data-testid="shell-footer">v0.1.0</span>}
      >
        <p>Panel content</p>
      </AppShell>,
    );

    expect(screen.getByRole('banner')).toHaveTextContent('Acme header');
    expect(screen.getByRole('navigation')).toHaveTextContent('Products');
    expect(screen.getByRole('main')).toHaveTextContent('Panel content');
    expect(screen.getByRole('contentinfo')).toContainElement(screen.getByTestId('shell-footer'));

    const sidebar = screen.getByRole('complementary');
    expect(sidebar).toContainElement(screen.getByTestId('shell-brand'));
    expect(screen.getByRole('banner')).not.toContainElement(screen.getByTestId('shell-brand'));
    const scroller = screen.getByTestId('navigation-scroll');
    expect(sidebar).toContainElement(scroller);
    expect(scroller).toContainElement(screen.getByRole('navigation'));
    expect(sidebar).not.toContainElement(screen.getByTestId('shell-footer'));
  });

  it('renders the temporary navigation when opened on mobile', () => {
    const onClose = vi.fn();
    render(
      <AppShell
        isDesktop={false}
        mobileNavigationOpen
        onMobileNavigationClose={onClose}
        mobileNavigationCloseLabel="Close navigation"
        header={<span>Mobile header</span>}
        navigation={<nav><a href="/panel/products">Products</a></nav>}
        brand={<span data-testid="shell-brand">Acme</span>}
      >
        <p>Panel content</p>
      </AppShell>,
    );

    expect(screen.getByRole('navigation')).toHaveTextContent('Products');
    expect(screen.getByTestId('shell-brand')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTestId('shell-brand').closest('header')).toBeNull();
    screen.getByRole('button', { name: 'Close navigation' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it('renders a resolved error inside the stable shell', () => {
    render(
      <AppShell
        isDesktop
        mobileNavigationOpen={false}
        onMobileNavigationClose={vi.fn()}
        mobileNavigationCloseLabel="Close navigation"
        header={<span>Acme header</span>}
        navigation={<nav><a href="/panel/products">Products</a></nav>}
        state={{ kind: 'error', message: 'Could not open workspace', retry: { label: 'Retry', onRetry: vi.fn() } }}
      >
        <p>Panel content</p>
      </AppShell>,
    );

    expect(screen.getByRole('banner')).toHaveTextContent('Acme header');
    expect(screen.getByRole('navigation')).toHaveTextContent('Products');
    expect(screen.getByRole('main')).toHaveTextContent('Could not open workspace');
    expect(screen.getByRole('main')).not.toHaveTextContent('Panel content');
  });
});
