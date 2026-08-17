import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { MemberBottomBar } from './MemberBottomBar.js';
import { memberHomePath, memberSearchPath } from './member-nav.js';

const renderBar = async (path: string, onOpenMenu: () => void = () => undefined) => {
  const rootRoute = createRootRoute({
    component: () => <MemberBottomBar menuOpen={false} onOpenMenu={onOpenMenu} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('MemberBottomBar', () => {
  it('offers start, search and menu as the only thumb-reach tabs', async () => {
    await renderBar('/my');

    const bar = screen.getByTestId('member-bottom-nav');
    expect(bar.tagName).toBe('NAV');
    expect(screen.getByTestId('member-tab-start')).toHaveAttribute('href', memberHomePath());
    const search = screen.getByTestId('member-tab-search');
    expect(search).toHaveAttribute('href', memberSearchPath());
    expect(search).toHaveTextContent(pl.shell.searchEntry);
    expect(screen.getByTestId('member-tab-menu')).toHaveTextContent(pl.shell.menuTab);
    expect(screen.queryByTestId('notification-tab')).not.toBeInTheDocument();
    expect(bar.childElementCount).toBe(3);
  });

  it('marks search as the current page on the search path', async () => {
    await renderBar(memberSearchPath());

    expect(screen.getByTestId('member-tab-search')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('member-tab-start')).not.toHaveAttribute('aria-current');
  });

  it('marks start as the current page only on the member home path', async () => {
    await renderBar(memberHomePath());
    expect(screen.getByTestId('member-tab-start')).toHaveAttribute('aria-current', 'page');

    await renderBar('/community/s1');
    expect(screen.getAllByTestId('member-tab-start')[1]).not.toHaveAttribute('aria-current');
  });

  it('keeps clear of the home indicator with safe-area padding', async () => {
    await renderBar('/my');

    expect(window.getComputedStyle(screen.getByTestId('member-bottom-nav')).paddingBottom).toContain(
      'safe-area-inset-bottom',
    );
  });

  it('opens the menu sheet from the menu tab', async () => {
    const onOpenMenu = vi.fn();
    const user = userEvent.setup();

    await renderBar('/my', onOpenMenu);
    await user.click(screen.getByTestId('member-tab-menu'));

    expect(onOpenMenu).toHaveBeenCalledOnce();
  });
});
