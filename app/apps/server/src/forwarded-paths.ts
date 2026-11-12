import type { MiddlewareHandler } from 'hono';

export const SERVER_FORWARDED_PREFIXES = ['/api/', '/u/', '/marketing/', '/legal/', '/courses/', '/link/', '/offer/'] as const;

export const OFFER_WEB_APP_QUERIES = [
  { key: 'checkout', values: ['together'] },
  { key: 'status', values: ['success', 'cancelled'] },
] as const satisfies ReadonlyArray<{ key: string; values: readonly string[] }>;

const servesWebApp = (path: string, query: (key: string) => string | undefined): boolean =>
  path.startsWith('/offer/') && OFFER_WEB_APP_QUERIES.some(({ key, values }) => {
    const value = query(key);
    return value !== undefined && values.some((allowed) => allowed === value);
  });

const isServerForwardedPath = (path: string, query: (key: string) => string | undefined): boolean =>
  SERVER_FORWARDED_PREFIXES.some((prefix) => path.startsWith(prefix)) && !servesWebApp(path, query);

export const forwardedPathNotFound: MiddlewareHandler = async (c, next) => {
  if (isServerForwardedPath(c.req.path, (key) => c.req.query(key))) return c.notFound();
  await next();
};
