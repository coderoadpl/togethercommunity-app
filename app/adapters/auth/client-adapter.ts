import { createAuthClient } from 'better-auth/client';
import { magicLinkClient } from 'better-auth/client/plugins';
import { z } from 'zod';

import type { AuthClientPort, AuthSessionResult } from '@core/client/index.js';
import { appError, err, ok, type AppError, type Result } from '@core/domain/index.js';

/** CLI-only extension of the client auth port: it can verify a magic-link token headlessly. */
export interface CliAuthAdapter extends AuthClientPort {
  verifyMagicLinkToken(token: string): Promise<Result<AuthSessionResult, AppError>>;
}

type SignUpInput = Parameters<AuthClientPort['signUp']>[0];
type SignInInput = Parameters<AuthClientPort['signIn']>[0];
type MagicLinkInput = Parameters<AuthClientPort['requestMagicLink']>[0];
type AuthPath = '/api/auth/sign-up/email' | '/api/auth/sign-in/email';

const authErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

const toResult = <T>(value: T, error: { message?: string | undefined; status: number } | null): Result<T, AppError> => {
  if (!error) return ok(value);
  const code =
    error.status === 401
      ? 'unauthorized'
      : error.status === 403
        ? 'forbidden'
        : error.status === 400 || error.status === 422
          ? 'validation'
          : 'internal';
  return err(appError(code, error.message ?? 'Authentication failed'));
};

const readAuthError = async (response: Response): Promise<{ message?: string | undefined; status: number }> => {
  try {
    const payload: unknown = await response.json();
    const parsed = authErrorSchema.safeParse(payload);
    return {
      status: response.status,
      message: parsed.success ? (parsed.data.message ?? parsed.data.code) : response.statusText,
    };
  } catch {
    return { status: response.status, message: response.statusText };
  }
};

const postCliAuth = async (
  baseUrl: string,
  path: AuthPath,
  body: SignUpInput | SignInInput,
  onToken: (token: string) => void,
): Promise<Result<{ token: string | null }, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error calling ${path}: ${String(cause)}`));
  }

  if (!response.ok) return toResult({ token: null }, await readAuthError(response));

  const token = response.headers.get('set-auth-token');
  if (token) onToken(token);
  return ok({ token });
};

/** Better Auth implementation of the client-side auth port. */
export const createBetterAuthClientAdapter = (baseUrl: string): AuthClientPort => {
  const client = createAuthClient({
    baseURL: baseUrl === '' ? undefined : baseUrl,
    plugins: [magicLinkClient()],
  });

  return {
    signUp: async ({ name, email, password }) => {
      const token = null;
      const response = await client.signUp.email({ name, email, password });
      return toResult({ token }, response.error);
    },
    signIn: async ({ email, password }) => {
      const token = null;
      const response = await client.signIn.email({ email, password });
      return toResult({ token }, response.error);
    },
    requestMagicLink: async ({ email, callbackURL }) =>
      toResult(undefined, (await client.signIn.magicLink({ email, callbackURL })).error),
    signOut: async () => toResult(undefined, (await client.signOut()).error),
  };
};

const postCliMagicLink = async (
  baseUrl: string,
  input: MagicLinkInput,
): Promise<Result<void, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/sign-in/magic-link', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    return err(appError('internal', `Network error requesting magic link: ${String(cause)}`));
  }
  if (!response.ok) return toResult(undefined, await readAuthError(response));
  return ok(undefined);
};

const verifyMagicLinkToken = async (
  baseUrl: string,
  token: string,
  onToken: (token: string) => void,
): Promise<Result<AuthSessionResult, AppError>> => {
  const url = new URL('/api/auth/magic-link/verify', baseUrl);
  url.searchParams.set('token', token);
  let response: Response;
  try {
    response = await fetch(url, { headers: { origin: baseUrl }, redirect: 'manual' });
  } catch (cause) {
    return err(appError('internal', `Network error verifying magic link: ${String(cause)}`));
  }
  if (!response.ok) return toResult({ token: null }, await readAuthError(response));

  const sessionToken = response.headers.get('set-auth-token');
  if (sessionToken) onToken(sessionToken);
  return ok({ token: sessionToken });
};

export const createCliAuthAdapter = (baseUrl: string, onToken: (token: string) => void): CliAuthAdapter => ({
  signUp: (input) => postCliAuth(baseUrl, '/api/auth/sign-up/email', input, onToken),
  signIn: (input) => postCliAuth(baseUrl, '/api/auth/sign-in/email', input, onToken),
  requestMagicLink: (input) => postCliMagicLink(baseUrl, input),
  signOut: async () => ok(undefined),
  verifyMagicLinkToken: (token) => verifyMagicLinkToken(baseUrl, token, onToken),
});
