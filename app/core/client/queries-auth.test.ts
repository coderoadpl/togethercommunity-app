import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/query-core';

import { ok } from '#core/domain/index.js';

import type { AuthClientPort } from './auth-port.js';
import { changePasswordMutation } from './queries.js';

describe('changePasswordMutation', () => {
  it('describes the auth mutation and forwards all password-change options', async () => {
    const changePassword = vi.fn().mockResolvedValue(ok(undefined));
    const auth: AuthClientPort = {
      signUp: vi.fn(),
      signIn: vi.fn(),
      requestMagicLink: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
      changePassword,
      signOut: vi.fn(),
      registerPasskey: vi.fn(),
      signInWithPasskey: vi.fn(),
      enableTwoFactor: vi.fn(),
      verifyTotp: vi.fn(),
      signInWithGoogle: vi.fn(),
    };
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
