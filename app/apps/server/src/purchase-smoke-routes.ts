import { PURCHASE_SMOKE_ROUTES, purchaseSmokeContracts } from '#core/contract/index.js';
import { err, validation } from '#core/domain/index.js';
import { getPurchaseSmokeResult, startPurchaseSmokeCheckout } from '#core/server/index.js';

import { tenantUrl } from '#core/server/tenant-url.js';

import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

export const purchaseSmokeRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...PURCHASE_SMOKE_ROUTES.start, scope: null, proposeMode: { kind: 'purchase-smoke' },
    handler: async (c, request) => {
      return respond(await startPurchaseSmokeCheckout(request.apiKey, await readJson(c.req.raw), {
        purchaseSmoke: deps.purchaseSmoke,
        clock: deps.clock,
        purchaseSmokeTransaction: deps.purchaseSmokeTransaction,
        fixtureBaseUrl: new URL(tenantUrl('acme', '/', deps)).origin,
      }));
    },
  },
  {
    ...PURCHASE_SMOKE_ROUTES.result, scope: null, proposeMode: { kind: 'purchase-smoke' },
    handler: async (c, request) => {
      const parsed = purchaseSmokeContracts.result.input.safeParse({ reference: c.req.param('reference') });
      if (!parsed.success) return respond(err(validation('Invalid checkout reference')));
      return respond(await getPurchaseSmokeResult(request.apiKey, parsed.data.reference, deps));
    },
  },
];
