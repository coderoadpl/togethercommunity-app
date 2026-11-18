import type { Hono } from 'hono';
import { API_PATHS } from '#core/contract/index.js';
import { err, internal } from '#core/domain/index.js';
import { listOrderChangeFeed } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { respond } from './respond.js';

const QUERY_KEYS = ['after', 'limit', 'mode'] as const;

export const registerOrderChangeRoutes = (app: Hono<AppVars>, deps: Pick<AppDeps, 'orderChangeFeed'>): void => {
  app.get(API_PATHS.orderChanges, async (c) => {
    if (deps.orderChangeFeed === undefined) return respond(err(internal('Order changes are unavailable')));
    const query = Object.fromEntries(QUERY_KEYS.flatMap((key) => {
      const value = c.req.query(key);
      return value === undefined ? [] : [[key, value]];
    }));
    return respond(await listOrderChangeFeed(ctxOf(c), query, deps.orderChangeFeed));
  });
};
