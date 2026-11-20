import { eq } from 'drizzle-orm';

import { normalizeEmail } from '#core/domain/index.js';
import type { EntitlementSubjectReader } from '#core/server/index.js';

import type { Db } from './client.js';
import { createMemberRepository, createMemberSubscriptionRepository, createProductGrantRepository, createTenantAccessReader } from './repositories.js';
import { user } from './schema.js';

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
    listActiveGrants: (tenantId, memberId, now) => sanitized(() => grants.listActiveForMember(tenantId, memberId, now)),
    listSubscriptions: (tenantId, memberId) => sanitized(() => subscriptions.listForMember(tenantId, memberId)),
  };
};
