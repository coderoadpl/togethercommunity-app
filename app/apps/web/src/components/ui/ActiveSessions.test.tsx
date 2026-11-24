import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { en } from '../../i18n/en.js';
import { ActiveSessions, type ActiveSessionsProps } from './ActiveSessions.js';
import { ToastProvider } from './Toast.js';

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

const tree = (props: ActiveSessionsProps) => (
  <LanguageProvider>
    <ToastProvider>
      <ActiveSessions {...props} />
    </ToastProvider>
  </LanguageProvider>
);

const renderSessions = (props: ActiveSessionsProps) => render(tree(props));

describe('ActiveSessions', () => {
  it('keeps the studio panel session list expanded without nested cards', () => {
    const view = renderSessions(propsWith({ presentation: 'embedded' }));
    expect(screen.getByTestId('session-session-phone')).toBeVisible();
    expect(screen.queryByTestId('active-sessions-disclosure')).not.toBeInTheDocument();
    expect(view.container.querySelector('.MuiPaper-root')).toBeNull();
  });

  it('starts collapsed with only the current session, opens with the keyboard, and resets on a fresh mount', async () => {
    const currentOnly = propsWith({ sessions: { data: [currentRow], pending: false, error: null, retry: vi.fn() } });
    const first = renderSessions(currentOnly);
    const summary = screen.getByTestId('active-sessions-disclosure');
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(summary).toHaveTextContent(en.security.sessionsHeading);
    expect(screen.getByLabelText(en.security.sessionsSummary({ count: 1 }))).toHaveTextContent('1');
    summary.focus();
    await userEvent.keyboard('{Enter}');
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    first.unmount();
    renderSessions(currentOnly);
    expect(screen.getByTestId('active-sessions-disclosure')).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts expanded when other sessions exist and collapses on request', async () => {
    const view = renderSessions(propsWith({ sessions: { data: undefined, pending: true, error: null, retry: vi.fn() } }));
    expect(screen.getByTestId('active-sessions-disclosure')).toHaveAttribute('aria-expanded', 'false');
    view.rerender(tree(propsWith()));
    const summary = screen.getByTestId('active-sessions-disclosure');
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('session-session-phone')).toBeVisible();
    await userEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks only the row being signed out and reports success as a toast without a lasting caption', async () => {
    const extra = { id: 'session-tablet', createdAt: '2026-08-03T10:00:00.000Z', lastActiveAt: '2026-08-04T10:00:00.000Z', userAgent: null, current: false };
    const props = propsWith({ sessions: { data: [...rows, extra], pending: false, error: null, retry: vi.fn() } });
    const view = renderSessions(props);
    await userEvent.click(within(screen.getByTestId('session-session-phone')).getByRole('button', { name: en.security.sessionRevoke }));
    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-accept'));
    view.rerender(tree({ ...props, revokeSession: { ...props.revokeSession, pending: true } }));
    expect(within(screen.getByTestId('session-session-phone')).getByText(en.security.sessionRevoking)).toBeInTheDocument();
    expect(within(screen.getByTestId('session-session-tablet')).getByText(en.security.sessionRevoke)).toBeInTheDocument();
    expect(within(screen.getByTestId('session-session-tablet')).queryByText(en.security.sessionRevoking)).not.toBeInTheDocument();
    view.rerender(tree({ ...props, revokeSession: { ...props.revokeSession, success: true } }));
    expect(await screen.findByTestId(/^toast-success-/)).toHaveTextContent(en.security.sessionRevoked);
    expect(screen.queryByTestId('session-revoked')).not.toBeInTheDocument();
    view.rerender(tree({ ...props, sessions: { data: [currentRow], pending: false, error: null, retry: vi.fn() }, revokeSession: { ...props.revokeSession, success: true } }));
    expect(screen.getByTestId('active-sessions-disclosure')).toHaveAttribute('aria-expanded', 'true');
  });

  it('reports signing out every other session as a toast', async () => {
    const props = propsWith();
    const view = renderSessions(props);
    await userEvent.click(screen.getByTestId('revoke-other-sessions'));
    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-accept'));
    view.rerender(tree({ ...props, revokeOtherSessions: { ...props.revokeOtherSessions, pending: true } }));
    view.rerender(tree({ ...props, revokeOtherSessions: { ...props.revokeOtherSessions, success: true } }));
    expect(await screen.findByTestId(/^toast-success-/)).toHaveTextContent(en.security.sessionsOthersRevoked);
    expect(screen.queryByTestId('other-sessions-revoked')).not.toBeInTheDocument();
  });

  it('places the current session first and returns focus to the disclosure on revocation', async () => {
    const props = propsWith({ sessions: { data: [...rows].reverse(), pending: false, error: null, retry: vi.fn() } });
    const view = renderSessions(props);
    const rendered = screen.getAllByTestId(/^session-session-/);
    expect(rendered[0]).toHaveAttribute('data-testid', 'session-session-current');
    await userEvent.click(screen.getByRole('button', { name: en.security.sessionRevoke }));
    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-accept'));
    view.rerender(tree({ ...props, revokeSession: { ...props.revokeSession, pending: true } }));
    view.rerender(tree({ ...props, revokeSession: { ...props.revokeSession, success: true } }));
    await waitFor(() => expect(screen.getByTestId('active-sessions-disclosure')).toHaveFocus());
  });

  it('badges the current session and offers no sign-out for it', async () => {
    renderSessions(propsWith());

    expect(screen.getByText(en.security.sessionCurrent)).toBeInTheDocument();
    expect(screen.getAllByText(/Chrome · macOS/)).toHaveLength(2);
    expect(screen.getByText(en.security.sessionUnknownDevice)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: en.security.sessionRevoke })).toHaveLength(1);
  });

  it('revokes the chosen session once confirmed', async () => {
    const run = vi.fn();
    const props = propsWith({ revokeSession: { ...idle, run } });
    const view = renderSessions(props);

    expect(screen.getByTestId('active-sessions-disclosure')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: en.security.sessionRevoke }));

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(en.security.sessionRevokeConfirmTitle);
    expect(screen.getByRole('dialog')).toHaveTextContent(en.security.sessionRevokeConfirmBody);

    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-accept'));

    expect(run).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-phone' });
    expect(screen.getByRole('dialog')).toBeVisible();
    view.rerender(tree({ ...props, revokeSession: { ...props.revokeSession, pending: true } }));
    view.rerender(tree({ ...props, revokeSession: { ...props.revokeSession, error: new Error('Failed') } }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
    view.rerender(tree({ ...props, revokeSession: { ...props.revokeSession, pending: true } }));
    view.rerender(tree({ ...props, revokeSession: { ...props.revokeSession, success: true } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('revokes every other session once confirmed', async () => {
    const run = vi.fn();
    renderSessions(propsWith({ revokeOtherSessions: { ...idle, run } }));

    await userEvent.click(screen.getByTestId('revoke-other-sessions'));

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      en.security.sessionsRevokeOthersConfirmTitle,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      en.security.sessionsRevokeOthersConfirmBody,
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

    expect(screen.getByTestId('active-sessions-disclosure')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('revoke-other-sessions')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: en.security.sessionRevoke }));
    await userEvent.click(screen.getByTestId('revoke-sessions-confirm-cancel'));

    expect(revoke).not.toHaveBeenCalled();
  });

  it('hides the bulk action when the current session is the only one', async () => {
    renderSessions(propsWith({
      sessions: { data: [currentRow], pending: false, error: null, retry: vi.fn() },
    }));

    await userEvent.click(screen.getByTestId('active-sessions-disclosure'));
    expect(screen.queryByTestId('revoke-other-sessions')).not.toBeInTheDocument();
  });

  it('shows loading and failure instead of a zero count while collapsed', () => {
    const view = renderSessions(propsWith({ sessions: { data: undefined, pending: true, error: null, retry: vi.fn() } }));
    expect(screen.getByTestId('active-sessions-disclosure')).toHaveTextContent(en.security.sessionsLoading);
    view.unmount();
    renderSessions(propsWith({ sessions: { data: undefined, pending: false, error: new Error('failed'), retry: vi.fn() } }));
    expect(screen.getByTestId('active-sessions-disclosure')).toHaveTextContent(en.security.sessionsUnavailable);
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('offers a retry when the list fails to load', async () => {
    const retry = vi.fn();
    renderSessions(propsWith({
      sessions: { data: undefined, pending: false, error: new Error('boom'), retry },
    }));

    await userEvent.click(screen.getByRole('button', { name: en.common.retry }));

    expect(retry).toHaveBeenCalledOnce();
  });
});
