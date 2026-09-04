import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './AppShell.js';
import { useReserveBottomInset } from './bottom-inset.js';

const Dock = ({ height }: { height: string }) => {
  useReserveBottomInset(height);
  return <p>Docked</p>;
};

const shellWith = (children: ReactNode) => (
  <AppShell
    isDesktop
    mobileNavigationOpen={false}
    onMobileNavigationClose={vi.fn()}
    mobileNavigationCloseLabel="Close navigation"
    header={<span>Acme header</span>}
    navigation={<nav><a href="/panel/products">Products</a></nav>}
    footer={<span data-testid="shell-footer">v0.1.0</span>}
  >
    {children}
  </AppShell>
);

const footerPadding = () => getComputedStyle(screen.getByRole('contentinfo')).paddingBottom;

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

  it('keeps the footer clear of a bottom dock that reserves an inset', () => {
    const { rerender } = render(shellWith(<p>Panel content</p>));

    expect(footerPadding()).toBe('calc(0px + 0.8rem)');

    rerender(shellWith(<Dock height="44px" />));

    expect(screen.getByRole('main')).toHaveTextContent('Docked');
    expect(footerPadding()).toBe('calc(44px + 0.8rem)');

    rerender(shellWith(<p>Panel content</p>));

    expect(footerPadding()).toBe('calc(0px + 0.8rem)');
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
