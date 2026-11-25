import { acceptedSessionCookieNames } from './browser-session-token.js';

export const AUTH_MAGIC_LINK_VERIFICATION_PATH = '/api/auth/magic-link/verify';
export const AUTH_EMAIL_VERIFICATION_PATH = '/api/auth/verify-email';
export const AUTH_TOTP_VERIFICATION_PATH = '/api/auth/two-factor/verify-totp';
export const AUTH_PASSKEY_AUTHENTICATION_PATH = '/api/auth/passkey/verify-authentication';
export const AUTH_ONE_TAP_CALLBACK_PATH = '/api/auth/one-tap/callback';
export const AUTH_GOOGLE_CALLBACK_PATH = '/api/auth/callback/google';

/**
 * Headless HTTP driver for the Better Auth routes that scripts/auth-e2e.ts
 * exercises directly (sign-up, TOTP enrollment, session read). Better Auth
 * route literals are lint-restricted to adapters/auth, so this driver lives
 * here rather than in the script.
 */
export interface AuthHttpResult {
  status: number;
  token: string | null;
  json: unknown;
}

export interface AuthE2eTransport {
  /** Where to open the TCP connection (a loopback URL that always resolves). */
  connectUrl: string;
  /** The Origin header Better Auth checks for CSRF (a trusted origin). */
  origin: string;
  headers?: Record<string, string>;
  request?: typeof fetch;
}

export interface AuthHttpResponse extends AuthHttpResult {
  headers: Headers;
}

export interface AuthSessionCookie {
  name: string;
  value: string;
}

const requestResponse = async (
  transport: AuthE2eTransport,
  path: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown },
): Promise<AuthHttpResponse> => {
  const headers: Record<string, string> = { origin: transport.origin, ...transport.headers };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  const requestInit: RequestInit = { method: init.method, headers };
  if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);

  const response = await (transport.request ?? fetch)(
    new URL(path, transport.connectUrl),
    requestInit,
  );
  const token = response.headers.get('set-auth-token');
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, token, json, headers: response.headers };
};

const requestJson = async (
  transport: AuthE2eTransport,
  path: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown },
): Promise<AuthHttpResult> => {
  const { status, token, json } = await requestResponse(transport, path, init);
  return { status, token, json };
};

export const sessionCookieOf = (response: AuthHttpResponse): AuthSessionCookie | null => {
  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    const value = pair.slice(separator + 1);
    if (separator > 0 && response.token !== null && decodeURIComponent(value) === response.token) {
      return { name: pair.slice(0, separator), value };
    }
  }
  return null;
};

export const emptySecureSessionCookieHeader = (cookie: AuthSessionCookie): string => {
  const [secureName, plainName] = acceptedSessionCookieNames(cookie.name);
  return `${secureName}=; ${plainName}=${cookie.value}`;
};

export interface AuthE2eClient {
  signUpEmail(input: { name: string; email: string; password: string }): Promise<AuthHttpResult>;
  signInEmail(input: { email: string; password: string }): Promise<AuthHttpResult>;
  signInEmailResponse(input: { email: string; password: string }): Promise<AuthHttpResponse>;
  requestMagicLink(input: {
    email: string;
    callbackURL: string;
    errorCallbackURL: string;
  }): Promise<AuthHttpResult>;
  enableTwoFactor(token: string, password: string): Promise<AuthHttpResult>;
  verifyTotp(token: string, code: string): Promise<AuthHttpResult>;
  getSession(token: string): Promise<AuthHttpResult>;
  resetPassword(input: { token: string; newPassword: string }): Promise<AuthHttpResult>;
}

export const createAuthE2eClient = (transport: AuthE2eTransport): AuthE2eClient => ({
  signUpEmail: (input) => requestJson(transport, '/api/auth/sign-up/email', { method: 'POST', body: input }),
  signInEmail: (input) => requestJson(transport, '/api/auth/sign-in/email', { method: 'POST', body: input }),
  signInEmailResponse: (input) =>
    requestResponse(transport, '/api/auth/sign-in/email', { method: 'POST', body: input }),
  requestMagicLink: (input) =>
    requestJson(transport, '/api/auth/sign-in/magic-link', { method: 'POST', body: input }),
  enableTwoFactor: (token, password) =>
    requestJson(transport, '/api/auth/two-factor/enable', { method: 'POST', token, body: { password } }),
  verifyTotp: (token, code) =>
    requestJson(transport, '/api/auth/two-factor/verify-totp', { method: 'POST', token, body: { code } }),
  getSession: (token) => requestJson(transport, '/api/auth/get-session', { method: 'GET', token }),
  resetPassword: (input) => requestJson(transport, '/api/auth/reset-password', { method: 'POST', body: input }),
});
