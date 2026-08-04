import type { ReadResult, WriteResult } from './http.js';

export interface AuthSessionResult {
  token: string | null;
  twoFactorRedirect: boolean;
}

export interface TwoFactorEnrollment {
  totpURI: string;
  backupCodes: string[];
}

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
}

/** @public */
export interface PasswordResetRequest {
  email: string;
  redirectTo: string;
  language?: string;
}

/** @public */
export interface VerificationEmailRequest {
  email: string;
  callbackURL: string;
  language?: string;
}

/**
 * Client-side auth port. Web (and future mobile/Electron) programs against
 * this interface; the Better Auth client adapter implements it.
 * Session state itself is read through the API (`/api/me`), not through here.
 * Auth side effects are commands, so every method returns a write-tagged result.
 */
export interface AuthClientPort {
  signUp(input: {
    name: string;
    email: string;
    password: string;
    termsAccepted?: boolean;
    callbackURL?: string;
    language?: string;
  }): Promise<WriteResult<AuthSessionResult>>;
  signIn(input: { email: string; password: string }): Promise<WriteResult<AuthSessionResult>>;
  requestMagicLink(input: { email: string; callbackURL: string; language?: string }): Promise<WriteResult<void>>;
  sendVerificationEmail(input: VerificationEmailRequest): Promise<WriteResult<void>>;
  /** Send a password-reset email (used by members to set or reset their password). */
  requestPasswordReset(input: PasswordResetRequest): Promise<WriteResult<void>>;
  /** Consume a reset token and set a new password. */
  resetPassword(input: { token: string; newPassword: string }): Promise<WriteResult<AuthSessionResult>>;
  changePassword(input: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions: boolean;
  }): Promise<WriteResult<void>>;
  signOut(): Promise<WriteResult<void>>;
  registerPasskey(input: { name: string; password: string }): Promise<WriteResult<void>>;
  listPasskeys(): Promise<ReadResult<PasskeyInfo[]>>;
  removePasskey(input: { id: string; password: string }): Promise<WriteResult<void>>;
  signInWithPasskey(): Promise<WriteResult<AuthSessionResult>>;
  enableTwoFactor(password: string): Promise<WriteResult<TwoFactorEnrollment>>;
  verifyTotp(code: string): Promise<WriteResult<AuthSessionResult>>;
  verifyBackupCode(code: string): Promise<WriteResult<AuthSessionResult>>;
  disableTwoFactor(password: string): Promise<WriteResult<void>>;
  regenerateBackupCodes(password: string): Promise<WriteResult<string[]>>;
  signInWithGoogle(): Promise<WriteResult<void>>;
}
