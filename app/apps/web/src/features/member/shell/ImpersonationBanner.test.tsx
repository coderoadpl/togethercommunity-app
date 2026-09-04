import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { actions } from '../../../api.js';
import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ImpersonationBanner } from './ImpersonationBanner.js';

const MeSettled = () =>
  useQuery(actions.me).data === undefined ? null : <div data-testid="me-settled" />;

const me = (impersonation: unknown) =>
  http.get('/api/me', () =>
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
          staffRole: null,
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

describe('ImpersonationBanner', () => {
  it('stays out of the shell for an ordinary member session', async () => {
    server.use(me(null));
    renderWithProviders(
      <>
        <ImpersonationBanner />
        <MeSettled />
      </>,
    );

    await screen.findByTestId('me-settled');
    expect(screen.queryByTestId('impersonation-banner')).toBeNull();
    expect(screen.queryByTestId('impersonation-expired')).toBeNull();
  });

  it('names the banner region and moves the reader into it on arrival', async () => {
    server.use(me(activeImpersonation));
    renderWithProviders(<ImpersonationBanner />);

    const banner = await screen.findByTestId('impersonation-banner');
    expect(banner).toHaveAttribute('role', 'region');
    expect(banner).toHaveAttribute('aria-label', pl.shell.impersonationRegionLabel);
    await waitFor(() => {
      expect(banner).toHaveFocus();
    });
  });

  it('replaces the banner with an expiry notice when the view lapses', async () => {
    server.use(me(activeImpersonation));
    const { queryClient } = renderWithProviders(<ImpersonationBanner />);
    await screen.findByTestId('impersonation-banner');

    server.use(me(null));
    await queryClient.invalidateQueries(actions.meInvalidates());

    const expired = await screen.findByTestId('impersonation-expired');
    expect(expired.textContent).toContain(pl.shell.impersonationExpired);
  });

  it('drops the banner at the expiry moment without waiting for another refetch', async () => {
    server.use(me({ ...activeImpersonation, expiresAt: new Date(Date.now() + 50).toISOString() }));
    renderWithProviders(<ImpersonationBanner />);
    await screen.findByTestId('impersonation-banner');

    server.use(me(null));

    expect(await screen.findByTestId('impersonation-expired')).toBeInTheDocument();
  });

  it('names the impersonated member and marks the view read-only', async () => {
    server.use(me(activeImpersonation));
    renderWithProviders(<ImpersonationBanner />);

    const banner = await screen.findByTestId('impersonation-banner');
    expect(banner.textContent).toContain(
      pl.shell.impersonationBanner({ name: 'Jan Uczestnik' }),
    );
    expect(banner.textContent).toContain(pl.shell.impersonationReadOnlyHint);
  });

  it('ends the view and returns to the panel', async () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    });
    let stopped = false;
    server.use(
      me(activeImpersonation),
      http.post('/api/impersonation/stop', () => {
        stopped = true;
        return HttpResponse.json({ ok: true, data: { ended: true } });
      }),
    );
    renderWithProviders(<ImpersonationBanner panelUrl="/panel/members" />);

    await userEvent.click(await screen.findByTestId('impersonation-exit'));

    await waitFor(() => {
      expect(stopped).toBe(true);
      expect(assign).toHaveBeenCalledWith('/panel/members');
    });
  });
});
