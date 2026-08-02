import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/query-core';

import { ok } from '#core/domain/index.js';

import type { AuthClientPort } from './auth-port.js';
import { changePasswordMutation, requestPasswordResetMutation } from './queries.js';

const authWith = (overrides: Partial<AuthClientPort>): AuthClientPort => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  requestMagicLink: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
  signOut: vi.fn(),
  registerPasskey: vi.fn(),
  signInWithPasskey: vi.fn(),
  enableTwoFactor: vi.fn(),
  verifyTotp: vi.fn(),
  signInWithGoogle: vi.fn(),
  ...overrides,
});

describe('changePasswordMutation', () => {
  it('describes the auth mutation and forwards all password-change options', async () => {
    const changePassword = vi.fn().mockResolvedValue(ok(undefined));
    const auth = authWith({ changePassword });
    const mutation = changePasswordMutation(auth);
    const input = {
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    };

    expect(mutation.mutationKey).toEqual(['auth', 'change-password']);
    await expect(mutation.mutationFn(input, {
      client: new QueryClient(),
      meta: undefined,
      mutationKey: mutation.mutationKey,
    })).resolves.toBeUndefined();
    expect(changePassword).toHaveBeenCalledExactlyOnceWith(input);
  });
});

describe('requestPasswordResetMutation', () => {
  it('forwards the absolute provider callback unchanged', async () => {
    const requestPasswordReset = vi.fn().mockResolvedValue(ok(undefined));
    const mutation = requestPasswordResetMutation(authWith({ requestPasswordReset }));
    const input = {
      email: 'member@example.com',
      redirectTo: 'https://studio.example/reset-password',
      language: 'pl',
    };

    await expect(mutation.mutationFn(input, {
      client: new QueryClient(),
      meta: undefined,
      mutationKey: mutation.mutationKey,
    })).resolves.toBeUndefined();
    expect(mutation.mutationKey).toEqual(['auth', 'request-password-reset']);
    expect(requestPasswordReset).toHaveBeenCalledExactlyOnceWith(input);
  });
});
