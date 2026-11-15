import { and, asc, desc, eq } from 'drizzle-orm';

import {
  organizationAuditEventSchema,
  organizationMemberAccountSchema,
  organizationMemberSchema,
  organizationSchema,
} from '#core/domain/index.js';
import type {
  OrganizationAuditRepository,
  OrganizationMemberRepository,
  OrganizationRepository,
} from '#core/server/index.js';

import { user } from './auth-schema.js';
import type { Db } from './client.js';
import { organizationAuditEvents, organizationMembers, organizations } from './organization-schema.js';

export const createOrganizationRepository = (db: Db): OrganizationRepository => ({
  create: async (organization) => {
    const rows = await db.insert(organizations).values(organization)
      .onConflictDoNothing({ target: organizations.slug }).returning();
    return rows[0] === undefined ? null : organizationSchema.parse(rows[0]);
  },
  createWithOwner: async ({ organization, owner, audit }) => db.transaction(async (tx) => {
    const verifiedOwner = await tx.select({ id: user.id }).from(user)
      .where(and(eq(user.id, owner.userId), eq(user.emailVerified, true))).for('share');
    if (verifiedOwner.length !== 1) return { status: 'owner_unverified' } as const;
    const inserted = await tx.insert(organizations).values(organization)
      .onConflictDoNothing({ target: organizations.slug }).returning();
    if (inserted[0] !== undefined) {
      await tx.insert(organizationMembers).values({ ...owner, organizationId: organization.id });
      if (audit.length > 0) {
        await tx.insert(organizationAuditEvents).values(audit.map((event) => ({ ...event, organizationId: organization.id })));
      }
      return { status: 'created', organization: organizationSchema.parse(inserted[0]) } as const;
    }
    const existing = await tx.select().from(organizations).where(eq(organizations.slug, organization.slug)).limit(1);
    if (existing[0] === undefined) return { status: 'conflict' } as const;
    const ownerRows = await tx.select({ id: organizationMembers.id }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, existing[0].id),
      eq(organizationMembers.userId, owner.userId),
      eq(organizationMembers.role, 'owner'),
    )).limit(1);
    return ownerRows.length === 1
      ? { status: 'existing', organization: organizationSchema.parse(existing[0]) } as const
      : { status: 'conflict' } as const;
  }),
  findById: async (organizationId) => {
    const rows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    return rows[0] === undefined ? null : organizationSchema.parse(rows[0]);
  },
  findBySlug: async (slug) => {
    const rows = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return rows[0] === undefined ? null : organizationSchema.parse(rows[0]);
  },
  setMaxWorkspaces: async (organizationId, { maxWorkspaces, updatedAt, audit }) => db.transaction(async (tx) => {
    const rows = await tx.update(organizations).set({ maxWorkspaces, updatedAt })
      .where(eq(organizations.id, organizationId)).returning();
    if (rows[0] === undefined) return null;
    await tx.insert(organizationAuditEvents).values({ ...audit, organizationId });
    return organizationSchema.parse(rows[0]);
  }),
});

export const createOrganizationMemberRepository = (db: Db): OrganizationMemberRepository => ({
  add: async (organizationId, member) => {
    const rows = await db.insert(organizationMembers).values({ ...member, organizationId })
      .onConflictDoNothing({ target: [organizationMembers.organizationId, organizationMembers.userId] })
      .returning({ id: organizationMembers.id });
    return rows.length > 0;
  },
  find: async (organizationId, userId) => {
    const rows = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
      .limit(1);
    return rows[0] === undefined ? null : organizationMemberSchema.parse(rows[0]);
  },
  list: async (organizationId) => (await db.select().from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id)))
    .map((row) => organizationMemberSchema.parse(row)),
  listAccounts: async (organizationId) => (await db.select({
    userId: organizationMembers.userId,
    email: user.email,
    role: organizationMembers.role,
    createdAt: organizationMembers.createdAt,
  }).from(organizationMembers)
    .innerJoin(user, eq(user.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id)))
    .map((row) => organizationMemberAccountSchema.parse(row)),
  listForUser: async (userId) => (await db.select().from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizationMembers.organizationId)))
    .map((row) => organizationMemberSchema.parse(row)),
});

export const createOrganizationAuditRepository = (db: Db): OrganizationAuditRepository => ({
  record: async (organizationId, event) => {
    await db.insert(organizationAuditEvents).values({ ...event, organizationId });
  },
  list: async (organizationId, query) => (await db.select().from(organizationAuditEvents)
    .where(eq(organizationAuditEvents.organizationId, organizationId))
    .orderBy(desc(organizationAuditEvents.at), desc(organizationAuditEvents.id))
    .limit(query.limit))
    .map((row) => organizationAuditEventSchema.parse(row)),
});
