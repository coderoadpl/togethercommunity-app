import { parseCookies, stripSecureCookiePrefix } from 'better-auth/cookies';

const SESSION_TOKEN_HEADER = 'set-auth-token';
const EXPOSE_HEADERS = 'access-control-expose-headers';

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export const acceptedSessionCookieNames = (sessionCookieName: string): readonly [string, string] => {
  const name = stripSecureCookiePrefix(sessionCookieName);
  return [`__Secure-${name}`, name];
};

const carriesSessionCookie = (request: Request, sessionCookieName: string): boolean => {
  const cookie = request.headers.get('cookie');
  if (cookie === null) return false;
  const cookies = parseCookies(cookie);
  return acceptedSessionCookieNames(sessionCookieName).some((name) => cookies.has(name));
};

const isBrowserRequest = (request: Request, sessionCookieName: string): boolean =>
  request.headers.has('sec-fetch-site') || carriesSessionCookie(request, sessionCookieName);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const withoutToken = (value: unknown): unknown =>
  isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'token'))
    : value;

const withoutTokenFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutToken);
  if (!isRecord(value)) return value;
  const stripped = withoutToken(value);
  return isRecord(stripped) && 'session' in stripped
    ? { ...stripped, session: withoutToken(stripped['session']) }
    : stripped;
};

const withoutTokenHeaders = (source: Headers): Headers => {
  const headers = new Headers(source);
  headers.delete(SESSION_TOKEN_HEADER);
  const exposed = (headers.get(EXPOSE_HEADERS) ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '' && name.toLowerCase() !== SESSION_TOKEN_HEADER);
  if (exposed.length === 0) headers.delete(EXPOSE_HEADERS);
  else headers.set(EXPOSE_HEADERS, exposed.join(', '));
  return headers;
};

const withoutTokenBody = (text: string): string => {
  try {
    return JSON.stringify(withoutTokenFields(JSON.parse(text)));
  } catch {
    return text;
  }
};

/**
 * Better Auth's bearer plugin and its JSON bodies hand the session token to the
 * caller, which turns the HttpOnly cookie into a portable credential for any script
 * on the page. Page scripts cannot set or remove `Sec-Fetch-Site`, but Chrome before
 * 76, Firefox before 90, Safari before 16.4 and webviews on those engines never send
 * it, so a request carrying the session cookie counts as a browser too; those
 * browsers still receive the token on the response that creates a session.
 * Non-browser clients are told apart by sending neither the header nor the session
 * cookie, and keep receiving the token.
 */
export const withoutBrowserSessionToken = async (
  request: Request,
  response: Response,
  sessionCookieName: string,
): Promise<Response> => {
  if (!isBrowserRequest(request, sessionCookieName)) return response;
  const headers = withoutTokenHeaders(response.headers);
  const init = { status: response.status, statusText: response.statusText, headers };
  if (NULL_BODY_STATUSES.has(response.status)) return new Response(null, init);
  if (!(headers.get('content-type') ?? '').includes('application/json')) return new Response(response.body, init);
  headers.delete('content-length');
  return new Response(withoutTokenBody(await response.text()), init);
};
