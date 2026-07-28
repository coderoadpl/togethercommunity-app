import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';

import {
  couponCheckoutSessionSchema,
  couponOptionSchema,
  couponSchema,
  couponStatsItemSchema,
  normalizeCouponCode,
  type CouponCheckoutSession,
} from '#core/domain/index.js';
import type {
  CouponCheckoutSessionRepository,
  CouponRedemptionRepository,
  CouponManagementRepository,
  CouponStatsRepository,
  ProductPriceHistoryRepository,
} from '#core/server/index.js';

import type { Db } from './client.js';
import {
  couponCheckoutSessions,
  couponEvents,
  couponRedemptionEvents,
  couponRedemptions,
  coupons,
  orders,
  productPriceHistory,
} from './app-schema.js';

export const createCouponRepository = (db: Db): CouponManagementRepository => ({
  findByCode: async (tenantId, normalizedCode) => {
    const rows = await db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.tenantId, tenantId),
          sql`upper(${coupons.code}) = ${normalizeCouponCode(normalizedCode)}`,
        ),
      )
      .limit(1);
    return rows[0] ? couponSchema.parse(rows[0]) : null;
  },
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)))
      .limit(1);
    return rows[0] ? couponSchema.parse(rows[0]) : null;
  },
  create: async (tenantId, coupon, event) =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(coupons)
        .values({ ...coupon, tenantId })
        .onConflictDoNothing()
        .returning();
      if (inserted[0] === undefined) return null;
      await tx.insert(couponEvents).values({ ...event, tenantId });
      return couponSchema.parse(inserted[0]);
    }),
  archive: async (tenantId, id, event) =>
    db.transaction(async (tx) => {
      const updated = await tx
        .update(coupons)
        .set({ status: 'archived' })
        .where(
          and(
            eq(coupons.tenantId, tenantId),
            eq(coupons.id, id),
            eq(coupons.status, 'active'),
          ),
        )
        .returning();
      if (updated[0] === undefined) return null;
      await tx.insert(couponEvents).values({ ...event, tenantId });
      return couponSchema.parse(updated[0]);
    }),
  cacheStripeIds: async (tenantId, id, stripeIds) => {
    const rows = await db
      .update(coupons)
      .set(stripeIds)
      .where(
        and(
          eq(coupons.tenantId, tenantId),
          eq(coupons.id, id),
          sql`${coupons.stripeCouponId} is null`,
          sql`${coupons.stripePromotionCodeId} is null`,
        ),
      )
      .returning();
    if (rows[0]) return couponSchema.parse(rows[0]);
    const current = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)))
      .limit(1);
    return current[0] ? couponSchema.parse(current[0]) : null;
  },
});

export const createCouponCheckoutSessionRepository = (
  db: Db,
): CouponCheckoutSessionRepository => ({
  create: async (tenantId, session) => {
    await db.insert(couponCheckoutSessions).values({ ...session, tenantId });
  },
  attachProviderSession: async (tenantId, id, providerSessionId) => {
    await db
      .update(couponCheckoutSessions)
      .set({ providerSessionId })
      .where(
        and(
          eq(couponCheckoutSessions.tenantId, tenantId),
          eq(couponCheckoutSessions.id, id),
        ),
      );
  },
  findById: async (tenantId, id): Promise<CouponCheckoutSession | null> => {
    const rows = await db
      .select()
      .from(couponCheckoutSessions)
      .where(
        and(
          eq(couponCheckoutSessions.tenantId, tenantId),
          eq(couponCheckoutSessions.id, id),
        ),
      )
      .limit(1);
    return rows[0] ? couponCheckoutSessionSchema.parse(rows[0]) : null;
  },
});

export const createCouponRedemptionRepository = (db: Db): CouponRedemptionRepository => ({
  counts: async (tenantId, couponId, normalizedEmail) => {
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        member: sql<number>`count(*) filter (where lower(${couponRedemptions.email}) = lower(${normalizedEmail}))::int`,
      })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.tenantId, tenantId),
          eq(couponRedemptions.couponId, couponId),
        ),
      );
    return { total: rows[0]?.total ?? 0, member: rows[0]?.member ?? 0 };
  },
  createOrderAndClaim: async (tenantId, input) =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from ${coupons} where ${coupons.tenantId} = ${tenantId} and ${coupons.id} = ${input.redemption.couponId} for update`,
      );
      const counts = await tx
        .select({
          total: sql<number>`count(*)::int`,
          member: sql<number>`count(*) filter (where ${couponRedemptions.memberId} = ${input.redemption.memberId})::int`,
        })
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.tenantId, tenantId),
            eq(couponRedemptions.couponId, input.redemption.couponId),
          ),
        );
      const total = counts[0]?.total ?? 0;
      const member = counts[0]?.member ?? 0;
      if (input.maxRedemptions !== null && total >= input.maxRedemptions) return false;
      if (
        input.maxRedemptionsPerMember !== null &&
        member >= input.maxRedemptionsPerMember
      ) {
        return false;
      }
      const insertedOrder = await tx
        .insert(orders)
        .values({ ...input.order, tenantId })
        .onConflictDoNothing()
        .returning({ id: orders.id });
      if (insertedOrder.length === 0) return false;
      const inserted = await tx
        .insert(couponRedemptions)
        .values({ ...input.redemption, tenantId })
        .onConflictDoNothing()
        .returning({ id: couponRedemptions.id });
      if (inserted.length === 1) {
        await tx.insert(couponRedemptionEvents).values({ ...input.event, tenantId });
      }
      return inserted.length === 1;
    }),
});

export const createProductPriceHistoryRepository = (
  db: Db,
): ProductPriceHistoryRepository => ({
  lowestSince: async (tenantId, input) => {
    const rows = await db
      .select({
        amountCents: sql<number>`coalesce(min(${productPriceHistory.amountCents}), ${input.currentAmountCents})::int`,
      })
      .from(productPriceHistory)
      .where(
        and(
          eq(productPriceHistory.tenantId, tenantId),
          eq(productPriceHistory.productId, input.productId),
          sql`${productPriceHistory.effectiveFrom}::timestamptz >= ${input.since}::timestamptz`,
          sql`${productPriceHistory.effectiveFrom}::timestamptz <= ${input.through}::timestamptz`,
        ),
      );
    return Math.min(input.currentAmountCents, rows[0]?.amountCents ?? input.currentAmountCents);
  },
});

export const createCouponStatsRepository = (db: Db): CouponStatsRepository => ({
  listOptions: async (tenantId) => {
    const rows = await db
      .select({ id: coupons.id, code: coupons.code })
      .from(coupons)
      .where(eq(coupons.tenantId, tenantId))
      .orderBy(asc(coupons.code));
    return rows.map((row) => couponOptionSchema.parse(row));
  },
  list: async (tenantId, query) => {
    const cursorCondition =
      query.cursor === undefined
        ? undefined
        : or(
            lt(coupons.createdAt, query.cursor.createdAt),
            and(eq(coupons.createdAt, query.cursor.createdAt), lt(coupons.id, query.cursor.id)),
          );
    const page = await db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.tenantId, tenantId),
          query.couponId === undefined ? undefined : eq(coupons.id, query.couponId),
          query.partnerLabel === undefined
            ? undefined
            : ilike(coupons.partnerLabel, `%${query.partnerLabel.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`),
          cursorCondition,
        ),
      )
      .orderBy(desc(coupons.createdAt), desc(coupons.id))
      .limit(query.limit + 1);
    const visible = page.slice(0, query.limit);
    const ids = visible.map((coupon) => coupon.id);
    if (ids.length === 0) return { items: [], nextCursor: null };

    const [redemptionRows, sessionRows, conversionRows, moneyRows, timeRows] = await Promise.all([
      db
        .select({
          couponId: couponRedemptions.couponId,
          count: sql<number>`count(*)::int`,
        })
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.tenantId, tenantId),
            inArray(couponRedemptions.couponId, ids),
            sql`${couponRedemptions.createdAt}::timestamptz >= ${query.since}::timestamptz`,
            sql`${couponRedemptions.createdAt}::timestamptz <= ${query.through}::timestamptz`,
          ),
        )
        .groupBy(couponRedemptions.couponId),
      db
        .select({
          couponId: couponCheckoutSessions.couponId,
          count: sql<number>`count(*)::int`,
        })
        .from(couponCheckoutSessions)
        .where(
          and(
            eq(couponCheckoutSessions.tenantId, tenantId),
            inArray(couponCheckoutSessions.couponId, ids),
            sql`${couponCheckoutSessions.startedAt}::timestamptz >= ${query.since}::timestamptz`,
            sql`${couponCheckoutSessions.startedAt}::timestamptz <= ${query.through}::timestamptz`,
          ),
        )
        .groupBy(couponCheckoutSessions.couponId),
      db
        .select({
          couponId: couponCheckoutSessions.couponId,
          count: sql<number>`count(distinct ${couponCheckoutSessions.id})::int`,
        })
        .from(couponCheckoutSessions)
        .innerJoin(
          orders,
          and(
            eq(orders.tenantId, couponCheckoutSessions.tenantId),
            eq(orders.couponId, couponCheckoutSessions.couponId),
            eq(orders.status, 'paid'),
            sql`${orders.providerObjectIds}->>'checkoutSession' = coalesce(
              ${couponCheckoutSessions.providerSessionId},
              'free_' || ${couponCheckoutSessions.id}
            )`,
          ),
        )
        .where(
          and(
            eq(couponCheckoutSessions.tenantId, tenantId),
            inArray(couponCheckoutSessions.couponId, ids),
            sql`${couponCheckoutSessions.startedAt}::timestamptz >= ${query.since}::timestamptz`,
            sql`${couponCheckoutSessions.startedAt}::timestamptz <= ${query.through}::timestamptz`,
          ),
        )
        .groupBy(couponCheckoutSessions.couponId),
      db
        .select({
          couponId: orders.couponId,
          currency: orders.currency,
          gross: sql<number>`coalesce(sum(${orders.amountCents}), 0)::int`,
          discount: sql<number>`coalesce(sum(${orders.discountCents}), 0)::int`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            inArray(orders.couponId, ids),
            eq(orders.status, 'paid'),
            sql`${orders.createdAt}::timestamptz >= ${query.since}::timestamptz`,
            sql`${orders.createdAt}::timestamptz <= ${query.through}::timestamptz`,
          ),
        )
        .groupBy(orders.couponId, orders.currency),
      db
        .select({
          couponId: orders.couponId,
          date: sql<string>`left(${orders.createdAt}, 10)`,
          currency: orders.currency,
          redemptions: sql<number>`count(*)::int`,
          gross: sql<number>`coalesce(sum(${orders.amountCents}), 0)::int`,
          discount: sql<number>`coalesce(sum(${orders.discountCents}), 0)::int`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            inArray(orders.couponId, ids),
            eq(orders.status, 'paid'),
            sql`${orders.createdAt}::timestamptz >= ${query.since}::timestamptz`,
            sql`${orders.createdAt}::timestamptz <= ${query.through}::timestamptz`,
          ),
        )
        .groupBy(orders.couponId, sql`left(${orders.createdAt}, 10)`, orders.currency)
        .orderBy(sql`left(${orders.createdAt}, 10)`),
    ]);
    const items = visible.map((row) => {
      const redemptions =
        redemptionRows.find((candidate) => candidate.couponId === row.id)?.count ?? 0;
      const sessionsWithCode =
        sessionRows.find((candidate) => candidate.couponId === row.id)?.count ?? 0;
      const convertedSessions =
        conversionRows.find((candidate) => candidate.couponId === row.id)?.count ?? 0;
      const money = moneyRows.filter((candidate) => candidate.couponId === row.id);
      return couponStatsItemSchema.parse({
        coupon: couponSchema.parse(row),
        redemptions,
        sessionsWithCode,
        conversionRate: sessionsWithCode === 0 ? 0 : convertedSessions / sessionsWithCode,
        grossAttributed: money.map((total) => ({
          currency: total.currency,
          amountCents: total.gross,
        })),
        discountGiven: money.map((total) => ({
          currency: total.currency,
          amountCents: total.discount,
        })),
        timeSeries: timeRows
          .filter((point) => point.couponId === row.id)
          .map((point) => ({
            date: point.date,
            currency: point.currency,
            redemptions: point.redemptions,
            grossAttributedCents: point.gross,
            discountGivenCents: point.discount,
          })),
      });
    });
    const last = visible.at(-1);
    return {
      items,
      nextCursor:
        page.length <= query.limit || last === undefined
          ? null
          : { createdAt: last.createdAt, id: last.id },
    };
  },
});
