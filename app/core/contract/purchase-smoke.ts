import { z } from 'zod';

import { purchaseSmokeCheckoutSchema, purchaseSmokeResultSchema, purchaseSmokeStartSchema } from '#core/domain/index.js';

export const PURCHASE_SMOKE_ROUTES = {
  start: { method: 'POST', path: '/api/m2m/shop/purchase-smoke/checkouts' },
  result: { method: 'GET', path: '/api/m2m/shop/purchase-smoke/checkouts/:reference/result' },
} as const;

export const purchaseSmokeContracts = {
  start: { input: purchaseSmokeStartSchema, output: purchaseSmokeCheckoutSchema },
  result: { input: z.object({ reference: z.string().uuid() }).strict(), output: purchaseSmokeResultSchema },
};
