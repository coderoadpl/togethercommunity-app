import type { Hono } from 'hono';
import { API_PATHS, partnerContracts } from '#core/contract/index.js';
import { err, internal, validation } from '#core/domain/index.js';
import { listPartnerPrograms, getPartnerProgram, createPartnerProgram, updatePartnerProgram, assignPartner, updatePartner, createPartnerCode, updatePartnerCode } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

export const registerPartnerRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.get(API_PATHS.listPartnerPrograms, async (c) => deps.partnerManagement === undefined ? respond(err(internal('Partner programs are unavailable'))) : respond(await listPartnerPrograms(ctxOf(c), deps.partnerManagement)));
  app.get(API_PATHS.getPartnerProgram, async (c) => deps.partnerManagement === undefined ? respond(err(internal('Partner programs are unavailable'))) : respond(await getPartnerProgram(ctxOf(c), { id: c.req.param('id') ?? '' }, deps.partnerManagement)));
  app.post(API_PATHS.createPartnerProgram, async (c) => {
    if (deps.partnerManagement === undefined) return respond(err(internal('Partner programs are unavailable')));
    const input = partnerContracts.createPartnerProgram.input.safeParse(await readJson(c.req.raw));
    return input.success ? respond(await createPartnerProgram(ctxOf(c), input.data, deps.partnerManagement), { successStatus: 201 }) : respond(err(validation('Invalid partner program')));
  });
  app.post(API_PATHS.updatePartnerProgram, async (c) => {
    if (deps.partnerManagement === undefined) return respond(err(internal('Partner programs are unavailable')));
    const input = partnerContracts.updatePartnerProgram.input.safeParse(await readJson(c.req.raw));
    return input.success && input.data.id === c.req.param('id') ? respond(await updatePartnerProgram(ctxOf(c), input.data, deps.partnerManagement)) : respond(err(validation('Invalid partner program')));
  });
  app.post(API_PATHS.assignPartner, async (c) => {
    if (deps.partnerManagement === undefined) return respond(err(internal('Partner programs are unavailable')));
    return respond(await assignPartner(ctxOf(c), await readJson(c.req.raw), deps.partnerManagement), { successStatus: 201 });
  });
  app.post(API_PATHS.updatePartner, async (c) => {
    if (deps.partnerManagement === undefined) return respond(err(internal('Partner programs are unavailable')));
    const input = partnerContracts.updatePartner.input.safeParse(await readJson(c.req.raw));
    return input.success && input.data.id === c.req.param('id') ? respond(await updatePartner(ctxOf(c), input.data, deps.partnerManagement)) : respond(err(validation('Invalid partner')));
  });
  app.post(API_PATHS.createPartnerCode, async (c) => {
    if (deps.partnerManagement === undefined) return respond(err(internal('Partner programs are unavailable')));
    return respond(await createPartnerCode(ctxOf(c), await readJson(c.req.raw), deps.partnerManagement), { successStatus: 201 });
  });
  app.post(API_PATHS.updatePartnerCode, async (c) => {
    if (deps.partnerManagement === undefined) return respond(err(internal('Partner programs are unavailable')));
    const input = partnerContracts.updatePartnerCode.input.safeParse(await readJson(c.req.raw));
    return input.success && input.data.id === c.req.param('id') ? respond(await updatePartnerCode(ctxOf(c), input.data, deps.partnerManagement)) : respond(err(validation('Invalid partner code')));
  });
};
