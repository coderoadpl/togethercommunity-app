import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';
import { z } from 'zod';

import type {
  AuthClientPort,
  AuthSessionResult,
  PasskeyInfo,
  TwoFactorEnrollment,
} from '#core/client/index.js';
import {
  appError,
  err,
  MAGIC_LINK_LANGUAGE_HEADER,
  ok,
  validation,
  type AppError,
  type Result,
} from '#core/domain/index.js';

/** CLI-only extension of the client auth port: it can verify a magic-link token headlessly. */
export interface CliAuthAdapter extends AuthClientPort {
  verifyMagicLinkToken(token: string): Promise<Result<AuthSessionResult, AppError>>;
}

const twoFactorEnrollmentSchema = z.object({
  totpURI: z.string(),
  backupCodes: z.array(z.string()),
});

const backupCodesSchema = z.object({ backupCodes: z.array(z.string()) });

const authSessionSchema = z.object({
  token: z.string().nullable().optional(),
  twoFactorRedirect: z.boolean().optional(),
});

const readAuthSession = (data: unknown, token: string | null = null): AuthSessionResult => {
  const parsed = authSessionSchema.safeParse(data);
  return {
    token: token ?? (parsed.success ? (parsed.data.token ?? null) : null),
    twoFactorRedirect: parsed.success ? (parsed.data.twoFactorRedirect ?? false) : false,
  };
};

const readTwoFactorChallengeCookie = (response: Response): string | null =>
  response.headers.getSetCookie()
    .find((entry) => /^(?:__Secure-)?better-auth\.two_factor=/u.test(entry))
    ?.split(';')[0] ?? null;

type SignUpInput = Parameters<AuthClientPort['signUp']>[0];
type SignInInput = Parameters<AuthClientPort['signIn']>[0];
type MagicLinkInput = Parameters<AuthClientPort['requestMagicLink']>[0];
type ChangePasswordInput = Parameters<AuthClientPort['changePassword']>[0];
type AuthPath = '/api/auth/sign-up/email' | '/api/auth/sign-in/email';

interface CliEndpoint {
  baseUrl: URL;
  origin: string;
}

const authErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

const toResult = <T>(
  value: T,
  error: { code?: string | undefined; message?: string | undefined; status: number } | null,
  unauthorizedCode: 'unauthorized' | 'invalid_credentials' = 'unauthorized',
): Result<T, AppError> => {
  if (!error) return ok(value);
  const code =
    error.status === 401
      ? unauthorizedCode
      : error.status === 403
        ? 'forbidden'
        : error.status === 400 || error.status === 422
          ? 'validation'
          : error.status === 429
            ? 'rate_limited'
            : 'internal';
  return err(appError(
    code,
    error.message ?? 'Authentication failed',
    error.code === undefined ? undefined : { providerCode: error.code },
  ));
};

const readAuthError = async (
  response: Response,
): Promise<{ code?: string | undefined; message?: string | undefined; status: number }> => {
  try {
    const payload: unknown = await response.json();
    const parsed = authErrorSchema.safeParse(payload);
    return {
      status: response.status,
      code: parsed.success ? parsed.data.code : undefined,
      message: parsed.success ? (parsed.data.message ?? parsed.data.code) : response.statusText,
    };
  } catch {
    return { status: response.status, message: response.statusText };
  }
};

const postCliAuth = async (
  endpoint: CliEndpoint,
  path: AuthPath,
  body: SignUpInput | SignInInput,
  onToken: (token: string) => void,
  onChallengeCookie: (cookie: string | null) => void,
  language?: string,
): Promise<Result<AuthSessionResult, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL(path, endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: endpoint.origin,
        ...(language ? { [MAGIC_LINK_LANGUAGE_HEADER]: language } : {}),
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error calling ${path}: ${String(cause)}`));
  }

  if (!response.ok) {
    const unauthorizedCode = path === '/api/auth/sign-in/email' ? 'invalid_credentials' : 'unauthorized';
    return toResult(readAuthSession(null), await readAuthError(response), unauthorizedCode);
  }

  const token = response.headers.get('set-auth-token');
  const challengeCookie = readTwoFactorChallengeCookie(response);
  onChallengeCookie(challengeCookie);
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const session = readAuthSession(data, token);
  if (session.twoFactorRedirect) {
    return ok({ token: null, twoFactorRedirect: true });
  }
  if (token) onToken(token);
  return ok(session);
};

const postBrowserSignUp = async (
  baseUrl: string,
  input: SignUpInput,
): Promise<Result<AuthSessionResult, AppError>> => {
  const { language, ...body } = input;
  let response: Response;
  try {
    response = await fetch(baseUrl === '' ? '/api/auth/sign-up/email' : new URL('/api/auth/sign-up/email', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(language ? { [MAGIC_LINK_LANGUAGE_HEADER]: language } : {}),
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error calling /api/auth/sign-up/email: ${String(cause)}`));
  }
  if (!response.ok) return toResult(readAuthSession(null), await readAuthError(response));
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return ok(readAuthSession(data, response.headers.get('set-auth-token')));
};

/** Better Auth implementation of the client-side auth port. */
export const createBetterAuthClientAdapter = (baseUrl: string): AuthClientPort => {
  const client = createAuthClient({
    baseURL: baseUrl === '' ? undefined : baseUrl,
    plugins: [magicLinkClient(), passkeyClient(), twoFactorClient()],
  });

  const verifyPasskeyPassword = async (password: string) => {
    const response = await client.$fetch('/verify-password', {
      method: 'POST',
      body: { password },
    });
    return toResult(undefined, response.error);
  };

  return {
    signUp: (input) => postBrowserSignUp(baseUrl, input),
    signIn: async ({ email, password }) => {
      const response = await client.signIn.email({ email, password });
      return toResult(readAuthSession(response.data), response.error, 'invalid_credentials');
    },
    requestMagicLink: async ({ email, callbackURL, language }) =>
      toResult(
        undefined,
        (
          await client.signIn.magicLink(
            {
              email,
              callbackURL,
              errorCallbackURL: new URL('/login?error=INVALID_TOKEN', callbackURL).toString(),
            },
            language ? { headers: { [MAGIC_LINK_LANGUAGE_HEADER]: language } } : {},
          )
        ).error,
      ),
    sendVerificationEmail: async ({ email, callbackURL, language }) =>
      toResult(
        undefined,
        (
          await client.sendVerificationEmail(
            { email, callbackURL },
            language ? { headers: { [MAGIC_LINK_LANGUAGE_HEADER]: language } } : {},
          )
        ).error,
      ),
    requestPasswordReset: async ({ email, redirectTo, language }) =>
      toResult(
        undefined,
        (
          await client.requestPasswordReset(
            { email, redirectTo },
            language ? { headers: { [MAGIC_LINK_LANGUAGE_HEADER]: language } } : {},
          )
        ).error,
      ),
    resetPassword: async ({ token, newPassword }) =>
      toResult(readAuthSession(null), (await client.resetPassword({ newPassword, token })).error),
    changePassword: async (input) =>
      toResult(undefined, (await client.changePassword(input)).error),
    signOut: async () => toResult(undefined, (await client.signOut()).error),
    registerPasskey: async ({ name, password }) => {
      const verified = await verifyPasskeyPassword(password);
      if (!verified.ok) return verified;
      return toResult(undefined, (await client.passkey.addPasskey({ name })).error);
    },
    listPasskeys: async () => {
      const response = await client.passkey.listUserPasskeys();
      if (response.error) return toResult<PasskeyInfo[]>([], response.error);
      return ok((response.data ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? '',
        createdAt: new Date(row.createdAt).toISOString(),
      })));
    },
    removePasskey: async ({ id, password }) => {
      const verified = await verifyPasskeyPassword(password);
      if (!verified.ok) return verified;
      return toResult(undefined, (await client.passkey.deletePasskey({ id })).error);
    },
    signInWithPasskey: async () => {
      const response = await client.signIn.passkey();
      return toResult(readAuthSession(response.data), response.error);
    },
    enableTwoFactor: async (password) => {
      const response = await client.twoFactor.enable({ password });
      if (response.error) return toResult<TwoFactorEnrollment>({ totpURI: '', backupCodes: [] }, response.error);
      const parsed = twoFactorEnrollmentSchema.safeParse(response.data);
      if (!parsed.success) return err(appError('internal', 'Two-factor enrollment response did not match the contract'));
      return ok(parsed.data);
    },
    verifyTotp: async (code) => {
      const response = await client.twoFactor.verifyTotp({ code });
      return toResult(readAuthSession(response.data), response.error);
    },
    verifyBackupCode: async (code) => {
      const response = await client.twoFactor.verifyBackupCode({ code });
      return toResult(readAuthSession(response.data), response.error);
    },
    disableTwoFactor: async (password) =>
      toResult(undefined, (await client.twoFactor.disable({ password })).error),
    regenerateBackupCodes: async (password) => {
      const response = await client.twoFactor.generateBackupCodes({ password });
      if (response.error) return toResult<string[]>([], response.error);
      const parsed = backupCodesSchema.safeParse(response.data);
      if (!parsed.success) return err(appError('internal', 'Backup-code response did not match the contract'));
      return ok(parsed.data.backupCodes);
    },
    signInWithGoogle: async () =>
      toResult(undefined, (await client.signIn.social({ provider: 'google' })).error),
  };
};

const postCliMagicLink = async (
  endpoint: CliEndpoint,
  input: MagicLinkInput,
): Promise<Result<void, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/sign-in/magic-link', endpoint.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: endpoint.origin },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    return err(appError('internal', `Network error requesting magic link: ${String(cause)}`));
  }
  if (!response.ok) return toResult(undefined, await readAuthError(response));
  return ok(undefined);
};

const verifyMagicLinkToken = async (
  endpoint: CliEndpoint,
  token: string,
  onToken: (token: string) => void,
  onChallengeCookie: (cookie: string | null) => void,
): Promise<Result<AuthSessionResult, AppError>> => {
  const url = new URL('/api/auth/magic-link/verify', endpoint.baseUrl);
  url.searchParams.set('token', token);
  let response: Response;
  try {
    response = await fetch(url, { headers: { origin: endpoint.origin }, redirect: 'manual' });
  } catch (cause) {
    return err(appError('internal', `Network error verifying magic link: ${String(cause)}`));
  }
  if (response.status >= 400) return toResult(readAuthSession(null), await readAuthError(response));

  const sessionToken = response.headers.get('set-auth-token');
  const challengeCookie = readTwoFactorChallengeCookie(response);
  onChallengeCookie(challengeCookie);
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const session = readAuthSession(data, sessionToken);
  if (session.twoFactorRedirect || challengeCookie !== null) {
    return ok({ token: null, twoFactorRedirect: true });
  }
  if (sessionToken) onToken(sessionToken);
  return ok(session);
};

const postCliPasswordReset = async (
  endpoint: CliEndpoint,
  input: Parameters<AuthClientPort['requestPasswordReset']>[0],
): Promise<Result<void, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/request-password-reset', endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: endpoint.origin,
        ...(input.language ? { [MAGIC_LINK_LANGUAGE_HEADER]: input.language } : {}),
      },
      body: JSON.stringify({ email: input.email, redirectTo: input.redirectTo }),
    });
  } catch (cause) {
    return err(appError('internal', `Network error requesting password reset: ${String(cause)}`));
  }
  if (!response.ok) return toResult(undefined, await readAuthError(response));
  return ok(undefined);
};

const postCliVerificationEmail = async (
  endpoint: CliEndpoint,
  input: Parameters<AuthClientPort['sendVerificationEmail']>[0],
): Promise<Result<void, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/send-verification-email', endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: endpoint.origin,
        ...(input.language ? { [MAGIC_LINK_LANGUAGE_HEADER]: input.language } : {}),
      },
      body: JSON.stringify({ email: input.email, callbackURL: input.callbackURL }),
    });
  } catch (cause) {
    return err(appError('internal', `Network error requesting email verification: ${String(cause)}`));
  }
  if (!response.ok) return toResult(undefined, await readAuthError(response));
  return ok(undefined);
};

const postCliResetPassword = async (
  endpoint: CliEndpoint,
  input: { token: string; newPassword: string },
): Promise<Result<AuthSessionResult, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/reset-password', endpoint.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: endpoint.origin },
      body: JSON.stringify({ token: input.token, newPassword: input.newPassword }),
    });
  } catch (cause) {
    return err(appError('internal', `Network error resetting password: ${String(cause)}`));
  }
  if (!response.ok) return toResult(readAuthSession(null), await readAuthError(response));
  return ok(readAuthSession(null));
};

const verifySecondFactorCli = async (
  endpoint: CliEndpoint,
  path: '/api/auth/two-factor/verify-totp' | '/api/auth/two-factor/verify-backup-code',
  code: string,
  challengeCookie: string | null,
  onToken: (token: string) => void,
): Promise<Result<AuthSessionResult, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL(path, endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: endpoint.origin,
        ...(challengeCookie === null ? {} : { cookie: challengeCookie }),
      },
      body: JSON.stringify({ code }),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error verifying two-factor code: ${String(cause)}`));
  }
  if (!response.ok) return toResult(readAuthSession(null), await readAuthError(response));
  const token = response.headers.get('set-auth-token');
  if (token) onToken(token);
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return ok(readAuthSession(data, token));
};

const postCliSignOut = async (
  endpoint: CliEndpoint,
  token: string,
): Promise<Result<void, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/sign-out', endpoint.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: endpoint.origin,
      },
      body: '{}',
    });
  } catch (cause) {
    return err(appError('internal', `Network error calling /api/auth/sign-out: ${String(cause)}`));
  }
  if (!response.ok) return toResult(undefined, await readAuthError(response));
  return ok(undefined);
};

const postCliChangePassword = async (
  endpoint: CliEndpoint,
  input: ChangePasswordInput,
  currentToken: string | null,
  onToken: (token: string) => void,
): Promise<Result<void, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/change-password', endpoint.baseUrl), {
      method: 'POST',
      headers: {
        ...(currentToken === null ? {} : { authorization: `Bearer ${currentToken}` }),
        'content-type': 'application/json',
        origin: endpoint.origin,
      },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    return err(appError('internal', `Network error changing password: ${String(cause)}`));
  }
  if (!response.ok) return toResult(undefined, await readAuthError(response));
  const replacementToken = response.headers.get('set-auth-token');
  if (replacementToken) onToken(replacementToken);
  return ok(undefined);
};

const notSupportedInCli = validation('This authentication method is not supported in the CLI');

export const createCliAuthAdapter = (
  baseUrl: string,
  onToken: (token: string) => void,
  token: () => string | null = () => null,
): CliAuthAdapter => {
  const normalizedBaseUrl = new URL(baseUrl);
  const endpoint = { baseUrl: normalizedBaseUrl, origin: normalizedBaseUrl.origin };
  let challengeCookie: string | null = null;
  return {
    signUp: (input) => {
      const { language, ...body } = input;
      return postCliAuth(
        endpoint,
        '/api/auth/sign-up/email',
        body,
        onToken,
        (cookie) => { challengeCookie = cookie; },
        language,
      );
    },
    signIn: (input) => postCliAuth(
      endpoint,
      '/api/auth/sign-in/email',
      input,
      onToken,
      (cookie) => { challengeCookie = cookie; },
    ),
    requestMagicLink: (input) => postCliMagicLink(endpoint, input),
    sendVerificationEmail: (input) => postCliVerificationEmail(endpoint, input),
    requestPasswordReset: (input) => postCliPasswordReset(endpoint, input),
    resetPassword: (input) => postCliResetPassword(endpoint, input),
    changePassword: (input) => postCliChangePassword(endpoint, input, token(), onToken),
    signOut: async () => {
      const currentToken = token();
      return currentToken === null ? ok(undefined) : postCliSignOut(endpoint, currentToken);
    },
    registerPasskey: async () => err(notSupportedInCli),
    listPasskeys: async () => err(notSupportedInCli),
    removePasskey: async () => err(notSupportedInCli),
    signInWithPasskey: async () => err(notSupportedInCli),
    enableTwoFactor: async () => err(notSupportedInCli),
    verifyTotp: (code) => verifySecondFactorCli(
      endpoint,
      '/api/auth/two-factor/verify-totp',
      code,
      challengeCookie,
      onToken,
    ),
    verifyBackupCode: (code) => verifySecondFactorCli(
      endpoint,
      '/api/auth/two-factor/verify-backup-code',
      code,
      challengeCookie,
      onToken,
    ),
    disableTwoFactor: async () => err(notSupportedInCli),
    regenerateBackupCodes: async () => err(notSupportedInCli),
    signInWithGoogle: async () => err(notSupportedInCli),
    verifyMagicLinkToken: (token) => verifyMagicLinkToken(
      endpoint,
      token,
      onToken,
      (cookie) => { challengeCookie = cookie; },
    ),
  };
};
