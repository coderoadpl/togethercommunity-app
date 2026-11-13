import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { err, internal, postSchema, type NotificationFanoutKind, type Product } from '#core/domain/index.js';
import type { NotificationChannelPort } from '#core/server/index.js';
import { notificationRecipient, spaceNotificationRecipient } from '#core/server/usecases/community-access.js';
import { subscriberCanAccessContext } from '#core/server/usecases/thread-context.js';
import { buildNotificationFanoutJob, runPostFanoutJob, type PostFanoutDeps } from '#core/server/usecases/notification-fanout.js';

import type { Db } from './client.js';
import { createNotificationFanoutBatchRepository } from './notification-fanout-batches.js';
import { createNotificationFanoutJobRepository } from './notification-fanout-jobs.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import { createEmailNotificationChannel } from '../notifications/email.js';
import {
  createCourseLessonRepository, createCourseModuleRepository, createCourseRepository,
  createMemberBlockRepository, createNotificationRepository, createPostRepository,
  createProductGrantRepository, createSpaceRepository, createSpaceSubscriptionRepository,
  createTenantAccessReader, createThreadSubscriptionRepository,
} from './repositories.js';
import { courses, courseModules, courseLessons, emailOutbox, emailEvents, members, productGrants, products, spaces, tenantAdmins, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-10-01T12:00:00.000Z';
const TENANT = 'fanout-tenant';
const OTHER = 'other-tenant';
const AUTHOR = 'author';
const userIds = [
  AUTHOR, 'active', 'no-grant', 'future', 'expired', 'boundary-start', 'boundary-end',
  'test-only', 'banned', 'deleted', 'absent', 'staff-absent', 'staff-banned', 'staff-deleted',
  'other-staff', 'muted', 'blocked', 'author-blocks', 'excluded', 'module-access', 'lesson-access', 'unexcluded',
];
let db: Db;
let close: (() => Promise<void>) | undefined;
let sequence = 0;

beforeAll(async () => {
  const database = await createTestDatabase('together_fanout_batches', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  db = database.db;
  close = database.close;
  await db.insert(tenants).values([TENANT, OTHER].map((id) => ({ id, slug: id, name: id, createdAt: NOW })));
  await db.insert(user).values(userIds.map((id) => ({ id, name: id, email: `${id}@auth.example.test` })));
  await db.insert(members).values(userIds.filter((id) => !['absent', 'staff-absent'].includes(id)).map((id) => ({
    id: `member-${id}`, tenantId: TENANT, userId: id, email: `${id}@member.example.test`, createdAt: NOW,
    language: 'pl' as const,
    bannedAt: id === 'banned' || id === 'staff-banned' ? NOW : null,
    deletedAt: id === 'deleted' || id === 'staff-deleted' ? NOW : null,
  })));
  await db.insert(tenantAdmins).values(['staff-absent', 'staff-banned', 'staff-deleted', 'other-staff'].map((id) => ({
    id: `staff-${id}`, tenantId: id === 'other-staff' ? OTHER : TENANT, userId: id, role: 'admin' as const,
  })));
  await db.insert(courses).values({ id: 'course', tenantId: TENANT, name: 'Course', description: '', moduleOrder: ['module'], createdAt: NOW });
  await db.insert(courseModules).values({
    id: 'module', tenantId: TENANT, courseIds: ['course'], title: 'Module',
    chapters: [{ id: 'chapter', name: 'Chapter', contents: [{ id: 'content', name: 'Lesson', lessonId: 'lesson' }] }],
    createdAt: NOW,
  });
  await db.insert(courseLessons).values({ id: 'lesson', tenantId: TENANT, name: 'Lesson', contents: [], createdAt: NOW });
  const accessByProduct: Array<{ id: string; accessItems: Product['accessItems'] }> = [
    { id: 'full', accessItems: [{ level: 'course', courseId: 'course' }] },
    { id: 'excluded', accessItems: [{ level: 'course', courseId: 'course', excludedModuleIds: ['module'] }] },
    { id: 'module', accessItems: [{ level: 'modules', courseId: 'course', moduleIds: ['module'] }] },
    { id: 'lesson', accessItems: [{ level: 'lessons', courseId: 'course', lessonIds: ['lesson'] }] },
  ];
  await db.insert(products).values(accessByProduct.map((product) => ({
    ...product, tenantId: TENANT, type: 'course' as const, slug: product.id, title: product.id,
    description: '', priceCents: 0, currency: 'PLN', published: true, createdAt: NOW,
  })));
  const grantees = userIds.filter((id) => !['absent', 'staff-absent', 'no-grant', 'other-staff'].includes(id));
  await db.insert(productGrants).values(grantees.map((id) => ({
    id: `grant-${id}`, tenantId: TENANT, memberId: `member-${id}`,
    productId: id === 'excluded' || id === 'unexcluded' ? 'excluded' : id === 'module-access' ? 'module' : id === 'lesson-access' ? 'lesson' : 'full',
    mode: id === 'test-only' ? 'test' as const : 'live' as const,
    source: 'manual' as const,
    startsAt: id === 'future' ? '2026-10-02T12:00:00.000Z' : id === 'boundary-start' ? NOW : '2026-09-01T12:00:00.000Z',
    expiresAt: id === 'expired' ? '2026-09-30T12:00:00.000Z' : id === 'boundary-end' ? NOW : null,
    createdAt: NOW,
  })));
  await db.insert(productGrants).values({
    id: 'grant-unexcluded-full', tenantId: TENANT, memberId: 'member-unexcluded', productId: 'full',
    mode: 'live', source: 'manual', startsAt: NOW, createdAt: NOW,
  });
  await db.insert(spaces).values(['members', 'product', 'archived'].map((id) => ({
    id, tenantId: TENANT, slug: id, name: id, visibility: id === 'product' ? 'product' as const : 'members' as const,
    productIds: id === 'product' ? ['full'] : [], archivedAt: id === 'archived' ? NOW : null, createdAt: NOW,
  })));
  const blocks = createMemberBlockRepository(db);
  await blocks.block(TENANT, { tenantId: TENANT, blockerUserId: 'blocked', blockedUserId: AUTHOR, createdAt: NOW });
  await blocks.block(TENANT, { tenantId: TENANT, blockerUserId: AUTHOR, blockedUserId: 'author-blocks', createdAt: NOW });
}, 60000);

afterAll(async () => { await close?.(); });

const deps = (): PostFanoutDeps => ({
  fanoutJobs: { claimDue: async () => [], save: async () => undefined },
  fanoutBatches: createNotificationFanoutBatchRepository(db),
  notifications: createNotificationRepository(db), notificationChannels: [],
  posts: createPostRepository(db), spaces: createSpaceRepository(db),
  spaceSubscriptions: createSpaceSubscriptionRepository(db), threadSubscriptions: createThreadSubscriptionRepository(db),
  memberBlocks: createMemberBlockRepository(db), courses: createCourseRepository(db),
  modules: createCourseModuleRepository(db), lessons: createCourseLessonRepository(db),
  grants: createProductGrantRepository(db), tenantAccess: createTenantAccessReader(db),
  tenants: { findSettings: async () => null }, ids: { nextId: () => `fanout-id-${++sequence}` },
  clock: { nowIso: () => NOW }, avatarSources: { listAvatarSources: async () => [] },
  links: {
    lessonDiscussionUrl: async () => 'https://example.test/lesson', spaceUrl: async () => 'https://example.test/space',
    conversationUrl: async () => 'https://example.test/messages', eventUrl: async () => 'https://example.test/event',
  },
});

const cases: Array<{ kind: NotificationFanoutKind; contextKind: 'space' | 'lesson'; contextId: string }> = [
  { kind: 'space-post', contextKind: 'space', contextId: 'members' },
  { kind: 'space-post', contextKind: 'space', contextId: 'product' },
  { kind: 'space-post', contextKind: 'space', contextId: 'archived' },
  { kind: 'thread-reply', contextKind: 'space', contextId: 'members' },
  { kind: 'thread-reply', contextKind: 'space', contextId: 'product' },
  { kind: 'thread-reply', contextKind: 'space', contextId: 'missing' },
  { kind: 'thread-reply', contextKind: 'lesson', contextId: 'lesson' },
  { kind: 'thread-reply', contextKind: 'lesson', contextId: 'missing' },
];

describe('set-based notification recipients', () => {
  it('atomically queues a lesson question and recovers a partially delivered batch without duplicate emails', async () => {
    const d = deps();
    d.fanoutJobs = createNotificationFanoutJobRepository(db);
    const post = postSchema.parse({
      id: 'question-retry', tenantId: TENANT, contextKind: 'lesson', contextId: 'lesson', parentPostId: null,
      rootPostId: 'question-retry', authorUserId: AUTHOR, authorDisplay: 'Author', authorIsStaff: false,
      body: 'Retry question', bodyFormat: 'plain', createdAt: NOW, editedAt: null, deletedAt: null,
    });
    const job = buildNotificationFanoutJob({
      id: 'question-retry-job', tenantId: TENANT, kind: 'lesson-question', sourceId: post.id,
      tenantName: 'Workspace', tenantSlug: null, authorDisplay: null, now: NOW,
    });
    const staffUserIds = (await d.tenantAccess.listStaffForTenant(TENANT)).map((staff) => staff.userId);
    await d.posts.createPost(TENANT, post, job, staffUserIds);
    expect((await d.threadSubscriptions.listSubscribersPage(TENANT, { rootPostId: post.id, afterUserId: null, limit: 50 }))
      .map((subscription) => subscription.userId).sort()).toEqual(staffUserIds.sort());
    const claimed = await d.fanoutJobs.claimDue({ now: NOW, limit: 1, leaseUntil: '2026-10-01T12:05:00.000Z' });
    expect(claimed).toEqual([expect.objectContaining({ kind: 'lesson-question', sourceKey: job.sourceKey })]);
    const first = claimed[0];
    if (first === undefined) throw new Error('Expected a persisted fan-out job');
    let fail = true;
    d.notificationChannels = [
      createEmailNotificationChannel(createEmailOutboxRepository(db), d.clock, () => undefined),
      { deliver: async () => {
        if (fail) { fail = false; return err(internal('channel unavailable')); }
        return { ok: true, value: undefined };
      } },
    ];
    expect((await runPostFanoutJob(first, d)).ok).toBe(false);
    const notifications = await d.fanoutBatches.listNotificationsForSource(TENANT, job.sourceKey, userIds);
    expect(notifications).toHaveLength(3);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
    const retries = await d.fanoutJobs.claimDue({ now: '2026-10-01T12:01:00.000Z', limit: 1, leaseUntil: '2026-10-01T12:06:00.000Z' });
    const retry = retries[0];
    if (retry === undefined) throw new Error('Expected a retryable job');
    expect(await runPostFanoutJob(retry, d)).toMatchObject({ ok: true, value: { created: 0, completed: true } });
    expect(await d.fanoutBatches.listNotificationsForSource(TENANT, job.sourceKey, userIds)).toEqual(notifications);
    expect((await db.select().from(emailOutbox)).map((row) => row.id).sort())
      .toEqual(notifications.map((row) => `notification:${row.id}`).sort());
    expect(await db.select().from(emailEvents)).toHaveLength(3);
    expect(await d.fanoutJobs.claimDue({ now: '2026-10-01T12:10:00.000Z', limit: 1, leaseUntil: '2026-10-01T12:15:00.000Z' })).toEqual([]);
  });

  it('completes a retry after a space rename while keeping the first queued email', async () => {
    const d = deps();
    d.fanoutJobs = createNotificationFanoutJobRepository(db);
    const spaceId = 'renamed-space';
    await db.insert(spaces).values({ id: spaceId, tenantId: TENANT, slug: spaceId, name: 'Original space', visibility: 'members', createdAt: NOW });
    await d.spaceSubscriptions.follow(TENANT, { userId: 'active', spaceId, createdAt: NOW });
    const post = postSchema.parse({
      id: 'space-rename-post', tenantId: TENANT, contextKind: 'space', contextId: spaceId, parentPostId: null,
      rootPostId: 'space-rename-post', authorUserId: AUTHOR, authorDisplay: 'Author', authorIsStaff: false,
      body: 'New post', bodyFormat: 'plain', createdAt: NOW, editedAt: null, deletedAt: null,
    });
    const job = buildNotificationFanoutJob({
      id: 'space-rename-job', tenantId: TENANT, kind: 'space-post', sourceId: post.id,
      tenantName: 'Workspace', tenantSlug: null, authorDisplay: null, now: NOW,
    });
    await d.posts.createPost(TENANT, post, job);
    const [first] = await d.fanoutJobs.claimDue({ now: NOW, limit: 1, leaseUntil: '2026-10-01T12:05:00.000Z' });
    if (first === undefined) throw new Error('Expected a persisted fan-out job');
    const deliver = vi.fn<NotificationChannelPort['deliver']>()
      .mockResolvedValueOnce(err(internal('channel unavailable')))
      .mockResolvedValue({ ok: true, value: undefined });
    d.notificationChannels = [
      createEmailNotificationChannel(createEmailOutboxRepository(db), d.clock, () => undefined),
      { deliver },
    ];
    expect((await runPostFanoutJob(first, d)).ok).toBe(false);
    const notifications = await d.fanoutBatches.listNotificationsForSource(TENANT, job.sourceKey, ['active']);
    expect(notifications).toHaveLength(1);
    const emailId = `notification:${notifications[0]?.id}`;
    const original = await db.select().from(emailOutbox).where(eq(emailOutbox.id, emailId));
    expect(original).toEqual([expect.objectContaining({ payload: expect.objectContaining({ spaceName: 'Original space' }) })]);
    const space = await d.spaces.findById(TENANT, spaceId);
    if (space === null) throw new Error('Expected the notification space');
    expect(await d.spaces.update(TENANT, { ...space, name: 'Renamed space' })).toMatchObject({ name: 'Renamed space' });
    const [retry] = await d.fanoutJobs.claimDue({ now: '2026-10-01T12:01:00.000Z', limit: 1, leaseUntil: '2026-10-01T12:06:00.000Z' });
    if (retry === undefined) throw new Error('Expected a retryable job');
    expect(await runPostFanoutJob(retry, d)).toMatchObject({ ok: true, value: { created: 0, completed: true } });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[1]?.[1]).toMatchObject({ contextName: 'Renamed space' });
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.id, emailId))).toEqual(original);
    expect(await db.select().from(emailEvents).where(eq(emailEvents.refId, emailId))).toEqual([
      expect.objectContaining({ type: 'queued' }),
    ]);
    expect(await d.fanoutJobs.claimDue({ now: '2026-10-01T12:10:00.000Z', limit: 1, leaseUntil: '2026-10-01T12:15:00.000Z' })).toEqual([]);
  });

  it('persists staff subscriptions before a reply overtakes the question delivery and keeps existing mutes', async () => {
    const d = deps();
    d.fanoutJobs = createNotificationFanoutJobRepository(db);
    const rootPostId = 'question-interleaved';
    const question = postSchema.parse({
      id: rootPostId, tenantId: TENANT, contextKind: 'lesson', contextId: 'lesson', parentPostId: null,
      rootPostId, authorUserId: AUTHOR, authorDisplay: 'Author', authorIsStaff: false,
      body: 'Question', bodyFormat: 'plain', createdAt: NOW, editedAt: null, deletedAt: null,
    });
    await d.threadSubscriptions.upsert(TENANT, { rootPostId, userId: 'staff-banned', createdAt: NOW });
    await d.threadSubscriptions.mute(TENANT, { rootPostId, userId: 'staff-banned', mutedAt: NOW });
    const questionJob = buildNotificationFanoutJob({
      id: 'interleaved-question-job', tenantId: TENANT, kind: 'lesson-question', sourceId: rootPostId,
      tenantName: 'Workspace', tenantSlug: null, authorDisplay: null, now: NOW,
    });
    const staffUserIds = (await d.tenantAccess.listStaffForTenant(TENANT)).map((staff) => staff.userId);
    await d.posts.createPost(TENANT, question, questionJob, staffUserIds);
    expect(await d.threadSubscriptions.listForUser(TENANT, { userId: 'staff-banned', rootPostIds: [rootPostId] }))
      .toEqual([expect.objectContaining({ mutedAt: NOW })]);
    const reply = { ...question, id: 'interleaved-reply', parentPostId: rootPostId, body: 'Reply' };
    const replyJob = buildNotificationFanoutJob({
      id: 'interleaved-reply-job', tenantId: TENANT, kind: 'thread-reply', sourceId: reply.id,
      tenantName: 'Workspace', tenantSlug: null, authorDisplay: null, now: NOW,
    });
    await d.posts.createPost(TENANT, reply, replyJob);
    expect(await runPostFanoutJob(replyJob, d)).toMatchObject({ ok: true, value: { created: 2, completed: true } });
    expect(await runPostFanoutJob(questionJob, d)).toMatchObject({ ok: true, value: { completed: true } });
    expect(await runPostFanoutJob(replyJob, d)).toMatchObject({ ok: true, value: { created: 0, completed: true } });
    expect((await d.fanoutBatches.listNotificationsForSource(TENANT, replyJob.sourceKey, userIds))
      .map((notification) => notification.recipientUserId)).toEqual(['staff-absent', 'staff-deleted']);
    expect(await d.threadSubscriptions.listForUser(TENANT, { userId: 'other-staff', rootPostIds: [rootPostId] })).toEqual([]);
    const rejected = { ...question, id: 'question-rollback', rootPostId: 'question-rollback' };
    await expect(d.posts.createPost(TENANT, rejected, {
      ...questionJob, sourceKey: 'lesson-question:question-rollback', payload: { ...questionJob.payload, postId: rejected.id },
    }, staffUserIds)).rejects.toThrow();
    expect(await d.posts.findById(TENANT, rejected.id)).toBeNull();
    expect(await d.threadSubscriptions.listSubscribersPage(TENANT, { rootPostId: rejected.id, afterUserId: null, limit: 50 })).toEqual([]);
  });

  it.each(cases)('matches the original per-recipient exclusions for $kind / $contextKind / $contextId', async (testCase) => {
    const d = deps();
    const id = `post-${testCase.kind}-${testCase.contextKind}-${testCase.contextId}`;
    const post = postSchema.parse({
      id, tenantId: TENANT, contextKind: testCase.contextKind, contextId: testCase.contextId,
      parentPostId: null, rootPostId: id, authorUserId: AUTHOR, authorDisplay: 'Author', authorIsStaff: false,
      body: 'Fixture post', bodyFormat: 'plain', createdAt: NOW, editedAt: null, deletedAt: null,
    });
    await d.posts.createPost(TENANT, post);
    const space = await d.spaces.findById(TENANT, post.contextId);
    for (const userId of userIds) {
      if (testCase.kind === 'space-post') {
        await d.spaceSubscriptions.follow(TENANT, { userId, spaceId: post.contextId, createdAt: NOW });
      } else {
        await d.threadSubscriptions.upsert(TENANT, { userId, rootPostId: id, createdAt: NOW });
        if (userId === 'muted') await d.threadSubscriptions.mute(TENANT, { userId, rootPostId: id, mutedAt: NOW });
      }
    }
    const directions = await d.memberBlocks.findDirections(TENANT, { viewerUserId: AUTHOR, otherUserIds: userIds });
    const expected: Array<{ userId: string; email: string | null; language: string | null }> = [];
    for (const userId of userIds) {
      if (userId === AUTHOR || directions.get(userId)?.blocksViewer === true) continue;
      if (testCase.kind === 'space-post') {
        if (space === null) continue;
        const recipient = await spaceNotificationRecipient(TENANT, userId, space, d);
        if (recipient !== null) expected.push({ userId, ...recipient });
      } else {
        if (userId === 'muted') continue;
        const recipient = await notificationRecipient(TENANT, userId, d);
        if (recipient === null) continue;
        if (recipient.isStaff || (recipient.memberId !== null && await subscriberCanAccessContext(TENANT, recipient.memberId, post, d))) {
          expected.push({ userId, email: recipient.email, language: recipient.language });
        }
      }
    }
    const actual: typeof expected = [];
    d.notificationChannels = [{ deliver: async (notification, context) => {
      actual.push({ userId: notification.recipientUserId, email: context.recipientEmail, language: context.language });
      return { ok: true, value: undefined };
    } }];
    const job = buildNotificationFanoutJob({ id: `job-${id}`, tenantId: TENANT, kind: testCase.kind, sourceId: id, tenantName: 'Workspace', tenantSlug: null, authorDisplay: null, now: NOW });
    expect((await runPostFanoutJob(job, d, { batchSize: 5 })).ok).toBe(true);
    expect(actual.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual(expected
      .map((recipient) => ({ ...recipient, language: recipient.language ?? 'en' }))
      .sort((a, b) => a.userId.localeCompare(b.userId)));
  });

  it('uses three eligibility reads regardless of the number of recipients and scopes them to the tenant', async () => {
    const batches = createNotificationFanoutBatchRepository(db);
    const select = vi.spyOn(db, 'select');
    await batches.listAccessForUsers(TENANT, ['active'], NOW);
    expect(select).toHaveBeenCalledTimes(3);
    select.mockClear();
    const rows = await batches.listAccessForUsers(TENANT, userIds, NOW);
    expect(select).toHaveBeenCalledTimes(3);
    expect(rows.find((row) => row.userId === 'other-staff')?.isStaff).toBe(false);
    expect(rows.find((row) => row.userId === 'boundary-start')?.activeProductIds).toEqual(['full']);
    expect(rows.find((row) => row.userId === 'boundary-end')?.activeProductIds).toEqual(['full']);
    expect(rows.find((row) => row.userId === 'test-only')?.activeProductIds).toEqual([]);
    const otherRows = await batches.listAccessForUsers(OTHER, userIds, NOW);
    expect(otherRows.every((row) => row.member === null && row.activeProductIds.length === 0)).toBe(true);
    select.mockRestore();
  });

  it('pages the same staff recipients as the original rule and preserves an explicit mute when subscriptions are retried', async () => {
    const d = deps();
    const expected = await d.tenantAccess.listStaffForTenant(TENANT);
    const first = await d.fanoutBatches.listStaffPage(TENANT, { afterUserId: null, limit: 2 });
    const second = await d.fanoutBatches.listStaffPage(TENANT, { afterUserId: first.at(-1)?.userId ?? null, limit: 2 });
    expect([...first, ...second]).toEqual(expected.map(({ userId, email, language }) => ({ userId, email, language }))
      .sort((a, b) => a.userId.localeCompare(b.userId)));
    const rootPostId = 'staff-question';
    await d.posts.createPost(TENANT, postSchema.parse({
      id: rootPostId, tenantId: TENANT, contextKind: 'lesson', contextId: 'lesson', parentPostId: null,
      rootPostId, authorUserId: AUTHOR, authorDisplay: 'Author', authorIsStaff: false,
      body: 'Staff question', bodyFormat: 'plain', createdAt: NOW, editedAt: null, deletedAt: null,
    }));
    const input = { rootPostId, userIds: ['staff-absent'], createdAt: NOW };
    await d.fanoutBatches.subscribeStaff(TENANT, input);
    await d.threadSubscriptions.mute(TENANT, { rootPostId, userId: 'staff-absent', mutedAt: NOW });
    await d.fanoutBatches.subscribeStaff(TENANT, input);
    expect(await d.threadSubscriptions.listForUser(TENANT, { userId: 'staff-absent', rootPostIds: [rootPostId] }))
      .toEqual([expect.objectContaining({ mutedAt: NOW })]);
    expect(await d.fanoutBatches.listNotificationsForSource(OTHER, 'thread-reply:post-thread-reply-lesson-lesson', userIds)).toEqual([]);
  });
});
