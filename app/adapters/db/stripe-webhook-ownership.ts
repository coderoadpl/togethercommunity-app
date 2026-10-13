import { and, eq, ne, or, sql } from 'drizzle-orm';

import type { StripeWebhookOwnershipReader } from '#core/server/ports.js';

import type { Db } from './client.js';
import { members, memberSubscriptions, orders } from './schema.js';

export const createStripeWebhookOwnershipReader = (db: Db): StripeWebhookOwnershipReader => ({
  hasForeignOwner: async (tenantId, ids) => {
    // Signed webhooks need cross-tenant existence checks; no foreign records leave this adapter.
    if (ids.customer !== undefined) {
      const matches = await db.select({ found: sql`true` }).from(members).where(and(
        ne(members.tenantId, tenantId),
        sql`${members.externalCustomerIds} ->> 'stripe' = ${ids.customer}`,
      )).limit(1);
      if (matches.length > 0) return true;
    }
    if (ids.subscription !== undefined) {
      const matches = await db.select({ found: sql`true` }).from(memberSubscriptions).where(and(
        ne(memberSubscriptions.tenantId, tenantId),
        eq(memberSubscriptions.provider, 'stripe'),
        eq(memberSubscriptions.providerSubscriptionId, ids.subscription),
      )).limit(1);
      if (matches.length > 0) return true;
    }
    const identifiers = Object.entries(ids).filter(([, value]) => value !== undefined);
    if (identifiers.length === 0) return false;
    const matches = await db.select({ found: sql`true` }).from(orders).where(and(
      ne(orders.tenantId, tenantId),
      eq(orders.provider, 'stripe'),
      or(...identifiers.map(([key, value]) => sql`${orders.providerObjectIds} ->> ${key} = ${value}`)),
    )).limit(1);
    return matches.length > 0;
  },
});
