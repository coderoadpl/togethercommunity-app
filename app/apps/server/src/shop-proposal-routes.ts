import { SHOP_PROPOSAL_ROUTES, shopProposalContracts } from '#core/contract/index.js';
import { changeProposalIdInputSchema, err, ok, validation } from '#core/domain/index.js';
import {
  getOwnChangeProposal,
  listOwnChangeProposals,
  withdrawOwnChangeProposal,
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { respond } from './respond.js';
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
];
