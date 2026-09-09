import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MemberAccountMenu } from './MemberAccountMenu.js';
import { MemberMenuSheet } from './shell/MemberMenuSheet.js';

const me = (impersonation: unknown, staffRole: 'owner' | 'admin' | null = null) =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'jan@example.com',
        emailVerified: true,
        name: 'John Member',
        tenant: {
          id: 't1',
          slug: 'acme',
          name: 'Acme',
          staffRole,
          memberId: 'm1',
          displayName: 'Jan',
          banned: false,
        },
        impersonation,
      },
    }),
  );

const activeImpersonation = {
  id: 'imp-1',
  subjectMemberId: 'm1',
  subjectName: 'John Member',
  actorName: 'Alice Creator',
  expiresAt: '2026-09-03T11:00:00.000Z',
};

const renderMenu = async (surface: 'menu' | 'sheet' = 'menu') => {
  const rootRoute = createRootRoute({
    component: () => surface === 'menu'
      ? <MemberAccountMenu panelUrl="/panel/members" />
      : <MemberMenuSheet open onClose={() => undefined} name="John Member" email="jan@example.com" avatarUrl={null} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my'] }),
  });
  await router.load();
  renderWithProviders(<LanguageProvider><ThemeModeProvider><RouterProvider router={router} /></ThemeModeProvider></LanguageProvider>);
  if (surface === 'menu') await userEvent.click(await screen.findByTestId('member-account-menu'));
};

describe('MemberAccountMenu', () => {
  it('shows Studio above account settings for staff', async () => {
    server.use(me(null, 'admin'));

    await renderMenu();

    const studio = await screen.findByTestId('member-account-studio-link');
    const account = screen.getByTestId('member-account-link');
    expect(studio).toHaveAttribute('href', '/panel');
    expect(studio).toHaveTextContent('Studio');
    expect(studio.compareDocumentPosition(account)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('hides Studio from member-only accounts', async () => {
    server.use(me(null));

    await renderMenu();

    expect(screen.queryByTestId('member-account-studio-link')).not.toBeInTheDocument();
    expect(await screen.findByTestId('member-account-link')).toBeInTheDocument();
  });

  it('signs the member out of their own session', async () => {
    const authCalls: string[] = [];
    server.use(
      me(null),
      http.post('*', ({ request }) => {
        authCalls.push(new URL(request.url).pathname);
        return HttpResponse.json({ success: true });
      }),
    );
    window.sessionStorage.setItem('together-login-identifier', 'jan@example.com');
    await renderMenu();

    expect(await screen.findByTestId('member-sign-out')).toHaveTextContent(en.tenant.signOut);
    await userEvent.click(screen.getByTestId('member-sign-out'));

    await waitFor(() => {
      expect(window.sessionStorage.getItem('together-login-identifier')).toBeNull();
    });
    expect(authCalls).toHaveLength(1);
  });

  it.each([
    { surface: 'menu', language: 'en', t: en },
    { surface: 'sheet', language: 'en', t: en },
    { surface: 'menu', language: 'pl', t: pl },
    { surface: 'sheet', language: 'pl', t: pl },
  ] as const)('marks waiting direct messages in the $surface in $language', async ({ surface, language, t }) => {
    window.localStorage.setItem('together-language', language);
    server.use(
      me(null),
      http.get('*/api/member/navigation', () =>
        HttpResponse.json({
          ok: true,
          data: {
            navigation: {
              spaces: [],
              courses: [],
              lockedSpaces: [],
              directMessagesEnabled: true,
            },
          },
        }),
      ),
      http.get('*/api/messages/unread-count', () =>
        HttpResponse.json({ ok: true, data: { unread: 3 } }),
      ),
    );

    await renderMenu(surface);

    expect(await screen.findByTestId('member-account-messages-unread')).toHaveTextContent('3');
    if (surface === 'menu') {
      expect(screen.getByTestId('member-account-unread')).toBeInTheDocument();
      expect(screen.getByTestId('member-account-menu')).toHaveAccessibleName(
        t.panel.accountMenuUnread({ count: 3 }),
      );
    } else {
      expect(within(screen.getByTestId('member-menu-sheet')).getByTestId('member-account-messages'))
        .toHaveAttribute('href', '/messages');
    }
    expect(screen.getByTestId('member-account-messages')).toHaveTextContent(
      t.messages.unreadAria({ count: 3 }),
    );
  });

  it('shows the same avatar on the trigger and in the menu header, above name and e-mail', async () => {
    server.use(me(null));

    await renderMenu();

    const trigger = await screen.findByTestId('member-account-menu');
    expect(within(trigger).getByTestId('user-avatar')).toHaveTextContent('J');
    expect(await screen.findByTestId('member-account-name')).toHaveTextContent('Jan');
    expect(screen.getByTestId('member-account-email')).toHaveTextContent('jan@example.com');
    expect(screen.getAllByTestId('user-avatar')).toHaveLength(2);
  });

  it('ends the view instead of the operator session while viewing as a member', async () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign });
    const otherCalls: string[] = [];
    let stopped = false;
    server.use(
      me(activeImpersonation),
      http.post('*/api/impersonation/stop', () => {
        stopped = true;
        return HttpResponse.json({ ok: true, data: { ended: true } });
      }),
      http.post('*', ({ request }) => {
        otherCalls.push(new URL(request.url).pathname);
        return HttpResponse.json({ success: true });
      }),
    );
    await renderMenu();

    const control = await screen.findByTestId('member-sign-out');
    await waitFor(() => expect(control).toHaveTextContent(en.shell.impersonationExit));
    await userEvent.click(control);

    await waitFor(() => {
      expect(stopped).toBe(true);
      expect(assign).toHaveBeenCalledWith('/panel/members');
    });
    expect(otherCalls).toEqual([]);
  });
});
