import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';

import type { BrowserContext, Route } from 'playwright-core';
import { z } from 'zod';

export const GOOGLE_FAKE_SERVER_ENTRY = 'scripts/google-fake-server.ts';
export const GOOGLE_FAKE_FAILURE_MARKER = '[google-fake] FAILURE';

const GOOGLE_FAKE_CONFIG_ENV = 'GOOGLE_FAKE_CONFIG';
const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const ID_TOKEN_LIFETIME_SECONDS = 3600;

const isGoogleHost = (hostname: string): boolean =>
  /(^|\.)(google\.com|googleapis\.com|gstatic\.com|googleusercontent\.com)$/u.test(hostname);

const endpointOf = (url: URL): string => `${url.origin}${url.pathname}`;

const publicJwkSchema = z.object({
  kty: z.literal('RSA'),
  n: z.string(),
  e: z.string(),
  kid: z.string(),
  alg: z.literal('RS256'),
  use: z.literal('sig'),
});

const googleFakeConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string().url(),
  jwk: publicJwkSchema,
  idTokensByCode: z.record(z.string(), z.string()),
});

export type GoogleFakeConfig = z.infer<typeof googleFakeConfigSchema>;

export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string;
}

const base64UrlJson = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const signIdToken = (privateKey: KeyObject, kid: string, audience: string, identity: GoogleIdentity): string => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const signingInput = [
    base64UrlJson({ alg: 'RS256', kid, typ: 'JWT' }),
    base64UrlJson({
      iss: GOOGLE_ISSUER,
      aud: audience,
      azp: audience,
      sub: identity.subject,
      email: identity.email,
      email_verified: true,
      name: identity.name,
      iat: issuedAt,
      exp: issuedAt + ID_TOKEN_LIFETIME_SECONDS,
    }),
  ].join('.');
  return `${signingInput}.${sign('sha256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
};

export const createGoogleSigner = (clientId: string) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `two-factor-e2e-${randomUUID()}`;
  return {
    jwk: publicJwkSchema.parse({ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }),
    idToken: (identity: GoogleIdentity): string => signIdToken(privateKey, kid, clientId, identity),
  };
};

export const googleFakeEnv = (config: GoogleFakeConfig): NodeJS.ProcessEnv => ({
  [GOOGLE_FAKE_CONFIG_ENV]: JSON.stringify(config),
});

export const googleFakeConfigFromEnv = (env: NodeJS.ProcessEnv): GoogleFakeConfig => {
  const raw = env[GOOGLE_FAKE_CONFIG_ENV];
  if (raw === undefined) throw new Error(`${GOOGLE_FAKE_CONFIG_ENV} is not set; start this entry through the two-factor e2e`);
  return googleFakeConfigSchema.parse(JSON.parse(raw));
};

const reportServerFailure = (message: string): void => {
  process.stderr.write(`${GOOGLE_FAKE_FAILURE_MARKER} ${message}\n`);
};

const rejectTokenRequest = (description: string): Response => {
  reportServerFailure(`token request rejected: ${description}`);
  return Response.json({ error: 'invalid_grant', error_description: description }, { status: 400 });
};

const answerTokenRequest = async (config: GoogleFakeConfig, request: Request): Promise<Response> => {
  if (request.method !== 'POST') return rejectTokenRequest(`method ${request.method} instead of POST`);
  const form = new URLSearchParams(await request.text());
  if (form.get('grant_type') !== 'authorization_code') return rejectTokenRequest(`grant_type ${String(form.get('grant_type'))}`);
  if (form.get('client_id') !== config.clientId || form.get('client_secret') !== config.clientSecret) {
    return rejectTokenRequest('client credentials do not match the configured client');
  }
  if (form.get('redirect_uri') !== config.redirectUri) {
    return rejectTokenRequest(`redirect_uri ${String(form.get('redirect_uri'))} instead of ${config.redirectUri}`);
  }
  if ((form.get('code_verifier') ?? '') === '') return rejectTokenRequest('the PKCE code_verifier is missing');
  const idToken = config.idTokensByCode[form.get('code') ?? ''];
  if (idToken === undefined) return rejectTokenRequest(`unknown authorization code ${String(form.get('code'))}`);
  return Response.json({
    access_token: 'two-factor-e2e-access-token',
    expires_in: ID_TOKEN_LIFETIME_SECONDS,
    token_type: 'Bearer',
    scope: 'openid email profile',
    id_token: idToken,
  });
};

export const installGoogleFetchFake = (config: GoogleFakeConfig): void => {
  const realFetch = globalThis.fetch;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!isGoogleHost(url.hostname)) return realFetch(input, init);
    const request = new Request(input, init);
    const endpoint = endpointOf(url);
    if (endpoint === GOOGLE_CERTS_URL && request.method === 'GET') return Response.json({ keys: [config.jwk] });
    if (endpoint === GOOGLE_TOKEN_URL) return answerTokenRequest(config, request);
    const message = `unexpected outbound request ${request.method} ${endpoint}`;
    reportServerFailure(message);
    throw new Error(`${GOOGLE_FAKE_FAILURE_MARKER} ${message}`);
  };
  globalThis.fetch = fakeFetch;
};

const identityScript = (clientId: string, credential: string | null): string => `(() => {
  const expectedClientId = ${JSON.stringify(clientId)};
  const credential = ${JSON.stringify(credential)};
  let options = null;
  window.google = { accounts: { id: {
    initialize: (value) => { options = value; },
    prompt: () => {
      if (credential === null || options === null || options.client_id !== expectedClientId) return;
      setTimeout(() => options.callback({ credential, select_by: 'auto', clientId: options.client_id }), 0);
    },
    cancel: () => undefined,
    disableAutoSelect: () => undefined,
  } } };
})();
`;

export interface GoogleBrowserFakeOptions {
  clientId: string;
  redirectUri: string;
  authorizationCode: string;
}

export const installGoogleBrowserFake = async (
  context: BrowserContext,
  { clientId, redirectUri, authorizationCode }: GoogleBrowserFakeOptions,
) => {
  let pendingCredential: string | null = null;
  const failures: string[] = [];
  const served = { identityScripts: 0, authorizations: 0 };

  const answerAuthorization = async (route: Route, url: URL): Promise<void> => {
    const parameters = url.searchParams;
    const state = parameters.get('state') ?? '';
    const problems = [
      parameters.get('client_id') === clientId ? null : `client_id ${String(parameters.get('client_id'))}`,
      parameters.get('redirect_uri') === redirectUri ? null : `redirect_uri ${String(parameters.get('redirect_uri'))}`,
      parameters.get('response_type') === 'code' ? null : `response_type ${String(parameters.get('response_type'))}`,
      parameters.get('code_challenge_method') === 'S256' ? null : 'no S256 PKCE challenge',
      (parameters.get('code_challenge') ?? '') === '' ? 'empty code_challenge' : null,
      state === '' ? 'empty state' : null,
    ].filter((problem) => problem !== null);
    if (problems.length > 0) {
      failures.push(`authorization request rejected: ${problems.join(', ')}`);
      await route.fulfill({ status: 400, contentType: 'text/plain', body: problems.join('\n') });
      return;
    }
    served.authorizations += 1;
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', authorizationCode);
    callback.searchParams.set('state', state);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  };

  await context.route((url) => isGoogleHost(url.hostname), async (route) => {
    const url = new URL(route.request().url());
    const endpoint = endpointOf(url);
    if (endpoint === GOOGLE_IDENTITY_SCRIPT_URL) {
      const credential = pendingCredential;
      pendingCredential = null;
      served.identityScripts += 1;
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: identityScript(clientId, credential) });
      return;
    }
    if (endpoint === GOOGLE_AUTHORIZATION_URL) {
      await answerAuthorization(route, url);
      return;
    }
    failures.push(`unexpected browser request ${route.request().method()} ${endpoint}`);
    await route.abort('blockedbyclient');
  });

  return {
    armOneTapCredential: (credential: string): void => {
      pendingCredential = credential;
    },
    failures: (): string[] => [...failures],
    served: () => ({ ...served }),
  };
};

export type GoogleBrowserFake = Awaited<ReturnType<typeof installGoogleBrowserFake>>;
