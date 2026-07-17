import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  computeCourseModuleName,
  courseLessonSchema,
  courseModuleSchema,
  courseSchema,
  entityHistoryEntrySchema,
  memberCourseProgressSchema,
  memberGrantSchema,
  notificationSchema,
  postSchema,
  productGrantSchema,
  processedPaymentEventSchema,
  productSchema,
  snapshotPayloadsEqual,
  staffRoleSchema,
  tenantApiKeySchema,
  tenantSecretSchema,
  type Course,
  type CourseLesson,
  type CourseModule,
  type MemberCourseProgress,
  type MemberGrant,
  type Membership,
  type Notification,
  type Post,
  type PostSearchHit,
  type Product,
  type ProductGrant,
  type ProcessedPaymentEvent,
  type StaffRole,
  type TenantApiKey,
  type TenantSecret,
  type TenantSettings,
} from '@core/domain/index.js';
import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  DevEmailReader,
  DevMagicLinkReader,
  EntityVersionRecord,
  EntityVersionRepository,
  HealthPort,
  MemberRepository,
  MemberCourseProgressRepository,
  NotificationRepository,
  PostRepository,
  PurchaseRepository,
  ProductGrantRepository,
  ProcessedPaymentEventRepository,
  ProductRepository,
  TenantAccessReader,
  TenantApiKeyRepository,
  TenantDomainRepository,
  TenantRepository,
  TenantSecretRepository,
  ThreadSubscriptionRepository,
} from '@core/server/index.js';

import type { Db } from './client.js';
import {
  courseLessons,
  courseModules,
  courses,
  devEmails,
  devMagicLinks,
  entityVersions,
  memberCourseProgress,
  members,
  notifications,
  posts,
  productGrants,
  processedPaymentEvents,
  products,
  tenantAdmins,
  tenantApiKeys,
  tenantDomains,
  tenantSecrets,
  tenants,
  threadSubscriptions,
} from './schema.js';

const parseStaffRole = (raw: string): StaffRole | null => {
  const parsed = staffRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const parseProduct = (product: Product): Product => productSchema.parse(product);

const parseGrant = (grant: ProductGrant): ProductGrant => productGrantSchema.parse(grant);

const parseProcessedPaymentEvent = (event: ProcessedPaymentEvent): ProcessedPaymentEvent =>
  processedPaymentEventSchema.parse(event);

const parseLesson = (
  lesson: Omit<CourseLesson, 'durationMinutes'> & { durationMinutes: number | null },
): CourseLesson =>
  courseLessonSchema.parse({ ...lesson, durationMinutes: lesson.durationMinutes ?? undefined });

const parseModule = (module: Omit<CourseModule, 'name'>): CourseModule =>
  courseModuleSchema.parse({
    ...module,
    name: computeCourseModuleName(module.prefix, module.title),
  });

const parseCourse = (course: Course): Course => courseSchema.parse(course);

const parseProgress = (progress: MemberCourseProgress): MemberCourseProgress =>
  memberCourseProgressSchema.parse(progress);

const parseMemberGrant = (grant: MemberGrant): MemberGrant => memberGrantSchema.parse(grant);

const parsePost = (post: typeof posts.$inferSelect): Post => postSchema.parse(post);

const parseNotification = (notification: typeof notifications.$inferSelect): Notification =>
  notificationSchema.parse(notification);

const parseApiKey = (apiKey: TenantApiKey): TenantApiKey => tenantApiKeySchema.parse(apiKey);

const parseSecret = (row: typeof tenantSecrets.$inferSelect): TenantSecret =>
  tenantSecretSchema.parse(row);

/**
 * Writes a previous-state snapshot into `entity_versions`. Runs on whichever
 * executor (`db` or a `tx`) is passed so the write-through path is atomic with
 * the mutation that supersedes it.
 */
const insertEntityVersion = async (executor: Db, tenantId: string, version: EntityVersionRecord): Promise<void> => {
  const latest = await executor
    .select({ schemaVersion: entityVersions.schemaVersion, payload: entityVersions.payload })
    .from(entityVersions)
    .where(
      and(
        eq(entityVersions.tenantId, tenantId),
        eq(entityVersions.entityKind, version.entityKind),
        eq(entityVersions.entityId, version.entityId),
      ),
    )
    .orderBy(desc(entityVersions.createdAt))
    .limit(1);
  const latestRow = latest[0];
  if (
    latestRow &&
    latestRow.schemaVersion === version.schemaVersion &&
    snapshotPayloadsEqual(latestRow.payload, version.payload)
  ) {
    return;
  }
  await executor.insert(entityVersions).values({
    id: version.id,
    tenantId,
    entityKind: version.entityKind,
    entityId: version.entityId,
    schemaVersion: version.schemaVersion,
    payload: version.payload,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  });
};

export const createProductRepository = (db: Db): ProductRepository => ({
  listByTenant: async (tenantId) =>
    (await db.select().from(products).where(eq(products.tenantId, tenantId)).orderBy(asc(products.createdAt))).map(
      parseProduct,
    ),
  listPublishedByTenant: async (tenantId) =>
    (
      await db
        .select()
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.published, true)))
        .orderBy(asc(products.createdAt))
    ).map(parseProduct),
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parseProduct(row) : null;
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
      accessItems: product.accessItems,
      legacyId: product.legacyId,
      createdAt: product.createdAt,
    });
  },
  updateAccessItems: async (tenantId, id, accessItems, version) => {
    const apply = async (executor: Db): Promise<Product | null> => {
      const rows = await executor
        .update(products)
        .set({ accessItems })
        .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
        .returning();
      const row = rows[0];
      return row ? parseProduct(row) : null;
    };
    if (!version) return apply(db);
    return db.transaction(async (tx) => {
      await insertEntityVersion(tx, tenantId, version);
      return apply(tx);
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

export const createCourseRepository = (db: Db): CourseRepository => ({
  list: async (tenantId) =>
    (await db.select().from(courses).where(eq(courses.tenantId, tenantId)).orderBy(asc(courses.createdAt))).map(
      parseCourse,
    ),
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(courses)
      .where(and(eq(courses.tenantId, tenantId), eq(courses.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parseCourse(row) : null;
  },
  findByIds: async (tenantId, ids) => {
    if (ids.length === 0) return [];
    return (
      await db
        .select()
        .from(courses)
        .where(and(eq(courses.tenantId, tenantId), inArray(courses.id, ids)))
    ).map(parseCourse);
  },
  create: async (tenantId, course) => {
    await db.insert(courses).values({ ...course, tenantId });
  },
  update: async (tenantId, course, version) => {
    const apply = async (executor: Db): Promise<Course | null> => {
      const rows = await executor
        .update(courses)
        .set({
          name: course.name,
          description: course.description,
          imageUrl: course.imageUrl,
          moduleOrder: course.moduleOrder,
          legacyId: course.legacyId,
        })
        .where(and(eq(courses.tenantId, tenantId), eq(courses.id, course.id)))
        .returning();
      const row = rows[0];
      return row ? parseCourse(row) : null;
    };
    if (!version) return apply(db);
    return db.transaction(async (tx) => {
      await insertEntityVersion(tx, tenantId, version);
      return apply(tx);
    });
  },
  delete: async (tenantId, id) => {
    const rows = await db
      .delete(courses)
      .where(and(eq(courses.tenantId, tenantId), eq(courses.id, id)))
      .returning({ id: courses.id });
    return rows.length > 0;
  },
});

export const createCourseModuleRepository = (db: Db): CourseModuleRepository => ({
  list: async (tenantId) =>
    (
      await db
        .select()
        .from(courseModules)
        .where(eq(courseModules.tenantId, tenantId))
        .orderBy(asc(courseModules.createdAt))
    ).map(parseModule),
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(courseModules)
      .where(and(eq(courseModules.tenantId, tenantId), eq(courseModules.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parseModule(row) : null;
  },
  findByIds: async (tenantId, ids) => {
    if (ids.length === 0) return [];
    return (
      await db
        .select()
        .from(courseModules)
        .where(and(eq(courseModules.tenantId, tenantId), inArray(courseModules.id, ids)))
    ).map(parseModule);
  },
  create: async (tenantId, module) => {
    await db.insert(courseModules).values({
      id: module.id,
      tenantId,
      courseIds: module.courseIds,
      title: module.title,
      prefix: module.prefix,
      chapters: module.chapters,
      legacyId: module.legacyId,
      createdAt: module.createdAt,
    });
  },
  update: async (tenantId, module, version) => {
    const apply = async (executor: Db): Promise<CourseModule | null> => {
      const rows = await executor
        .update(courseModules)
        .set({
          courseIds: module.courseIds,
          title: module.title,
          prefix: module.prefix,
          chapters: module.chapters,
          legacyId: module.legacyId,
        })
        .where(and(eq(courseModules.tenantId, tenantId), eq(courseModules.id, module.id)))
        .returning();
      const row = rows[0];
      return row ? parseModule(row) : null;
    };
    if (!version) return apply(db);
    return db.transaction(async (tx) => {
      await insertEntityVersion(tx, tenantId, version);
      return apply(tx);
    });
  },
  delete: async (tenantId, id) => {
    const rows = await db
      .delete(courseModules)
      .where(and(eq(courseModules.tenantId, tenantId), eq(courseModules.id, id)))
      .returning({ id: courseModules.id });
    return rows.length > 0;
  },
});

export const createCourseLessonRepository = (db: Db): CourseLessonRepository => ({
  list: async (tenantId) =>
    (
      await db
        .select()
        .from(courseLessons)
        .where(eq(courseLessons.tenantId, tenantId))
        .orderBy(asc(courseLessons.createdAt))
    ).map(parseLesson),
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(courseLessons)
      .where(and(eq(courseLessons.tenantId, tenantId), eq(courseLessons.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parseLesson(row) : null;
  },
  findByIds: async (tenantId, ids) => {
    if (ids.length === 0) return [];
    return (
      await db
        .select()
        .from(courseLessons)
        .where(and(eq(courseLessons.tenantId, tenantId), inArray(courseLessons.id, ids)))
    ).map(parseLesson);
  },
  create: async (tenantId, lesson) => {
    await db.insert(courseLessons).values({ ...lesson, tenantId });
  },
  update: async (tenantId, lesson, version) => {
    const apply = async (executor: Db): Promise<CourseLesson | null> => {
      const rows = await executor
        .update(courseLessons)
        .set({
          name: lesson.name,
          contents: lesson.contents,
          durationMinutes: lesson.durationMinutes ?? null,
          legacyId: lesson.legacyId,
        })
        .where(and(eq(courseLessons.tenantId, tenantId), eq(courseLessons.id, lesson.id)))
        .returning();
      const row = rows[0];
      return row ? parseLesson(row) : null;
    };
    if (!version) return apply(db);
    return db.transaction(async (tx) => {
      await insertEntityVersion(tx, tenantId, version);
      return apply(tx);
    });
  },
  delete: async (tenantId, id) => {
    const rows = await db
      .delete(courseLessons)
      .where(and(eq(courseLessons.tenantId, tenantId), eq(courseLessons.id, id)))
      .returning({ id: courseLessons.id });
    return rows.length > 0;
  },
});

export const createEntityVersionRepository = (db: Db): EntityVersionRepository => ({
  list: async (tenantId, query) =>
    (
      await db
        .select({
          id: entityVersions.id,
          entityKind: entityVersions.entityKind,
          entityId: entityVersions.entityId,
          schemaVersion: entityVersions.schemaVersion,
          createdAt: entityVersions.createdAt,
          createdBy: entityVersions.createdBy,
        })
        .from(entityVersions)
        .where(
          and(
            eq(entityVersions.tenantId, tenantId),
            eq(entityVersions.entityKind, query.entityKind),
            eq(entityVersions.entityId, query.entityId),
          ),
        )
        .orderBy(desc(entityVersions.createdAt))
        .limit(query.limit)
    ).map((row) => entityHistoryEntrySchema.parse(row)),
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(entityVersions)
      .where(and(eq(entityVersions.tenantId, tenantId), eq(entityVersions.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const record: EntityVersionRecord = {
      id: row.id,
      entityKind: row.entityKind,
      entityId: row.entityId,
      schemaVersion: row.schemaVersion,
      payload: row.payload,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
    return record;
  },
});

export const createMemberCourseProgressRepository = (db: Db): MemberCourseProgressRepository => ({
  findByMemberAndCourse: async (tenantId, input) => {
    const rows = await db
      .select()
      .from(memberCourseProgress)
      .where(
        and(
          eq(memberCourseProgress.tenantId, tenantId),
          eq(memberCourseProgress.memberId, input.memberId),
          eq(memberCourseProgress.courseId, input.courseId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row
      ? parseProgress({
          ...row,
          lastViewedLessonId: row.lastViewedLessonId ?? undefined,
          lastViewedModuleId: row.lastViewedModuleId ?? undefined,
          lastViewedChapterId: row.lastViewedChapterId ?? undefined,
        })
      : null;
  },
  listByMember: async (tenantId, memberId) => {
    const rows = await db
      .select()
      .from(memberCourseProgress)
      .where(
        and(
          eq(memberCourseProgress.tenantId, tenantId),
          eq(memberCourseProgress.memberId, memberId),
        ),
      );
    return rows.map((row) =>
      parseProgress({
        ...row,
        lastViewedLessonId: row.lastViewedLessonId ?? undefined,
        lastViewedModuleId: row.lastViewedModuleId ?? undefined,
        lastViewedChapterId: row.lastViewedChapterId ?? undefined,
      }),
    );
  },
  findOrCreate: async (tenantId, input) => {
    await db
      .insert(memberCourseProgress)
      .values({
        id: input.id,
        tenantId,
        memberId: input.memberId,
        courseId: input.courseId,
        completedLessonIds: [],
        updatedAt: input.now,
      })
      .onConflictDoNothing({
        target: [
          memberCourseProgress.tenantId,
          memberCourseProgress.memberId,
          memberCourseProgress.courseId,
        ],
      });
    const rows = await db
      .select()
      .from(memberCourseProgress)
      .where(
        and(
          eq(memberCourseProgress.tenantId, tenantId),
          eq(memberCourseProgress.memberId, input.memberId),
          eq(memberCourseProgress.courseId, input.courseId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Progress create/read failed inside repository');
    return parseProgress({
      ...row,
      lastViewedLessonId: row.lastViewedLessonId ?? undefined,
      lastViewedModuleId: row.lastViewedModuleId ?? undefined,
      lastViewedChapterId: row.lastViewedChapterId ?? undefined,
    });
  },
  update: async (tenantId, progress) => {
    const rows = await db
      .update(memberCourseProgress)
      .set({
        lastViewedLessonId: progress.lastViewedLessonId ?? null,
        lastViewedModuleId: progress.lastViewedModuleId ?? null,
        lastViewedChapterId: progress.lastViewedChapterId ?? null,
        completedLessonIds: progress.completedLessonIds,
        updatedAt: progress.updatedAt,
      })
      .where(and(eq(memberCourseProgress.tenantId, tenantId), eq(memberCourseProgress.id, progress.id)))
      .returning();
    const row = rows[0];
    return row
      ? parseProgress({
          ...row,
          lastViewedLessonId: row.lastViewedLessonId ?? undefined,
          lastViewedModuleId: row.lastViewedModuleId ?? undefined,
          lastViewedChapterId: row.lastViewedChapterId ?? undefined,
        })
      : null;
  },
  countReferencingLesson: async (tenantId, lessonId) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(memberCourseProgress)
      .where(
        and(
          eq(memberCourseProgress.tenantId, tenantId),
          sql`(${memberCourseProgress.completedLessonIds} @> ${JSON.stringify([lessonId])}::jsonb or ${memberCourseProgress.lastViewedLessonId} = ${lessonId})`,
        ),
      );
    return rows[0]?.value ?? 0;
  },
});

export const createPostRepository = (db: Db): PostRepository => ({
  createPost: async (tenantId, post) => {
    const rows = await db
      .insert(posts)
      .values({ ...post, tenantId })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('posts insert returned no row');
    return parsePost(row);
  },
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(posts)
      .where(and(eq(posts.tenantId, tenantId), eq(posts.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parsePost(row) : null;
  },
  listThreadsForContext: async (tenantId, query) => {
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          eq(posts.contextKind, query.contextKind),
          eq(posts.contextId, query.contextId),
          sql`${posts.parentPostId} is null`,
          ...(query.cursor === undefined ? [] : [sql`${posts.createdAt} > ${query.cursor}`]),
        ),
      )
      .orderBy(asc(posts.createdAt), asc(posts.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const overflow = rows[query.limit];
    const threads = await Promise.all(
      page.map(async (post) => {
        const counts = await db
          .select({ value: sql<number>`count(*)::int` })
          .from(posts)
          .where(
            and(
              eq(posts.tenantId, tenantId),
              eq(posts.rootPostId, post.rootPostId),
              sql`${posts.id} <> ${post.id}`,
            ),
          );
        return { post: parsePost(post), replyCount: counts[0]?.value ?? 0 };
      }),
    );
    return {
      threads,
      nextCursor: overflow ? overflow.createdAt : null,
    };
  },
  listReplies: async (tenantId, rootPostId) =>
    (
      await db
        .select()
        .from(posts)
        .where(and(eq(posts.tenantId, tenantId), eq(posts.rootPostId, rootPostId), sql`${posts.parentPostId} is not null`))
        .orderBy(asc(posts.createdAt), asc(posts.id))
    ).map(parsePost),
  updateBody: async (tenantId, input) => {
    const rows = await db
      .update(posts)
      .set({ body: input.body, editedAt: input.editedAt })
      .where(and(eq(posts.tenantId, tenantId), eq(posts.id, input.id), sql`${posts.deletedAt} is null`))
      .returning();
    const row = rows[0];
    return row ? parsePost(row) : null;
  },
  softDelete: async (tenantId, input) => {
    const rows = await db
      .update(posts)
      .set({ deletedAt: input.deletedAt })
      .where(and(eq(posts.tenantId, tenantId), eq(posts.id, input.id)))
      .returning();
    const row = rows[0];
    return row ? parsePost(row) : null;
  },
  search: async (tenantId, query) => {
    if (query.lessonIds.length === 0) return [];
    const rows = await db
      .select({
        post: posts,
        snippet: sql<string>`left(regexp_replace(${posts.body}, '\\s+', ' ', 'g'), 180)`,
      })
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          eq(posts.contextKind, 'lesson'),
          inArray(posts.contextId, query.lessonIds),
          sql`${posts.deletedAt} is null`,
          sql`body_tsvector @@ plainto_tsquery('simple', ${query.query})`,
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(query.limit);
    return rows.map(
      (row): PostSearchHit => ({
        post: parsePost(row.post),
        lessonId: row.post.contextId,
        snippet: row.snippet,
      }),
    );
  },
});

export const createThreadSubscriptionRepository = (db: Db): ThreadSubscriptionRepository => ({
  upsert: async (tenantId, input) => {
    const rows = await db
      .insert(threadSubscriptions)
      .values({ tenantId, userId: input.userId, rootPostId: input.rootPostId, createdAt: input.createdAt, mutedAt: null })
      .onConflictDoUpdate({
        target: [
          threadSubscriptions.tenantId,
          threadSubscriptions.userId,
          threadSubscriptions.rootPostId,
        ],
        set: { mutedAt: null },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('thread_subscriptions upsert returned no row');
    return row;
  },
  mute: async (tenantId, input) => {
    const rows = await db
      .update(threadSubscriptions)
      .set({ mutedAt: input.mutedAt })
      .where(
        and(
          eq(threadSubscriptions.tenantId, tenantId),
          eq(threadSubscriptions.userId, input.userId),
          eq(threadSubscriptions.rootPostId, input.rootPostId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  },
  listSubscribersForRoot: async (tenantId, rootPostId) =>
    db
      .select()
      .from(threadSubscriptions)
      .where(and(eq(threadSubscriptions.tenantId, tenantId), eq(threadSubscriptions.rootPostId, rootPostId)))
      .orderBy(asc(threadSubscriptions.createdAt)),
  listForUser: async (tenantId, input) =>
    input.rootPostIds.length === 0
      ? []
      : db
          .select()
          .from(threadSubscriptions)
          .where(
            and(
              eq(threadSubscriptions.tenantId, tenantId),
              eq(threadSubscriptions.userId, input.userId),
              inArray(threadSubscriptions.rootPostId, input.rootPostIds),
            ),
          ),
});

export const createNotificationRepository = (db: Db): NotificationRepository => ({
  insert: async (tenantId, notification) => {
    const rows = await db
      .insert(notifications)
      .values({ ...notification, tenantId })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('notifications insert returned no row');
    return parseNotification(row);
  },
  listForRecipient: async (tenantId, query) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientUserId, query.recipientUserId),
          ...(query.cursor === undefined ? [] : [sql`${notifications.createdAt} < ${query.cursor}`]),
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const overflow = rows[query.limit];
    return {
      notifications: page.map(parseNotification),
      nextCursor: overflow ? overflow.createdAt : null,
    };
  },
  markRead: async (tenantId, input) => {
    const rows = await db
      .update(notifications)
      .set({ readAt: input.readAt })
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.id, input.id),
          eq(notifications.recipientUserId, input.recipientUserId),
        ),
      )
      .returning();
    const row = rows[0];
    return row ? parseNotification(row) : null;
  },
  markAllRead: async (tenantId, input) => {
    const rows = await db
      .update(notifications)
      .set({ readAt: input.readAt })
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientUserId, input.recipientUserId),
          sql`${notifications.readAt} is null`,
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  },
  unreadCount: async (tenantId, recipientUserId) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientUserId, recipientUserId),
          sql`${notifications.readAt} is null`,
        ),
      );
    return rows[0]?.value ?? 0;
  },
});

export const createMemberRepository = (db: Db): MemberRepository => ({
  findById: async (tenantId, memberId) => {
    const rows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.id, memberId)))
      .limit(1);
    return rows[0] ?? null;
  },
  findByEmail: async (tenantId, email) => {
    const rows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.email, email)))
      .limit(1);
    return rows[0] ?? null;
  },
  listWithProductIds: async (tenantId, now) =>
    db
      .select({
        id: members.id,
        email: members.email,
        displayName: members.displayName,
        tags: members.tags,
        marketingConsents: members.marketingConsents,
        externalCustomerIds: members.externalCustomerIds,
        createdAt: members.createdAt,
        productIds: sql<
          string[]
        >`coalesce(array_agg(${productGrants.productId}) filter (where ${productGrants.productId} is not null), '{}')`,
        activeProductIds: sql<
          string[]
        >`coalesce(array_agg(${productGrants.productId}) filter (where ${productGrants.productId} is not null and ${productGrants.startsAt}::timestamptz <= ${now}::timestamptz and (${productGrants.expiresAt} is null or ${productGrants.expiresAt}::timestamptz >= ${now}::timestamptz)), '{}')`,
      })
      .from(members)
      .leftJoin(
        productGrants,
        and(eq(productGrants.tenantId, members.tenantId), eq(productGrants.memberId, members.id)),
      )
      .where(eq(members.tenantId, tenantId))
      .groupBy(
        members.id,
        members.email,
        members.displayName,
        members.tags,
        members.marketingConsents,
        members.externalCustomerIds,
        members.createdAt,
      )
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
        tags: member.tags,
        marketingConsents: member.marketingConsents,
        externalCustomerIds: member.externalCustomerIds,
        createdAt: member.createdAt,
      })
      .onConflictDoNothing({ target: [members.tenantId, members.userId] });
  },
  updateEmail: async (tenantId, memberId, email) => {
    const rows = await db
      .update(members)
      .set({ email })
      .where(and(eq(members.tenantId, tenantId), eq(members.id, memberId)))
      .returning();
    return rows[0] ?? null;
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
  findById: async (tenantId, grantId) => {
    const rows = await db
      .select()
      .from(productGrants)
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, grantId)))
      .limit(1);
    const row = rows[0];
    return row ? parseGrant(row) : null;
  },
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
    const row = rows[0];
    return row ? parseGrant(row) : null;
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
        startsAt: grant.startsAt,
        expiresAt: grant.expiresAt,
        legacyId: grant.legacyId,
        createdAt: grant.createdAt,
      })
      .onConflictDoNothing({
        target: [productGrants.tenantId, productGrants.memberId, productGrants.productId],
      })
      .returning({ id: productGrants.id });
    return rows.length > 0;
  },
  setGrantWindow: async (tenantId, grantId, window) => {
    const rows = await db
      .update(productGrants)
      .set({ startsAt: window.startsAt, expiresAt: window.expiresAt })
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, grantId)))
      .returning();
    const row = rows[0];
    return row ? parseGrant(row) : null;
  },
  revokeGrant: async (tenantId, grantId, expiresAt) => {
    const rows = await db
      .update(productGrants)
      .set({ expiresAt })
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, grantId)))
      .returning();
    const row = rows[0];
    return row ? parseGrant(row) : null;
  },
  listForMemberWithProductNames: async (tenantId, memberId, now) =>
    (
      await db
        .select({
          id: productGrants.id,
          productId: productGrants.productId,
          productName: products.title,
          startsAt: productGrants.startsAt,
          expiresAt: productGrants.expiresAt,
          source: productGrants.source,
          active: sql<boolean>`(${productGrants.startsAt}::timestamptz <= ${now}::timestamptz and (${productGrants.expiresAt} is null or ${productGrants.expiresAt}::timestamptz >= ${now}::timestamptz))`,
        })
        .from(productGrants)
        .innerJoin(products, and(eq(productGrants.productId, products.id), eq(products.tenantId, tenantId)))
        .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.memberId, memberId)))
        .orderBy(asc(productGrants.createdAt))
    ).map(parseMemberGrant),
  listActiveForMember: async (tenantId, memberId, now) =>
    (
      await db
        .select()
        .from(productGrants)
        .where(
          and(
            eq(productGrants.tenantId, tenantId),
            eq(productGrants.memberId, memberId),
            sql`${productGrants.startsAt}::timestamptz <= ${now}::timestamptz`,
            sql`(${productGrants.expiresAt} is null or ${productGrants.expiresAt}::timestamptz >= ${now}::timestamptz)`,
          ),
        )
        .orderBy(asc(productGrants.createdAt))
    ).map(parseGrant),
  listGrantedProducts: async (tenantId, memberId) =>
    (
      await db
        .select({
          id: products.id,
          tenantId: products.tenantId,
          title: products.title,
          description: products.description,
          priceCents: products.priceCents,
          currency: products.currency,
          published: products.published,
          accessItems: products.accessItems,
          legacyId: products.legacyId,
          createdAt: products.createdAt,
        })
        .from(productGrants)
        .innerJoin(
          products,
          and(eq(productGrants.productId, products.id), eq(products.tenantId, tenantId)),
        )
        .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.memberId, memberId)))
        .orderBy(asc(productGrants.createdAt))
    ).map(parseProduct),
});

export const createTenantApiKeyRepository = (db: Db): TenantApiKeyRepository => ({
  listByTenant: async (tenantId) =>
    (
      await db
        .select()
        .from(tenantApiKeys)
        .where(eq(tenantApiKeys.tenantId, tenantId))
        .orderBy(asc(tenantApiKeys.createdAt))
    ).map(parseApiKey),
  create: async (tenantId, apiKey) => {
    await db.insert(tenantApiKeys).values({
      id: apiKey.id,
      tenantId,
      name: apiKey.name,
      keyHash: apiKey.keyHash,
      createdAt: apiKey.createdAt,
      revokedAt: apiKey.revokedAt,
    });
  },
  findActiveByHash: async (tenantId, keyHash) => {
    const rows = await db
      .select()
      .from(tenantApiKeys)
      .where(
        and(
          eq(tenantApiKeys.tenantId, tenantId),
          eq(tenantApiKeys.keyHash, keyHash),
          sql`${tenantApiKeys.revokedAt} is null`,
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? parseApiKey(row) : null;
  },
  revoke: async (tenantId, id, revokedAt) => {
    const rows = await db
      .update(tenantApiKeys)
      .set({ revokedAt })
      .where(
        and(
          eq(tenantApiKeys.tenantId, tenantId),
          eq(tenantApiKeys.id, id),
          sql`${tenantApiKeys.revokedAt} is null`,
        ),
      )
      .returning();
    const row = rows[0];
    return row ? parseApiKey(row) : null;
  },
});

export const createTenantSecretRepository = (db: Db): TenantSecretRepository => ({
  listByTenant: async (tenantId) =>
    (
      await db
        .select()
        .from(tenantSecrets)
        .where(eq(tenantSecrets.tenantId, tenantId))
        .orderBy(asc(tenantSecrets.key))
    ).map(parseSecret),
  findByKey: async (tenantId, key) => {
    const rows = await db
      .select()
      .from(tenantSecrets)
      .where(and(eq(tenantSecrets.tenantId, tenantId), eq(tenantSecrets.key, key)))
      .limit(1);
    const row = rows[0];
    return row ? parseSecret(row) : null;
  },
  upsert: async (tenantId, secret) => {
    const rows = await db
      .insert(tenantSecrets)
      .values({
        id: secret.id,
        tenantId,
        key: secret.key,
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        authTag: secret.authTag,
        maskedPreview: secret.maskedPreview,
        updatedAt: secret.updatedAt,
      })
      .onConflictDoUpdate({
        target: [tenantSecrets.tenantId, tenantSecrets.key],
        set: {
          ciphertext: secret.ciphertext,
          iv: secret.iv,
          authTag: secret.authTag,
          maskedPreview: secret.maskedPreview,
          updatedAt: secret.updatedAt,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('tenant_secrets upsert returned no row');
    return parseSecret(row);
  },
  delete: async (tenantId, key) => {
    const rows = await db
      .delete(tenantSecrets)
      .where(and(eq(tenantSecrets.tenantId, tenantId), eq(tenantSecrets.key, key)))
      .returning({ id: tenantSecrets.id });
    return rows.length > 0;
  },
});

export const createProcessedPaymentEventRepository = (db: Db): ProcessedPaymentEventRepository => ({
  findByEventId: async (tenantId, eventId) => {
    const rows = await db
      .select()
      .from(processedPaymentEvents)
      .where(and(eq(processedPaymentEvents.tenantId, tenantId), eq(processedPaymentEvents.id, eventId)))
      .limit(1);
    const row = rows[0];
    return row ? parseProcessedPaymentEvent(row) : null;
  },
  findByObjectAndType: async (tenantId, objectId, type) => {
    const rows = await db
      .select()
      .from(processedPaymentEvents)
      .where(
        and(
          eq(processedPaymentEvents.tenantId, tenantId),
          eq(processedPaymentEvents.objectId, objectId),
          eq(processedPaymentEvents.type, type),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? parseProcessedPaymentEvent(row) : null;
  },
  create: async (tenantId, event) => {
    const rows = await db
      .insert(processedPaymentEvents)
      .values({ ...event, tenantId })
      .onConflictDoNothing()
      .returning({ id: processedPaymentEvents.id });
    return rows.length > 0;
  },
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
          tags: [],
          marketingConsents: {},
          externalCustomerIds: {},
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
          startsAt: input.createdAt,
          expiresAt: null,
          legacyId: null,
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

export const createDevEmailReader = (db: Db): DevEmailReader => ({
  findByRecipient: async (to) => {
    const rows = await db.select().from(devEmails).where(eq(devEmails.to, to)).limit(1);
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
  findSettings: async (tenantId) => {
    const rows = await db
      .select({
        billingPortalUrl: tenants.billingPortalUrl,
        bunnyStreamLibraryId: tenants.bunnyStreamLibraryId,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    return row
      ? { billingPortalUrl: row.billingPortalUrl, bunnyStreamLibraryId: row.bunnyStreamLibraryId }
      : null;
  },
  updateSettings: async (tenantId, settings): Promise<TenantSettings> => {
    await db
      .update(tenants)
      .set({
        billingPortalUrl: settings.billingPortalUrl,
        bunnyStreamLibraryId: settings.bunnyStreamLibraryId,
      })
      .where(eq(tenants.id, tenantId));
    return {
      billingPortalUrl: settings.billingPortalUrl,
      bunnyStreamLibraryId: settings.bunnyStreamLibraryId,
    };
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
