import type { Hono } from 'hono';

import { API_PATHS, changeProposalApproveInputSchema, changeProposalListQuerySchema, changeProposalRejectInputSchema } from '#core/contract/index.js';
import { err, ok, validation } from '#core/domain/index.js';
import {
  approveChangeProposal,
  getChangeProposal,
  listChangeProposals,
  rejectChangeProposal,
  type ChangeProposalApprovalDeps,
  type ChangeProposalDecisionDeps,
  type ChangeProposalOwnerReadDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

export const registerChangeProposalRoutes = (
  app: Hono<AppVars>,
  deps: ChangeProposalOwnerReadDeps & ChangeProposalDecisionDeps & ChangeProposalApprovalDeps,
): void => {
  app.get(API_PATHS.changeProposals, async (c) => {
    const query = changeProposalListQuerySchema.safeParse({
      status: c.req.query('status'),
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    });
    if (!query.success) return respond(err(validation('Invalid change proposal list query', query.error.flatten())));
    return respond(await listChangeProposals(ctxOf(c), {
      ...(query.data.status === undefined ? {} : { status: query.data.status }),
      ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
      ...(query.data.limit === undefined ? {} : { limit: query.data.limit }),
    }, deps));
  });

  app.get(API_PATHS.changeProposal, async (c) => {
    const result = await getChangeProposal(ctxOf(c), { id: c.req.param('id') ?? '' }, deps);
    return respond(result.ok ? ok({ proposal: result.value }) : result);
  });

  app.post(API_PATHS.changeProposalReject, async (c) => {
    const body = changeProposalRejectInputSchema.safeParse(await readJson(c.req.raw));
    if (!body.success) return respond(err(validation('Invalid change proposal rejection', body.error.flatten())));
    const result = await rejectChangeProposal(ctxOf(c), {
      id: c.req.param('id') ?? '',
      ...(body.data.note === undefined ? {} : { note: body.data.note }),
    }, deps);
    return respond(result.ok ? ok({ proposal: result.value }) : result);
  });

  app.post(API_PATHS.changeProposalApprove, async (c) => {
    const body = changeProposalApproveInputSchema.safeParse(await readJson(c.req.raw));
    if (!body.success) return respond(err(validation('Invalid change proposal approval', body.error.flatten())));
    const result = await approveChangeProposal(ctxOf(c), { id: c.req.param('id') ?? '' }, deps);
    return respond(result.ok ? ok({ proposal: result.value }) : result);
  });
};
