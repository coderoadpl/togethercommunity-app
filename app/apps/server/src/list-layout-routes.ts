import type { Hono } from 'hono';

import { API_PATHS, LIST_LAYOUT_EXPECTED_USER_HEADER } from '#core/contract/index.js';
import { getListLayout, resetListLayout, saveListLayout } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

const layoutOf = (body: unknown): unknown =>
  typeof body === 'object' && body !== null && 'layout' in body ? body.layout : undefined;

export const registerListLayoutRoutes = (app: Hono<AppVars>, deps: Pick<AppDeps, 'listLayouts'>): void => {
  app.get(API_PATHS.getListLayout, async (c) => respond(await getListLayout(ctxOf(c), c.req.param('listId'), c.req.header(LIST_LAYOUT_EXPECTED_USER_HEADER), deps)));
  app.put(API_PATHS.saveListLayout, async (c) =>
    respond(await saveListLayout(ctxOf(c), c.req.param('listId'), c.req.header(LIST_LAYOUT_EXPECTED_USER_HEADER), layoutOf(await readJson(c.req.raw)), deps)));
  app.delete(API_PATHS.resetListLayout, async (c) => respond(await resetListLayout(ctxOf(c), c.req.param('listId'), c.req.header(LIST_LAYOUT_EXPECTED_USER_HEADER), deps)));
};
