const SESSION_TOKEN_HEADER = 'set-auth-token';
const EXPOSE_HEADERS = 'access-control-expose-headers';

const isBrowserRequest = (request: Request): boolean => request.headers.has('sec-fetch-site');

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
 * on the page. Browsers always send `Sec-Fetch-Site` and scripts cannot remove it,
 * so responses to those requests keep only the cookie; the CLI and other
 * non-browser clients still receive the token they authenticate with.
 */
export const withoutBrowserSessionToken = async (request: Request, response: Response): Promise<Response> => {
  if (!isBrowserRequest(request)) return response;
  const headers = withoutTokenHeaders(response.headers);
  const init = { status: response.status, statusText: response.statusText, headers };
  if (!(headers.get('content-type') ?? '').includes('application/json')) return new Response(response.body, init);
  headers.delete('content-length');
  return new Response(withoutTokenBody(await response.text()), init);
};
