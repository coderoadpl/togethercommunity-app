import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { MemberBottomBar } from './MemberBottomBar.js';
import { memberHomePath } from './member-nav.js';

const unreadCount = (unread: number) =>
  http.get('/api/notifications/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread } }));

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
  it('offers start, notifications and menu as the only thumb-reach tabs', async () => {
    server.use(unreadCount(0));

    await renderBar('/my');

    const bar = screen.getByTestId('member-bottom-nav');
    expect(bar.tagName).toBe('NAV');
    expect(screen.getByTestId('member-tab-start')).toHaveAttribute('href', memberHomePath());
    expect(screen.getByTestId('notification-tab')).toHaveTextContent(pl.notifications.bell);
    expect(screen.getByTestId('member-tab-menu')).toHaveTextContent(pl.shell.menuTab);
    expect(bar.childElementCount).toBe(3);
  });

  it('marks start as the current page only on the member home path', async () => {
    server.use(unreadCount(0));

    await renderBar(memberHomePath());
    expect(screen.getByTestId('member-tab-start')).toHaveAttribute('aria-current', 'page');

    await renderBar('/community/s1');
    expect(screen.getAllByTestId('member-tab-start')[1]).not.toHaveAttribute('aria-current');
  });

  it('keeps clear of the home indicator with safe-area padding', async () => {
    server.use(unreadCount(0));

    await renderBar('/my');

    expect(window.getComputedStyle(screen.getByTestId('member-bottom-nav')).paddingBottom).toContain(
      'safe-area-inset-bottom',
    );
  });

  it('opens the menu sheet from the menu tab', async () => {
    server.use(unreadCount(0));
    const onOpenMenu = vi.fn();
    const user = userEvent.setup();

    await renderBar('/my', onOpenMenu);
    await user.click(screen.getByTestId('member-tab-menu'));

    expect(onOpenMenu).toHaveBeenCalledOnce();
  });

  it('carries the unread badge on the notifications tab', async () => {
    server.use(unreadCount(4));

    await renderBar('/my');

    await waitFor(() =>
      expect(screen.getByTestId('notification-tab-badge')).toHaveTextContent('4'));
  });
});
