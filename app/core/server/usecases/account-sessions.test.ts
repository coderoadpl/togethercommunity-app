import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import type { AccountSession, AuthPort } from '../ports.js';
import {
  listMyAccountSessions,
  revokeMyAccountSession,
  revokeMyOtherAccountSessions,
} from './account-sessions.js';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: 'user-1',
  email: 'member@acme.test',
  name: 'Member',
  emailVerified: true,
  image: null,
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'member-1',
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  ...overrides,
});

const session = (id: string, createdAt: string, userAgent: string | null = null): AccountSession => ({
  id,
  createdAt,
  lastActiveAt: createdAt,
  userAgent,
});

const authPortWith = (sessions: AccountSession[]) => {
  const revokeSessions = vi.fn(async () => undefined);
  const listSessions = vi.fn(async () => sessions);
  const auth: AuthPort = {
    listSessions,
    revokeSessions,
    getAuthenticatedUser: async () => null,
    ensureUser: async () => ({ userId: 'user-1', created: false }),
    requestMagicLink: async () => undefined,
    createEnrollmentMagicLink: async () => ({ url: 'https://example.test/magic' }),
  };
  return { auth, listSessions, revokeSessions };
};

describe('account sessions', () => {
  it('lists the account sessions newest first and badges the current one', async () => {
    const { auth, listSessions } = authPortWith([
      session('s-old', '2026-08-01T10:00:00.000Z', 'Mozilla/5.0 (Macintosh) Chrome/140'),
      session('s-current', '2026-08-20T10:00:00.000Z'),
    ]);

    const result = await listMyAccountSessions(
      { identity: identity() },
      { currentSessionId: 's-current' },
      { auth },
    );

    expect(listSessions).toHaveBeenCalledExactlyOnceWith('user-1');
    expect(result.ok && result.value.sessions.map((row) => [row.id, row.current])).toEqual([
      ['s-current', true],
      ['s-old', false],
    ]);
  });

  it('refuses to list sessions without a tenant context', async () => {
    const { auth, listSessions } = authPortWith([]);

    const result = await listMyAccountSessions(
      { identity: identity({ tenantId: null, memberId: null }) },
      { currentSessionId: 's-current' },
      { auth },
    );

    expect(result.ok).toBe(false);
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('refuses to list sessions for a principal without the capability', async () => {
    const { auth, listSessions } = authPortWith([]);

    const result = await listMyAccountSessions(
      { identity: identity({ memberId: null }) },
      { currentSessionId: 's-current' },
      { auth },
    );

    expect(result.ok).toBe(false);
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('revokes one of the caller own sessions', async () => {
    const { auth, revokeSessions } = authPortWith([
      session('s-current', '2026-08-20T10:00:00.000Z'),
      session('s-other', '2026-08-01T10:00:00.000Z'),
    ]);

    const result = await revokeMyAccountSession(
      { identity: identity() },
      { sessionId: 's-other', currentSessionId: 's-current' },
      { auth },
    );

    expect(result).toEqual({ ok: true, value: { revoked: 1 } });
    expect(revokeSessions).toHaveBeenCalledExactlyOnceWith('user-1', ['s-other']);
  });

  it('rejects a session id that belongs to another account', async () => {
    const { auth, revokeSessions } = authPortWith([session('s-current', '2026-08-20T10:00:00.000Z')]);

    const result = await revokeMyAccountSession(
      { identity: identity() },
      { sessionId: 's-someone-else', currentSessionId: 's-current' },
      { auth },
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('not_found');
    expect(revokeSessions).not.toHaveBeenCalled();
  });

  it('rejects revoking the session making the request', async () => {
    const { auth, revokeSessions } = authPortWith([session('s-current', '2026-08-20T10:00:00.000Z')]);

    const result = await revokeMyAccountSession(
      { identity: identity() },
      { sessionId: 's-current', currentSessionId: 's-current' },
      { auth },
    );

    expect(!result.ok && result.error.code).toBe('validation');
    expect(revokeSessions).not.toHaveBeenCalled();
  });

  it('revokes every session except the one making the request', async () => {
    const { auth, revokeSessions } = authPortWith([
      session('s-current', '2026-08-20T10:00:00.000Z'),
      session('s-a', '2026-08-01T10:00:00.000Z'),
      session('s-b', '2026-07-01T10:00:00.000Z'),
    ]);

    const result = await revokeMyOtherAccountSessions(
      { identity: identity({ staffRole: 'owner', memberId: null }) },
      { currentSessionId: 's-current' },
      { auth },
    );

    expect(result).toEqual({ ok: true, value: { revoked: 2 } });
    expect(revokeSessions).toHaveBeenCalledExactlyOnceWith('user-1', ['s-a', 's-b']);
  });

  it('does not call the provider when the only session is the current one', async () => {
    const { auth, revokeSessions } = authPortWith([session('s-current', '2026-08-20T10:00:00.000Z')]);

    const result = await revokeMyOtherAccountSessions(
      { identity: identity() },
      { currentSessionId: 's-current' },
      { auth },
    );

    expect(result).toEqual({ ok: true, value: { revoked: 0 } });
    expect(revokeSessions).not.toHaveBeenCalled();
  });
});
