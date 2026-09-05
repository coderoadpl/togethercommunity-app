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
  request?: typeof fetch;
}

const requestJson = async (
  transport: AuthE2eTransport,
  path: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown },
): Promise<AuthHttpResult> => {
  const headers: Record<string, string> = { origin: transport.origin };
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
  return { status: response.status, token, json };
};

export interface AuthE2eClient {
  signUpEmail(input: { name: string; email: string; password: string }): Promise<AuthHttpResult>;
  signInEmail(input: { email: string; password: string }): Promise<AuthHttpResult>;
  enableTwoFactor(token: string, password: string): Promise<AuthHttpResult>;
  verifyTotp(token: string, code: string): Promise<AuthHttpResult>;
  getSession(token: string): Promise<AuthHttpResult>;
}

export const createAuthE2eClient = (transport: AuthE2eTransport): AuthE2eClient => ({
  signUpEmail: (input) => requestJson(transport, '/api/auth/sign-up/email', { method: 'POST', body: input }),
  signInEmail: (input) => requestJson(transport, '/api/auth/sign-in/email', { method: 'POST', body: input }),
  enableTwoFactor: (token, password) =>
    requestJson(transport, '/api/auth/two-factor/enable', { method: 'POST', token, body: { password } }),
  verifyTotp: (token, code) =>
    requestJson(transport, '/api/auth/two-factor/verify-totp', { method: 'POST', token, body: { code } }),
  getSession: (token) => requestJson(transport, '/api/auth/get-session', { method: 'GET', token }),
});
