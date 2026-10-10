import type { Hono } from 'hono';
import { API_PATHS, salesLinkContracts } from '#core/contract/index.js';
import { err, internal, validation } from '#core/domain/index.js';
import { createSalesLink, deleteSalesLink, getSalesLink, listSalesLinks, updateSalesLink } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

export const registerSalesLinkRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.get(API_PATHS.listSalesLinks, async (c) => deps.salesLinkManagement === undefined ? respond(err(internal('Sales links are unavailable'))) : respond(await listSalesLinks(ctxOf(c), deps.salesLinkManagement)));
  app.get(API_PATHS.getSalesLink, async (c) => deps.salesLinkManagement === undefined ? respond(err(internal('Sales links are unavailable'))) : respond(await getSalesLink(ctxOf(c), { id: c.req.param('id') ?? '' }, deps.salesLinkManagement)));
  app.post(API_PATHS.createSalesLink, async (c) => {
    if (deps.salesLinkManagement === undefined) return respond(err(internal('Sales links are unavailable')));
    const input = salesLinkContracts.createSalesLink.input.safeParse(await readJson(c.req.raw));
    return input.success ? respond(await createSalesLink(ctxOf(c), input.data, deps.salesLinkManagement), { successStatus: 201 }) : respond(err(validation('Invalid sales link')));
  });
  app.post(API_PATHS.updateSalesLink, async (c) => {
    if (deps.salesLinkManagement === undefined) return respond(err(internal('Sales links are unavailable')));
    const input = salesLinkContracts.updateSalesLink.input.safeParse(await readJson(c.req.raw));
    if (!input.success || input.data.id !== c.req.param('id')) return respond(err(validation('Invalid sales-link update')));
    return respond(await updateSalesLink(ctxOf(c), input.data, deps.salesLinkManagement));
  });
  app.delete(API_PATHS.deleteSalesLink, async (c) => deps.salesLinkManagement === undefined ? respond(err(internal('Sales links are unavailable'))) : respond(await deleteSalesLink(ctxOf(c), { id: c.req.param('id') ?? '' }, deps.salesLinkManagement)));
};
