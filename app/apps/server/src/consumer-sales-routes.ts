import type { Hono } from 'hono';

import { API_PATHS, consumerSalesRequestSchema } from '#core/contract/index.js';
import { err, internal, validation } from '#core/domain/index.js';
import { summarizeUninvoicedConsumerSales, consumerSalesToCsv } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { respond } from './respond.js';

export const registerConsumerSalesRoutes = (app: Hono<AppVars>, deps: Pick<AppDeps, 'consumerSales'>): void => {
  app.get(API_PATHS.consumerSalesSummary, async (c) => {
    if (deps.consumerSales === undefined) return respond(err(internal('Consumer sales are unavailable')));
    const parsed = consumerSalesRequestSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to'), format: c.req.query('format') });
    if (!parsed.success) return respond(err(validation('Invalid consumer sales query', parsed.error.flatten())));
    const result = await summarizeUninvoicedConsumerSales(ctxOf(c), { from: parsed.data.from, to: parsed.data.to }, { consumerSales: deps.consumerSales });
    if (!result.ok || parsed.data.format === 'json') return respond(result);
    return new Response(consumerSalesToCsv(result.value), { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="consumer-sales-${parsed.data.from}-${parsed.data.to}.csv"`,
      'cache-control': 'no-store',
    } });
  });
};
