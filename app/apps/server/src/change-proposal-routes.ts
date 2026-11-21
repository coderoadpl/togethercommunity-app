import type { Hono } from 'hono';

import {
  API_PATHS,
  changeProposalApproveInputSchema,
  changeProposalGroupApproveInputSchema,
  changeProposalListQuerySchema,
  changeProposalRejectInputSchema,
} from '#core/contract/index.js';
import { err, ok, validation } from '#core/domain/index.js';
import {
  approveChangeProposal,
  approveChangeProposalGroup,
  getChangeProposal,
  getChangeProposalGroup,
  getChangeProposalSummary,
  listChangeProposals,
  rejectChangeProposal,
  rejectChangeProposalGroup,
  type ChangeProposalApprovalDeps,
  type ChangeProposalDecisionDeps,
  type ChangeProposalGroupApprovalDeps,
  type ChangeProposalGroupDecisionDeps,
  type ChangeProposalOwnerReadDeps,
  type ChangeProposalSummaryDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond, retryAfterHeaders } from './respond.js';

export const registerChangeProposalRoutes = (
  app: Hono<AppVars>,
  deps: ChangeProposalOwnerReadDeps & ChangeProposalDecisionDeps & ChangeProposalApprovalDeps
    & ChangeProposalGroupDecisionDeps & ChangeProposalGroupApprovalDeps & ChangeProposalSummaryDeps,
): void => {
  app.get(API_PATHS.changeProposals, async (c) => {
    const query = changeProposalListQuerySchema.safeParse({
      status: c.req.query('status'),
      cursor: c.req.query('cursor'),
      groupId: c.req.query('groupId'),
      limit: c.req.query('limit'),
    });
    if (!query.success) return respond(err(validation('Invalid change proposal list query', query.error.flatten())));
    return respond(await listChangeProposals(ctxOf(c), {
      ...(query.data.status === undefined ? {} : { status: query.data.status }),
      ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
      ...(query.data.groupId === undefined ? {} : { groupId: query.data.groupId }),
      ...(query.data.limit === undefined ? {} : { limit: query.data.limit }),
    }, deps));
  });

  app.get(API_PATHS.changeProposalSummary, async (c) => respond(await getChangeProposalSummary(ctxOf(c), deps)));

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
    return result.ok ? respond(ok({ proposal: result.value })) : respond(result, { headers: retryAfterHeaders(result.error) });
  });

  app.post(API_PATHS.changeProposalApprove, async (c) => {
    const body = changeProposalApproveInputSchema.safeParse(await readJson(c.req.raw));
    if (!body.success) return respond(err(validation('Invalid change proposal approval', body.error.flatten())));
    const result = await approveChangeProposal(ctxOf(c), { id: c.req.param('id') ?? '' }, deps);
    return result.ok ? respond(ok({ proposal: result.value })) : respond(result, { headers: retryAfterHeaders(result.error) });
  });

  app.get(API_PATHS.changeProposalGroup, async (c) => {
    const result = await getChangeProposalGroup(ctxOf(c), { id: c.req.param('id') ?? '' }, deps);
    return respond(result.ok ? ok({ group: result.value }) : result);
  });

  app.post(API_PATHS.changeProposalGroupReject, async (c) => {
    const body = changeProposalRejectInputSchema.safeParse(await readJson(c.req.raw));
    if (!body.success) return respond(err(validation('Invalid change proposal group rejection', body.error.flatten())));
    const result = await rejectChangeProposalGroup(ctxOf(c), {
      id: c.req.param('id') ?? '',
      ...(body.data.note === undefined ? {} : { note: body.data.note }),
    }, deps);
    return result.ok ? respond(ok({ group: result.value })) : respond(result, { headers: retryAfterHeaders(result.error) });
  });

  app.post(API_PATHS.changeProposalGroupApprove, async (c) => {
    const body = changeProposalGroupApproveInputSchema.safeParse(await readJson(c.req.raw));
    if (!body.success) return respond(err(validation('Invalid change proposal group approval', body.error.flatten())));
    const result = await approveChangeProposalGroup(ctxOf(c), { id: c.req.param('id') ?? '', itemIds: body.data.itemIds }, deps);
    return result.ok ? respond(ok({ group: result.value })) : respond(result, { headers: retryAfterHeaders(result.error) });
  });
};
