import type { WriteResult } from './http.js';

export interface AuthSessionResult {
  token: string | null;
}

export interface TwoFactorEnrollment {
  totpURI: string;
  backupCodes: string[];
}

/**
 * Client-side auth port. Web (and future mobile/Electron) programs against
 * this interface; the Better Auth client adapter implements it.
 * Session state itself is read through the API (`/api/me`), not through here.
 * Auth side effects are commands, so every method returns a write-tagged result.
 */
export interface AuthClientPort {
  signUp(input: { name: string; email: string; password: string }): Promise<WriteResult<AuthSessionResult>>;
  signIn(input: { email: string; password: string }): Promise<WriteResult<AuthSessionResult>>;
  requestMagicLink(input: { email: string; callbackURL: string; language?: string }): Promise<WriteResult<void>>;
  /** Send a password-reset email (used by members to set or reset their password). */
  requestPasswordReset(input: { email: string; language?: string }): Promise<WriteResult<void>>;
  /** Consume a reset token and set a new password. */
  resetPassword(input: { token: string; newPassword: string }): Promise<WriteResult<AuthSessionResult>>;
  signOut(): Promise<WriteResult<void>>;
  registerPasskey(name: string): Promise<WriteResult<void>>;
  signInWithPasskey(): Promise<WriteResult<AuthSessionResult>>;
  enableTwoFactor(password: string): Promise<WriteResult<TwoFactorEnrollment>>;
  verifyTotp(code: string): Promise<WriteResult<AuthSessionResult>>;
  signInWithGoogle(): Promise<WriteResult<void>>;
}
