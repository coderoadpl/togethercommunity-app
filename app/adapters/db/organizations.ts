import { and, asc, desc, eq } from 'drizzle-orm';

import {
  organizationAuditEventSchema,
  organizationMemberSchema,
  organizationSchema,
} from '#core/domain/index.js';
import type {
  OrganizationAuditRepository,
  OrganizationMemberRepository,
  OrganizationRepository,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { organizationAuditEvents, organizationMembers, organizations } from './organization-schema.js';

export const createOrganizationRepository = (db: Db): OrganizationRepository => ({
  create: async (organization) => {
    const rows = await db.insert(organizations).values(organization)
      .onConflictDoNothing({ target: organizations.slug }).returning();
    return rows[0] === undefined ? null : organizationSchema.parse(rows[0]);
  },
  findById: async (organizationId) => {
    const rows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    return rows[0] === undefined ? null : organizationSchema.parse(rows[0]);
  },
  findBySlug: async (slug) => {
    const rows = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return rows[0] === undefined ? null : organizationSchema.parse(rows[0]);
  },
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
