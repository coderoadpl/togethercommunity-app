import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type CouponStatsCursor,
  type CouponStatsItem,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, CouponStatsRepository } from '../ports.js';

export interface CouponStatsDeps {
  stats: CouponStatsRepository;
  clock: Clock;
}

export interface CouponStatsQuery {
  partnerLabel?: string;
  cursor?: CouponStatsCursor;
  limit?: number;
  since?: string;
  through?: string;
}

const tenantFor = (ctx: Ctx): Result<string, AppError> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound('Select a tenant to view coupon sales'));
  if (ctx.identity.staffRole === null) return err(forbidden('Only tenant staff can view coupon sales'));
  return ok(ctx.identity.tenantId);
};

const windowFor = (
  query: CouponStatsQuery,
  clock: Clock,
): { since: string; through: string } => {
  const through = query.through ?? clock.nowIso();
  return {
    since:
      query.since ??
      new Date(Date.parse(through) - 30 * 24 * 60 * 60 * 1000).toISOString(),
    through,
  };
};

export const listCouponStats = async (
  ctx: Ctx,
  query: CouponStatsQuery,
  deps: CouponStatsDeps,
): Promise<Result<{ items: CouponStatsItem[]; nextCursor: CouponStatsCursor | null }, AppError>> => {
  const tenant = tenantFor(ctx);
  if (!tenant.ok) return tenant;
  const limit = Math.min(100, Math.max(1, query.limit ?? 25));
  return ok(
    await deps.stats.list(tenant.value, {
      ...(query.partnerLabel === undefined ? {} : { partnerLabel: query.partnerLabel }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...windowFor(query, deps.clock),
      limit,
    }),
  );
};

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const settlementRows = (items: CouponStatsItem[]) =>
  items.flatMap((item) => {
    const currencies = new Set([
      ...item.grossAttributed.map((total) => total.currency),
      ...item.discountGiven.map((total) => total.currency),
    ]);
    if (currencies.size === 0) currencies.add('PLN');
    return [...currencies].map((currency) => ({
      code: item.coupon.code,
      partnerLabel: item.coupon.partnerLabel ?? '',
      redemptions: item.redemptions,
      currency,
      grossAttributedCents:
        item.grossAttributed.find((total) => total.currency === currency)?.amountCents ?? 0,
      discountGivenCents:
        item.discountGiven.find((total) => total.currency === currency)?.amountCents ?? 0,
      sessionsWithCode: item.sessionsWithCode,
      conversionRate: item.conversionRate,
    }));
  });

export const exportCouponStats = async (
  ctx: Ctx,
  input: Omit<CouponStatsQuery, 'cursor' | 'limit'> & { format: 'csv' | 'json' },
  deps: CouponStatsDeps,
): Promise<Result<{ filename: string; mimeType: string; content: string }, AppError>> => {
  const all: CouponStatsItem[] = [];
  let cursor: CouponStatsCursor | undefined;
  do {
    const page = await listCouponStats(
      ctx,
      { ...input, ...(cursor === undefined ? {} : { cursor }), limit: 100 },
      deps,
    );
    if (!page.ok) return page;
    all.push(...page.value.items);
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor !== undefined);
  const rows = settlementRows(all);
  if (input.format === 'json') {
    return ok({
      filename: 'coupon-attribution.json',
      mimeType: 'application/json',
      content: JSON.stringify(rows, null, 2),
    });
  }
  const header = [
    'code',
    'partnerLabel',
    'redemptions',
    'currency',
    'grossAttributedCents',
    'discountGivenCents',
    'sessionsWithCode',
    'conversionRate',
  ];
  return ok({
    filename: 'coupon-attribution.csv',
    mimeType: 'text/csv',
    content: [
      header.join(','),
      ...rows.map((row) =>
        [
          row.code,
          row.partnerLabel,
          row.redemptions,
          row.currency,
          row.grossAttributedCents,
          row.discountGivenCents,
          row.sessionsWithCode,
          row.conversionRate,
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\n'),
  });
};
