import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Identity, Notification } from '#core/domain/index.js';
import { listChangeProposals, type Ctx } from '#core/server/index.js';

import { createChangeProposalGroupRepository } from './change-proposal-groups.js';
import { createChangeProposalOwnerNotifier, createChangeProposalPeopleReader } from './change-proposal-people.js';
import { createChangeProposalRepository, createChangeProposalTargetLabelReader } from './change-proposals.js';
import type { Db } from './client.js';
import * as schema from './schema.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-03-01T10:00:00.000Z';
const DIRECT = 't-people-direct';
const MANAGED = 't-people-managed';
const ORGANIZATION = 'org-people';

let close: (() => Promise<void>) | undefined;
let pool: pg.Pool;
let db: Db;
const reads: string[] = [];

const person = (id: string) => ({ id, email: `${id}@example.test`, name: id, emailVerified: true });

const owner = (tenantId: string, userId: string): Ctx => {
  const identity: Identity = {
    userId, email: `${userId}@example.test`, name: userId, emailVerified: true, tenantAccess: 'staff',
    tenantId, tenantSlug: tenantId, tenantName: tenantId, staffRole: 'owner', memberId: null, image: null,
    memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  };
  return { identity };
};

const notification = (tenantId: string, recipientUserId: string, id: string): Notification => ({
  id, tenantId, recipientUserId, kind: 'change-proposal',
  payload: {
    rootPostId: null, postId: null, contextKind: 'tenant', contextId: null, courseId: null, eventId: null, domain: null,
    lessonName: '', authorDisplay: 'Catalogue agent', authorAvatarUrl: null, snippet: '',
  },
  sourceKey: 'change-proposal:key-people', readAt: null, createdAt: NOW,
});

beforeAll(async () => {
  const database = await createTestDatabase('together_change_proposal_people', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  close = database.close;
  pool = new pg.Pool({ connectionString: database.url });
  db = drizzle(pool, { schema, logger: { logQuery: (query) => { if (query.startsWith('select ')) reads.push(query); } } });
  await db.insert(schema.user).values(['direct-owner', 'direct-admin', 'org-owner', 'org-admin', 'org-owner-direct-admin', 'outsider'].map(person));
  await db.insert(schema.organizations).values({ id: ORGANIZATION, slug: 'people', name: 'People', createdAt: NOW, updatedAt: NOW });
  await db.insert(schema.tenants).values([
    { id: DIRECT, slug: DIRECT, name: 'Direct', createdAt: NOW },
    { id: MANAGED, slug: MANAGED, name: 'Managed', organizationId: ORGANIZATION, createdAt: NOW },
  ]);
  await db.insert(schema.tenantAdmins).values([
    { id: 'grant-direct-owner', tenantId: DIRECT, userId: 'direct-owner', role: 'owner' },
    { id: 'grant-direct-admin', tenantId: DIRECT, userId: 'direct-admin', role: 'admin' },
    { id: 'grant-managed-admin', tenantId: MANAGED, userId: 'org-owner-direct-admin', role: 'admin' },
  ]);
  await db.insert(schema.organizationMembers).values([
    { id: 'member-owner', organizationId: ORGANIZATION, userId: 'org-owner', role: 'owner', createdAt: NOW, createdByUserId: 'org-owner' },
    { id: 'member-admin', organizationId: ORGANIZATION, userId: 'org-admin', role: 'admin', createdAt: NOW, createdByUserId: 'org-owner' },
    { id: 'member-owner-direct-admin', organizationId: ORGANIZATION, userId: 'org-owner-direct-admin', role: 'owner', createdAt: NOW, createdByUserId: 'org-owner' },
  ]);
});

afterAll(async () => {
  await pool?.end();
  await close?.();
});

describe('the change proposal owner notifier', () => {
  const recipients = async (tenantId: string) =>
    (await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, tenantId)).orderBy(asc(schema.notifications.recipientUserId)))
      .map((row) => row.recipientUserId);

  it('rings the direct owners of a workspace and no admin', async () => {
    let sequence = 0;
    const raised = await createChangeProposalOwnerNotifier(db).raiseForOwners(DIRECT, (userId) => notification(DIRECT, userId, `direct-${String(++sequence)}`), 'raise');
    expect(raised).toMatchObject({ kind: 'written', value: [{ recipientUserId: 'direct-owner' }] });
    expect(await recipients(DIRECT)).toEqual(['direct-owner']);
  });

  it('rings the owners an active organisation derives for a managed workspace, a higher derived role over a direct admin row included', async () => {
    let sequence = 0;
    const raised = await createChangeProposalOwnerNotifier(db).raiseForOwners(MANAGED, (userId) => notification(MANAGED, userId, `managed-${String(++sequence)}`), 'raise');
    expect(raised.kind === 'written' ? raised.value.map((row) => row.recipientUserId) : raised.kind).toEqual(['org-owner', 'org-owner-direct-admin']);
    expect(await recipients(MANAGED)).toEqual(['org-owner', 'org-owner-direct-admin']);
  });

  it('rings nobody through a suspended organisation', async () => {
    await db.delete(schema.notifications).where(eq(schema.notifications.tenantId, MANAGED));
    await db.update(schema.organizations).set({ status: 'suspended' }).where(eq(schema.organizations.id, ORGANIZATION));
    try {
      expect(await createChangeProposalOwnerNotifier(db).raiseForOwners(MANAGED, (userId) => notification(MANAGED, userId, `suspended-${userId}`), 'raise'))
        .toEqual({ kind: 'written', value: [] });
    } finally {
      await db.update(schema.organizations).set({ status: 'active' }).where(eq(schema.organizations.id, ORGANIZATION));
    }
  });
});

describe('the owner notice modes', () => {
  const notice = async (id: string, mode: 'raise' | 'signal') => {
    const answered = await createChangeProposalOwnerNotifier(db).raiseForOwners(DIRECT, (userId) => notification(DIRECT, userId, id), mode);
    if (answered.kind !== 'written') throw new Error('the notifier ran out of time');
    return answered.value.map(({ id: answeredId, readAt }) => ({ id: answeredId, read: readAt !== null }));
  };
  const stored = async () =>
    (await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, DIRECT))).map(({ id, readAt }) => ({ id, read: readAt !== null }));

  it('answers the notification an owner already has instead of writing a second one, and makes a read one unread only on raise', async () => {
    await db.delete(schema.notifications).where(eq(schema.notifications.tenantId, DIRECT));
    expect(await notice('mode-1', 'signal')).toEqual([{ id: 'mode-1', read: false }]);
    expect(await notice('mode-2', 'raise')).toEqual([{ id: 'mode-1', read: false }]);
    expect(await notice('mode-3', 'signal')).toEqual([{ id: 'mode-1', read: false }]);
    expect(await stored()).toEqual([{ id: 'mode-1', read: false }]);

    await db.update(schema.notifications).set({ readAt: NOW }).where(eq(schema.notifications.tenantId, DIRECT));
    expect(await notice('mode-4', 'signal')).toEqual([{ id: 'mode-1', read: true }]);
    expect(await stored()).toEqual([{ id: 'mode-1', read: true }]);
    expect(await notice('mode-5', 'raise')).toEqual([{ id: 'mode-5', read: false }]);
    expect(await stored()).toEqual([{ id: 'mode-5', read: false }]);
  });

  it('carries its bound as the deadline the submission waits for it', () => {
    expect(createChangeProposalOwnerNotifier(db, { notificationMs: 250 }).deadlineMs).toBe(250);
    expect(createChangeProposalOwnerNotifier(db).deadlineMs).toBe(500);
  });
});

describe('the change proposal people reader', () => {
  it('reads the e-mail and the effective grant of direct, organisation-derived and former staff in one query', async () => {
    reads.length = 0;
    const people = await createChangeProposalPeopleReader(db).read(MANAGED, ['org-owner', 'org-admin', 'org-owner-direct-admin', 'outsider', 'deleted-account']);
    expect(reads).toHaveLength(1);
    expect(people.toSorted((left, right) => left.userId.localeCompare(right.userId))).toEqual([
      { userId: 'org-admin', email: 'org-admin@example.test', emailVerified: true, staffRole: 'admin' },
      { userId: 'org-owner', email: 'org-owner@example.test', emailVerified: true, staffRole: 'owner' },
      { userId: 'org-owner-direct-admin', email: 'org-owner-direct-admin@example.test', emailVerified: true, staffRole: 'owner' },
      { userId: 'outsider', email: 'outsider@example.test', emailVerified: true, staffRole: null },
    ]);
  });
});

describe('a person whose grant is in another workspace', () => {
  it('has no grant and no e-mail on the owner view of this workspace', async () => {
    const people = await createChangeProposalPeopleReader(db).read(MANAGED, ['direct-owner', 'direct-admin']);
    expect(people.map(({ userId, staffRole }) => ({ userId, staffRole })).toSorted((left, right) => left.userId.localeCompare(right.userId))).toEqual([
      { userId: 'direct-admin', staffRole: null },
      { userId: 'direct-owner', staffRole: null },
    ]);

    await db.insert(schema.changeProposals).values({
      id: 'proposal-foreign-grant', tenantId: MANAGED, operation: 'product.update', input: { id: 'product-gone', title: 'Renamed' }, effect: {},
      targetKind: 'product', targetId: 'product-gone', status: 'rejected', proposedByKeyId: 'key-people', proposedByKeyName: 'Catalogue agent',
      proposedByIssuerUserId: 'direct-owner', createdAt: NOW, expiresAt: '2026-03-31T10:00:00.000Z', decidedByUserId: 'direct-admin', decidedAt: NOW,
    });
    const listed = await listChangeProposals(owner(MANAGED, 'org-owner'), { limit: 10 }, {
      changeProposals: createChangeProposalRepository(db),
      changeProposalGroups: createChangeProposalGroupRepository(db),
      shopManagementKeys: createShopManagementKeyRepository(db),
      changeProposalTargetLabels: createChangeProposalTargetLabelReader(db),
      changeProposalPeople: createChangeProposalPeopleReader(db),
      clock: { nowIso: () => NOW },
    });

    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.proposals.find(({ id }) => id === 'proposal-foreign-grant')).toMatchObject({
      proposedBy: { issuerEmail: null, issuerIsVerifiedOwner: false, issuerIsFormerTeamMember: true },
      decidedByEmail: null,
      decidedByIsFormerTeamMember: true,
    });
  });
});

describe('the owner list identities of a full page', () => {
  const PAGE_TENANT = 't-people-page';

  const seedPage = async (size: number, prefix: string) => {
    const users = Array.from({ length: size * 2 }, (_, index) => person(`${prefix}-user-${String(index)}`));
    await db.insert(schema.user).values(users);
    await db.insert(schema.tenantAdmins).values(users.map((user, index) => ({
      id: `${prefix}-grant-${String(index)}`, tenantId: PAGE_TENANT, userId: user.id, role: index % 2 === 0 ? 'owner' as const : 'admin' as const,
    })));
    await db.insert(schema.changeProposals).values(Array.from({ length: size }, (_, index) => ({
      id: `${prefix}-proposal-${String(index).padStart(3, '0')}`, tenantId: PAGE_TENANT, operation: 'product.update',
      input: { id: 'product-gone', title: 'Renamed' }, effect: {}, targetKind: 'product' as const, targetId: 'product-gone',
      status: 'rejected' as const, proposedByKeyId: 'key-people', proposedByKeyName: 'Catalogue agent',
      proposedByIssuerUserId: `${prefix}-user-${String(index * 2)}`, createdAt: NOW, expiresAt: '2026-03-31T10:00:00.000Z',
      decidedByUserId: `${prefix}-user-${String(index * 2 + 1)}`, decidedAt: NOW,
    })));
  };

  const deps = () => ({
    changeProposals: createChangeProposalRepository(db),
    changeProposalGroups: createChangeProposalGroupRepository(db),
    shopManagementKeys: createShopManagementKeyRepository(db),
    changeProposalTargetLabels: createChangeProposalTargetLabelReader(db),
    changeProposalPeople: createChangeProposalPeopleReader(db),
    clock: { nowIso: () => NOW },
  });

  beforeAll(async () => {
    await db.insert(schema.tenants).values({ id: PAGE_TENANT, slug: PAGE_TENANT, name: 'Page', createdAt: NOW });
    await seedPage(100, 'page');
  });

  it('reads 200 distinct issuers and deciders of a 100-item page in a fixed number of queries', async () => {
    reads.length = 0;
    const listed = await listChangeProposals(owner(PAGE_TENANT, 'page-user-0'), { limit: 100 }, deps());
    const queries = reads.length;

    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.proposals).toHaveLength(100);
    expect(listed.value.proposals.every((card) => card.proposedBy.issuerIsVerifiedOwner && card.decidedByEmail !== null)).toBe(true);
    expect(queries).toBeLessThanOrEqual(5);

    reads.length = 0;
    const small = await listChangeProposals(owner(PAGE_TENANT, 'page-user-0'), { limit: 2 }, deps());
    expect(small.ok && small.value.proposals).toHaveLength(2);
    expect(reads).toHaveLength(queries);
  });
});
