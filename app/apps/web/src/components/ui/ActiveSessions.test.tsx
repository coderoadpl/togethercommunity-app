import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { ActiveSessions, type ActiveSessionsProps } from './ActiveSessions.js';

const idle = { pending: false, success: false, error: null };

const currentRow = {
  id: 'session-current',
  createdAt: '2026-08-20T10:00:00.000Z',
  lastActiveAt: '2026-08-28T09:00:00.000Z',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36',
  current: true,
};

const rows = [
  currentRow,
  {
    id: 'session-phone',
    createdAt: '2026-08-01T10:00:00.000Z',
    lastActiveAt: '2026-08-02T10:00:00.000Z',
    userAgent: null,
    current: false,
  },
];

const propsWith = (overrides: Partial<ActiveSessionsProps> = {}): ActiveSessionsProps => ({
  sessions: { data: rows, pending: false, error: null, retry: vi.fn() },
  revokeSession: { ...idle, run: vi.fn() },
  revokeOtherSessions: { ...idle, run: vi.fn() },
  ...overrides,
});

const renderSessions = (props: ActiveSessionsProps) => render(
  <LanguageProvider>
    <ActiveSessions {...props} />
  </LanguageProvider>,
);

describe('ActiveSessions', () => {
  it('badges the current session and offers no sign-out for it', () => {
    renderSessions(propsWith());

    expect(screen.getByText(pl.security.sessionCurrent)).toBeInTheDocument();
    expect(screen.getByText('Chrome · macOS')).toBeInTheDocument();
    expect(screen.getByText(pl.security.sessionUnknownDevice)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: pl.security.sessionRevoke })).toHaveLength(1);
  });

  it('revokes the chosen session once confirmed', async () => {
    const run = vi.fn();
    renderSessions(propsWith({ revokeSession: { ...idle, run } }));

    await userEvent.click(screen.getByRole('button', { name: pl.security.sessionRevoke }));

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(pl.security.sessionRevokeConfirmTitle);
    expect(screen.getByRole('dialog')).toHaveTextContent(pl.security.sessionRevokeConfirmBody);

    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-accept'));

    expect(run).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-phone' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('revokes every other session once confirmed', async () => {
    const run = vi.fn();
    renderSessions(propsWith({ revokeOtherSessions: { ...idle, run } }));

    await userEvent.click(screen.getByTestId('revoke-other-sessions'));

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      pl.security.sessionsRevokeOthersConfirmTitle,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      pl.security.sessionsRevokeOthersConfirmBody,
    );

    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-accept'));

    expect(run).toHaveBeenCalledOnce();
  });

  it('leaves every session alone when the confirmation is dismissed', async () => {
    const revoke = vi.fn();
    const revokeOthers = vi.fn();
    renderSessions(propsWith({
      revokeSession: { ...idle, run: revoke },
      revokeOtherSessions: { ...idle, run: revokeOthers },
    }));

    await userEvent.click(screen.getByTestId('revoke-other-sessions'));
    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-cancel'));

    expect(revokeOthers).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: pl.security.sessionRevoke }));
    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-cancel'));

    expect(revoke).not.toHaveBeenCalled();
  });

  it('hides the bulk action when the current session is the only one', () => {
    renderSessions(propsWith({
      sessions: { data: [currentRow], pending: false, error: null, retry: vi.fn() },
    }));

    expect(screen.queryByTestId('revoke-other-sessions')).not.toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', async () => {
    const retry = vi.fn();
    renderSessions(propsWith({
      sessions: { data: undefined, pending: false, error: new Error('boom'), retry },
    }));

    await userEvent.click(screen.getByRole('button', { name: pl.common.retry }));

    expect(retry).toHaveBeenCalledOnce();
  });
});
