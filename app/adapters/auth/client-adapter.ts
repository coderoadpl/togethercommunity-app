import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';
import { z } from 'zod';

import type { AuthClientPort, AuthSessionResult, TwoFactorEnrollment } from '#core/client/index.js';
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
): Promise<Result<{ token: string | null }, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL(path, endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: endpoint.origin,
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error calling ${path}: ${String(cause)}`));
  }

  if (!response.ok) {
    const unauthorizedCode = path === '/api/auth/sign-in/email' ? 'invalid_credentials' : 'unauthorized';
    return toResult({ token: null }, await readAuthError(response), unauthorizedCode);
  }

  const token = response.headers.get('set-auth-token');
  if (token) onToken(token);
  return ok({ token });
};

const postBrowserSignUp = async (
  baseUrl: string,
  body: SignUpInput,
): Promise<Result<AuthSessionResult, AppError>> => {
  let response: Response;
  try {
    response = await fetch(baseUrl === '' ? '/api/auth/sign-up/email' : new URL('/api/auth/sign-up/email', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error calling /api/auth/sign-up/email: ${String(cause)}`));
  }
  if (!response.ok) return toResult({ token: null }, await readAuthError(response));
  return ok({ token: response.headers.get('set-auth-token') });
};

/** Better Auth implementation of the client-side auth port. */
export const createBetterAuthClientAdapter = (baseUrl: string): AuthClientPort => {
  const client = createAuthClient({
    baseURL: baseUrl === '' ? undefined : baseUrl,
    plugins: [magicLinkClient(), passkeyClient(), twoFactorClient()],
  });

  return {
    signUp: (input) => postBrowserSignUp(baseUrl, input),
    signIn: async ({ email, password }) => {
      const token = null;
      const response = await client.signIn.email({ email, password });
      return toResult({ token }, response.error, 'invalid_credentials');
    },
    requestMagicLink: async ({ email, callbackURL, language }) =>
      toResult(
        undefined,
        (
          await client.signIn.magicLink(
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
      toResult({ token: null }, (await client.resetPassword({ newPassword, token })).error),
    changePassword: async (input) =>
      toResult(undefined, (await client.changePassword(input)).error),
    signOut: async () => toResult(undefined, (await client.signOut()).error),
    registerPasskey: async (name) =>
      toResult(undefined, (await client.passkey.addPasskey({ name })).error),
    signInWithPasskey: async () => toResult({ token: null }, (await client.signIn.passkey()).error),
    enableTwoFactor: async (password) => {
      const response = await client.twoFactor.enable({ password });
      if (response.error) return toResult<TwoFactorEnrollment>({ totpURI: '', backupCodes: [] }, response.error);
      const parsed = twoFactorEnrollmentSchema.safeParse(response.data);
      if (!parsed.success) return err(appError('internal', 'Two-factor enrollment response did not match the contract'));
      return ok(parsed.data);
    },
    verifyTotp: async (code) => toResult({ token: null }, (await client.twoFactor.verifyTotp({ code })).error),
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
): Promise<Result<AuthSessionResult, AppError>> => {
  const url = new URL('/api/auth/magic-link/verify', endpoint.baseUrl);
  url.searchParams.set('token', token);
  let response: Response;
  try {
    response = await fetch(url, { headers: { origin: endpoint.origin }, redirect: 'manual' });
  } catch (cause) {
    return err(appError('internal', `Network error verifying magic link: ${String(cause)}`));
  }
  if (!response.ok) return toResult({ token: null }, await readAuthError(response));

  const sessionToken = response.headers.get('set-auth-token');
  if (sessionToken) onToken(sessionToken);
  return ok({ token: sessionToken });
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
  if (!response.ok) return toResult({ token: null }, await readAuthError(response));
  return ok({ token: null });
};

const verifyTotpCli = async (
  endpoint: CliEndpoint,
  code: string,
  onToken: (token: string) => void,
): Promise<Result<AuthSessionResult, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/two-factor/verify-totp', endpoint.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: endpoint.origin },
      body: JSON.stringify({ code }),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error verifying TOTP code: ${String(cause)}`));
  }
  if (!response.ok) return toResult({ token: null }, await readAuthError(response));
  const token = response.headers.get('set-auth-token');
  if (token) onToken(token);
  return ok({ token });
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
  return {
    signUp: (input) => postCliAuth(endpoint, '/api/auth/sign-up/email', input, onToken),
    signIn: (input) => postCliAuth(endpoint, '/api/auth/sign-in/email', input, onToken),
    requestMagicLink: (input) => postCliMagicLink(endpoint, input),
    requestPasswordReset: (input) => postCliPasswordReset(endpoint, input),
    resetPassword: (input) => postCliResetPassword(endpoint, input),
    changePassword: (input) => postCliChangePassword(endpoint, input, token(), onToken),
    signOut: async () => {
      const currentToken = token();
      return currentToken === null ? ok(undefined) : postCliSignOut(endpoint, currentToken);
    },
    registerPasskey: async () => err(notSupportedInCli),
    signInWithPasskey: async () => err(notSupportedInCli),
    enableTwoFactor: async () => err(notSupportedInCli),
    verifyTotp: (code) => verifyTotpCli(endpoint, code, onToken),
    signInWithGoogle: async () => err(notSupportedInCli),
    verifyMagicLinkToken: (token) => verifyMagicLinkToken(endpoint, token, onToken),
  };
};
