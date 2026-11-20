import { and, eq, isNull, sql } from 'drizzle-orm';

import { memberSchema, normalizeEmail } from '#core/domain/index.js';
import type { EntitlementSubjectReader } from '#core/server/index.js';

import type { Db } from './client.js';
import { createMemberRepository, createMemberSubscriptionRepository, createProductGrantRepository, createTenantAccessReader } from './repositories.js';
import { memberEvents, members as memberRows, orders, user } from './schema.js';

const databaseErrorCode = (error: unknown): string | undefined => {
  const cause: unknown = error instanceof Error ? error.cause : error;
  const code: unknown = typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'code') : undefined;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code) ? code : undefined;
};

const sanitized = async <T>(query: () => Promise<T>): Promise<T> => {
  try {
    return await query();
  } catch (error) {
    // Driver errors carry the bound e-mail or member id of the person being checked; keep only SQLSTATE.
    const code = databaseErrorCode(error);
    throw new Error('Entitlement check database query failed', code !== undefined
      ? { cause: new Error(`PostgreSQL SQLSTATE ${code}`) }
      : undefined);
  }
};

export const createEntitlementSubjectReader = (db: Db): EntitlementSubjectReader => {
  const members = createMemberRepository(db);
  const tenantAccess = createTenantAccessReader(db);
  const grants = createProductGrantRepository(db);
  const subscriptions = createMemberSubscriptionRepository(db);
  return {
    findAccountByEmail: (email) => sanitized(async () => {
      const [row] = await db
        .select({ userId: user.id, emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.email, normalizeEmail(email)))
        .limit(1);
      return row ?? null;
    }),
    findMemberByUser: (tenantId, userId) => sanitized(() => tenantAccess.findMember(tenantId, userId)),
    findMemberById: (tenantId, memberId) => sanitized(() => members.findById(tenantId, memberId)),
    hasSignedIn: (tenantId, memberId) => sanitized(async () => {
      const [row] = await db
        .select({ id: memberEvents.id })
        .from(memberEvents)
        .where(and(eq(memberEvents.tenantId, tenantId), eq(memberEvents.memberId, memberId), eq(memberEvents.type, 'sign-in')))
        .limit(1);
      return row !== undefined;
    }),
    findMembersByEmail: (tenantId, email) => sanitized(async () => (await db
      .select()
      .from(memberRows)
      .where(and(eq(memberRows.tenantId, tenantId), sql`lower(btrim(${memberRows.email})) = ${normalizeEmail(email)}`))
      .limit(2)).map((row) => memberSchema.parse(row))),
    listPaidCheckoutOrders: (tenantId, memberId) => sanitized(async () => (await db
      .select({ kind: orders.kind, productId: orders.productId, lines: orders.lines, providerObjectIds: orders.providerObjectIds })
      .from(orders)
      .where(and(
        eq(orders.tenantId, tenantId),
        eq(orders.memberId, memberId),
        eq(orders.mode, 'live'),
        eq(orders.provider, 'stripe'),
        eq(orders.status, 'paid'),
        isNull(orders.cancelReason),
      ))).map((row) => ({
      kind: row.kind,
      productIds: [...new Set([row.productId, ...row.lines.map((line) => line.productId)])],
      providerSubscriptionId: row.providerObjectIds['subscription'] ?? null,
    }))),
    listActiveGrants: (tenantId, memberId, now) => sanitized(() => grants.listActiveForMember(tenantId, memberId, now)),
    listSubscriptions: (tenantId, memberId) => sanitized(() => subscriptions.listForMember(tenantId, memberId)),
  };
};
