import { and, asc, eq, sql } from 'drizzle-orm';

import { staffRoleSchema, type Membership, type StaffRole } from '@core/domain/index.js';
import type {
  DevMagicLinkReader,
  HealthPort,
  MemberRepository,
  PurchaseRepository,
  ProductGrantRepository,
  ProductRepository,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '@core/server/index.js';

import type { Db } from './client.js';
import {
  devMagicLinks,
  members,
  productGrants,
  products,
  tenantAdmins,
  tenantDomains,
  tenants,
} from './schema.js';

const parseStaffRole = (raw: string): StaffRole | null => {
  const parsed = staffRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const createProductRepository = (db: Db): ProductRepository => ({
  listByTenant: async (tenantId) =>
    db.select().from(products).where(eq(products.tenantId, tenantId)).orderBy(asc(products.createdAt)),
  listPublishedByTenant: async (tenantId) =>
    db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.published, true)))
      .orderBy(asc(products.createdAt)),
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
      .limit(1);
    return rows[0] ?? null;
  },
  create: async (tenantId, product) => {
    await db.insert(products).values({
      id: product.id,
      tenantId,
      title: product.title,
      description: product.description,
      priceCents: product.priceCents,
      currency: product.currency,
      published: product.published,
      createdAt: product.createdAt,
    });
  },
  setPublished: async (tenantId, id, published) => {
    await db
      .update(products)
      .set({ published })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id)));
  },
  bumpContentVersion: async (tenantId) => {
    await db
      .update(tenants)
      .set({ contentVersion: sql`${tenants.contentVersion} + 1` })
      .where(eq(tenants.id, tenantId));
  },
});

export const createMemberRepository = (db: Db): MemberRepository => ({
  findByEmail: async (tenantId, email) => {
    const rows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.email, email)))
      .limit(1);
    return rows[0] ?? null;
  },
  listWithProductIds: async (tenantId) =>
    db
      .select({
        id: members.id,
        email: members.email,
        displayName: members.displayName,
        createdAt: members.createdAt,
        productIds: sql<
          string[]
        >`coalesce(array_agg(${productGrants.productId}) filter (where ${productGrants.productId} is not null), '{}')`,
      })
      .from(members)
      .leftJoin(
        productGrants,
        and(eq(productGrants.tenantId, members.tenantId), eq(productGrants.memberId, members.id)),
      )
      .where(eq(members.tenantId, tenantId))
      .groupBy(members.id, members.email, members.displayName, members.createdAt)
      .orderBy(asc(members.createdAt)),
  create: async (tenantId, member) => {
    await db
      .insert(members)
      .values({
        id: member.id,
        tenantId,
        userId: member.userId,
        email: member.email,
        displayName: member.displayName,
        createdAt: member.createdAt,
      })
      .onConflictDoNothing({ target: [members.tenantId, members.userId] });
  },
  delete: async (tenantId, memberId) => {
    const rows = await db
      .delete(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.id, memberId)))
      .returning({ id: members.id });
    return rows.length > 0;
  },
});

export const createProductGrantRepository = (db: Db): ProductGrantRepository => ({
  findGrant: async (tenantId, memberId, productId) => {
    const rows = await db
      .select()
      .from(productGrants)
      .where(
        and(
          eq(productGrants.tenantId, tenantId),
          eq(productGrants.memberId, memberId),
          eq(productGrants.productId, productId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },
  createGrant: async (tenantId, grant) => {
    const rows = await db
      .insert(productGrants)
      .values({
        id: grant.id,
        tenantId,
        memberId: grant.memberId,
        productId: grant.productId,
        source: grant.source,
        createdAt: grant.createdAt,
      })
      .onConflictDoNothing({
        target: [productGrants.tenantId, productGrants.memberId, productGrants.productId],
      })
      .returning({ id: productGrants.id });
    return rows.length > 0;
  },
  listGrantedProducts: async (tenantId, memberId) =>
    db
      .select({
        id: products.id,
        tenantId: products.tenantId,
        title: products.title,
        description: products.description,
        priceCents: products.priceCents,
        currency: products.currency,
        published: products.published,
        createdAt: products.createdAt,
      })
      .from(productGrants)
      .innerJoin(
        products,
        and(eq(productGrants.productId, products.id), eq(products.tenantId, tenantId)),
      )
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.memberId, memberId)))
      .orderBy(asc(productGrants.createdAt)),
});

export const createPurchaseRepository = (db: Db): PurchaseRepository => ({
  createMemberGrant: async (input) =>
    db.transaction(async (tx) => {
      await tx
        .insert(members)
        .values({
          id: input.memberId,
          tenantId: input.tenantId,
          userId: input.userId,
          email: input.email,
          displayName: null,
          createdAt: input.createdAt,
        })
        .onConflictDoNothing({ target: [members.tenantId, members.userId] });

      const memberRows = await tx
        .select()
        .from(members)
        .where(and(eq(members.tenantId, input.tenantId), eq(members.userId, input.userId)))
        .limit(1);
      const member = memberRows[0];
      if (!member) throw new Error('Member create/read failed inside purchase transaction');

      const grantRows = await tx
        .insert(productGrants)
        .values({
          id: input.grantId,
          tenantId: input.tenantId,
          memberId: member.id,
          productId: input.productId,
          source: 'simulated',
          createdAt: input.createdAt,
        })
        .onConflictDoNothing({
          target: [productGrants.tenantId, productGrants.memberId, productGrants.productId],
        })
        .returning({ id: productGrants.id });

      return { member, grantCreated: grantRows.length > 0 };
    }),
});

export const createDevMagicLinkReader = (db: Db): DevMagicLinkReader => ({
  findByEmail: async (email) => {
    const rows = await db
      .select({ email: devMagicLinks.email, url: devMagicLinks.url, token: devMagicLinks.token })
      .from(devMagicLinks)
      .where(eq(devMagicLinks.email, email))
      .limit(1);
    return rows[0] ?? null;
  },
});

export const createTenantDomainRepository = (db: Db): TenantDomainRepository => ({
  findByDomain: async (domain) => {
    const rows = await db
      .select()
      .from(tenantDomains)
      .where(and(eq(tenantDomains.domain, domain), eq(tenantDomains.verified, true)))
      .limit(1);
    return rows[0] ?? null;
  },
  listVerifiedDomains: async () =>
    db.select().from(tenantDomains).where(eq(tenantDomains.verified, true)),
});

export const createTenantRepository = (db: Db): TenantRepository => ({
  findById: async (tenantId) => {
    const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return rows[0] ?? null;
  },
  findBySlug: async (slug) => {
    const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return rows[0] ?? null;
  },
  createTenantWithOwnerGrant: async (input) =>
    db.transaction(async (tx) => {
      await tx.insert(tenants).values(input.tenant);
      await tx.insert(tenantAdmins).values({
        id: input.ownerGrant.id,
        tenantId: input.tenant.id,
        userId: input.ownerGrant.userId,
        role: input.ownerGrant.staffRole,
      });
      return {
        id: input.tenant.id,
        slug: input.tenant.slug,
        name: input.tenant.name,
        contentVersion: 1,
      };
    }),
});

export const createTenantAccessReader = (db: Db): TenantAccessReader => {
  const baseQuery = () =>
    db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        contentVersion: tenants.contentVersion,
        staffRole: tenantAdmins.role,
      })
      .from(tenantAdmins)
      .innerJoin(tenants, eq(tenantAdmins.tenantId, tenants.id));

  const toMembership = (row: {
    id: string;
    slug: string;
    name: string;
    contentVersion: number;
    staffRole: string;
  }): Membership | null => {
    const staffRole = parseStaffRole(row.staffRole);
    return staffRole
      ? { tenant: { id: row.id, slug: row.slug, name: row.name, contentVersion: row.contentVersion }, staffRole }
      : null;
  };

  return {
    listTenantsForStaff: async (userId) => {
      const rows = await baseQuery().where(eq(tenantAdmins.userId, userId));
      const memberships: Membership[] = [];
      for (const row of rows) {
        const membership = toMembership(row);
        if (membership) memberships.push(membership);
      }
      return memberships;
    },
    findStaffGrant: async (userId, lookup) => {
      const tenantCondition =
        'tenantId' in lookup ? eq(tenants.id, lookup.tenantId) : eq(tenants.slug, lookup.tenantSlug);
      const rows = await baseQuery()
        .where(and(eq(tenantAdmins.userId, userId), tenantCondition))
        .limit(1);
      const row = rows[0];
      return row ? toMembership(row) : null;
    },
    findMember: async (userId, tenantId) => {
      const rows = await db
        .select()
        .from(members)
        .where(and(eq(members.userId, userId), eq(members.tenantId, tenantId)))
        .limit(1);
      return rows[0] ?? null;
    },
  };
};

export const createHealthPort = (db: Db): HealthPort => ({
  pingDatabase: async () => {
    try {
      await db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  },
});
