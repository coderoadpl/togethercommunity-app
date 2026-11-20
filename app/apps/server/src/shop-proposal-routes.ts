import { SHOP_PROPOSAL_ROUTES, shopProposalContracts } from '#core/contract/index.js';
import { changeProposalIdInputSchema, err, ok, validation } from '#core/domain/index.js';
import {
  createChangeProposalGroup,
  getOwnChangeProposal,
  getOwnChangeProposalGroup,
  listOwnChangeProposals,
  withdrawOwnChangeProposal,
  withdrawOwnChangeProposalGroup,
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond, retryAfterHeaders } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

export const shopProposalRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...SHOP_PROPOSAL_ROUTES.listProposals,
    proposeMode: { kind: 'proposal-management' },
    handler: async (c, { ctx }) => {
      const query = shopProposalContracts.listProposals.input.safeParse(c.req.query());
      if (!query.success) return respond(err(validation('Invalid change proposal list query', query.error.flatten())));
      return respond(await listOwnChangeProposals(ctx, {
        ...(query.data.status === undefined ? {} : { status: query.data.status }),
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        ...(query.data.groupId === undefined ? {} : { groupId: query.data.groupId }),
        ...(query.data.limit === undefined ? {} : { limit: query.data.limit }),
      }, deps));
    },
  },
  {
    ...SHOP_PROPOSAL_ROUTES.getProposal,
    proposeMode: { kind: 'proposal-management' },
    handler: async (c, { ctx }) => {
      const result = await getOwnChangeProposal(ctx, { id: c.req.param('id') ?? '' }, deps);
      return respond(result.ok ? ok({ proposal: result.value }) : result);
    },
  },
  {
    ...SHOP_PROPOSAL_ROUTES.withdrawProposal,
    proposeMode: { kind: 'proposal-management' },
    resourceIdSchema: changeProposalIdInputSchema.shape.id,
    handler: async (c, { ctx }) => {
      const result = await withdrawOwnChangeProposal(ctx, { id: c.req.param('id') ?? '' }, deps);
      return respond(result.ok ? ok({ proposal: result.value }) : result);
    },
  },
  {
    ...SHOP_PROPOSAL_ROUTES.createGroup,
    proposeMode: { kind: 'proposal-management' },
    handler: async (c, { ctx }) => {
      const body = shopProposalContracts.createGroup.input.safeParse(await readJson(c.req.raw));
      if (!body.success) return respond(err(validation('Invalid change proposal group', body.error.flatten())));
      const result = await createChangeProposalGroup(ctx, body.data, deps);
      return result.ok
        ? respond(ok({ group: result.value }), { successStatus: 201 })
        : respond(result, { headers: retryAfterHeaders(result.error) });
    },
  },
  {
    ...SHOP_PROPOSAL_ROUTES.getGroup,
    proposeMode: { kind: 'proposal-management' },
    handler: async (c, { ctx }) => {
      const result = await getOwnChangeProposalGroup(ctx, { id: c.req.param('id') ?? '' }, deps);
      return respond(result.ok ? ok({ group: result.value }) : result);
    },
  },
  {
    ...SHOP_PROPOSAL_ROUTES.withdrawGroup,
    proposeMode: { kind: 'proposal-management' },
    resourceIdSchema: changeProposalIdInputSchema.shape.id,
    handler: async (c, { ctx }) => {
      const result = await withdrawOwnChangeProposalGroup(ctx, { id: c.req.param('id') ?? '' }, deps);
      return result.ok ? respond(ok({ group: result.value })) : respond(result, { headers: retryAfterHeaders(result.error) });
    },
  },
];
