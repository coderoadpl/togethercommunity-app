import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import deployment from '../../../vercel.json' with { type: 'json' };

import { forwardedPathNotFound, OFFER_WEB_APP_QUERIES, SERVER_FORWARDED_PREFIXES } from './forwarded-paths.js';

const rewrites = z.array(z.object({
  source: z.string(),
  destination: z.string(),
  has: z.array(z.object({ type: z.string(), key: z.string(), value: z.string() })).optional(),
})).parse(deployment.rewrites);

const prefixOf = (source: string): string | null => /^(?<prefix>\/[^/()]+\/)\(\.\*\)$/u.exec(source)?.groups?.['prefix'] ?? null;

describe('server-forwarded paths', () => {
  it('match every unconditional prefix rewrite the hosted edge sends to the function', () => {
    const forwarded = rewrites
      .filter((rewrite) => rewrite.destination === '/api/index' && rewrite.has === undefined)
      .map((rewrite) => prefixOf(rewrite.source))
      .filter((prefix) => prefix !== null);

    expect([...SERVER_FORWARDED_PREFIXES].sort()).toEqual([...new Set(forwarded)].sort());
  });

  it('let through to the web app exactly the conditional rewrites the hosted edge serves as the document', () => {
    const webApp = rewrites.filter((rewrite) => rewrite.destination === '/index.html' && rewrite.has !== undefined);

    expect(webApp.every((rewrite) => rewrite.source === '/offer/(.*)')).toBe(true);
    expect(webApp.flatMap((rewrite) => rewrite.has ?? []).map(({ type, key, value }) => ({ type, key, value })))
      .toEqual(OFFER_WEB_APP_QUERIES.map(({ key, values }) => ({ type: 'query', key, value: values.join('|') })));
  });

  const nodeEntry = () => {
    const app = new Hono();
    app.get('/u/known', (c) => c.text('server route'));
    app.get('/offer/:slug', async (c, next) => {
      if (c.req.query('status') === 'success' || c.req.query('checkout') === 'together') {
        await next();
        return;
      }
      return c.text('offer page');
    });
    app.get('*', forwardedPathNotFound);
    app.get('*', (c) => c.html('<div id="root"></div>'));
    return app;
  };

  it.each([
    '/u/missing',
    '/marketing/missing',
    '/legal/missing/deeper',
    '/courses/legacy-course',
    '/link/missing',
    '/offer/slug/nested',
    '/offer/slug/nested?status=pending',
    '/api/unknown',
  ])('answers the not-found response for an unmatched %s', async (path) => {
    const response = await nodeEntry().request(path);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('404 Not Found');
  });

  it.each([
    '/',
    '/my/courses/course-js',
    '/u',
    '/offer/slug?status=success',
    '/offer/slug/nested?checkout=together',
    '/offer/slug/nested?status=cancelled',
  ])('serves the web app document for %s', async (path) => {
    const response = await nodeEntry().request(path);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<div id="root"></div>');
  });

  it('leaves matched server routes alone', async () => {
    expect(await (await nodeEntry().request('/u/known')).text()).toBe('server route');
    expect(await (await nodeEntry().request('/offer/slug')).text()).toBe('offer page');
  });
});
