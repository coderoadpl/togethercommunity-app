import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MemberAccountMenu } from './MemberAccountMenu.js';

const me = (impersonation: unknown, staffRole: 'owner' | 'admin' | null = null) =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'jan@example.com',
        emailVerified: true,
        name: 'Jan Uczestnik',
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
  subjectName: 'Jan Uczestnik',
  actorName: 'Ala Twórczyni',
  expiresAt: '2026-09-03T11:00:00.000Z',
};

const renderMenu = async () => {
  const rootRoute = createRootRoute({ component: () => <MemberAccountMenu panelUrl="/panel/members" /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my'] }),
  });
  await router.load();
  renderWithProviders(<RouterProvider router={router} />);
  await userEvent.click(await screen.findByTestId('member-account-menu'));
};

describe('MemberAccountMenu', () => {
  it('shows Studio above account settings for staff', async () => {
    server.use(me(null, 'admin'));

    await renderMenu();

    const studio = await screen.findByTestId('member-account-studio-link');
    const account = screen.getByTestId('member-account-link');
    expect(studio).toHaveAttribute('href', '/panel');
    expect(studio).toHaveTextContent(pl.account.menuStudio);
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

    expect(await screen.findByTestId('member-sign-out')).toHaveTextContent(pl.tenant.signOut);
    await userEvent.click(screen.getByTestId('member-sign-out'));

    await waitFor(() => {
      expect(window.sessionStorage.getItem('together-login-identifier')).toBeNull();
    });
    expect(authCalls).toHaveLength(1);
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
    await waitFor(() => expect(control).toHaveTextContent(pl.shell.impersonationExit));
    await userEvent.click(control);

    await waitFor(() => {
      expect(stopped).toBe(true);
      expect(assign).toHaveBeenCalledWith('/panel/members');
    });
    expect(otherCalls).toEqual([]);
  });
});
