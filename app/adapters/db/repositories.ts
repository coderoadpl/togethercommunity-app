import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';

import {
  SUBSCRIPTION_GRACE_DAYS,
  computeCourseModuleName,
  courseLessonSchema,
  courseModuleSchema,
  courseSchema,
  entityHistoryEntrySchema,
  memberCourseProgressSchema,
  memberGrantSchema,
  memberSubscriptionSchema,
  notificationSchema,
  orderSchema,
  orderListItemSchema,
  productPriceSchema,
  postSchema,
  REACTION_EMOJIS,
  reactionSummarySchema,
  spaceSchema,
  productGrantSchema,
  productSchema,
  snapshotPayloadsEqual,
  staffRoleSchema,
  tenantApiKeySchema,
  tenantSecretSchema,
  termsConsentSchema,
  type Course,
  type CourseLesson,
  type CourseModule,
  type MemberCourseProgress,
  type MemberGrant,
  type MemberSubscription,
  type Membership,
  type Notification,
  type Order,
  type OrderListItem,
  type ProductPrice,
  type Post,
  type Product,
  type ReactionSummary,
  type Space,
  type ProductGrant,
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
  MemberErasurePort,
  MemberRepository,
  MemberCourseProgressRepository,
  MemberSubscriptionRepository,
  NotificationRepository,
  OrderRepository,
  PaymentRefundRepository,
  ProductPriceRepository,
  PostRepository,
  PostSearchRow,
  PurchaseRepository,
  ProductGrantRepository,
  ProcessedPaymentEventRepository,
  ProductRepository,
  OnboardingStateRepository,
  PostReactionRepository,
  SpaceRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  TenantApiKeyRepository,
  TenantDomainRepository,
  TenantRepository,
  TenantSecretRepository,
  TermsConsentRepository,
  ThreadSubscriptionRepository,
  UserDisplayReader,
} from '@core/server/index.js';

import type { Db } from './client.js';
import { buildPrefixTsquery } from './post-search-query.js';
import {
  consents,
  courseLessons,
  courseModules,
  courses,
  devEmails,
  devMagicLinks,
  entityVersions,
  memberCourseProgress,
  members,
  memberSubscriptions,
  notifications,
  orders,
  postReactions,
  posts,
  productGrants,
  productPrices,
  processedPaymentEvents,
  products,
  spaces,
  spaceSubscriptions,
  tenantAdmins,
  tenantApiKeys,
  tenantDomains,
  tenantSecrets,
  tenants,
  threadSubscriptions,
  user,
} from './schema.js';

const parseStaffRole = (raw: string): StaffRole | null => {
  const parsed = staffRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const parseProduct = (product: Product): Product => productSchema.parse(product);

const parseGrant = (grant: ProductGrant): ProductGrant => productGrantSchema.parse(grant);

const parseOrder = (order: Order): Order => orderSchema.parse(order);

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

/**
 * Thread pagination cursors are `createdAt|id` tuples: a bare timestamp
 * cursor would skip or repeat root posts created in the same millisecond.
 */
const threadCursor = (post: { createdAt: string; id: string }): string => `${post.createdAt}|${post.id}`;

const parseThreadCursor = (cursor: string): { createdAt: string; id: string } => {
  const separator = cursor.indexOf('|');
  return separator === -1
    ? { createdAt: cursor, id: '' }
    : { createdAt: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
};

const parseSpace = (space: typeof spaces.$inferSelect): Space => spaceSchema.parse(space);

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

export const createUserDisplayReader = (db: Db): UserDisplayReader => ({
  findDisplayNames: async (userIds) => {
    if (userIds.length === 0) return new Map();
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(inArray(user.id, userIds));
    return new Map(
      rows.map((row) => [row.id, row.name.trim().length > 0 ? row.name.trim() : row.email]),
    );
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
    const descending = query.order === 'desc';
    const cursor = query.cursor === undefined ? null : parseThreadCursor(query.cursor);
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          eq(posts.contextKind, query.contextKind),
          eq(posts.contextId, query.contextId),
          sql`${posts.parentPostId} is null`,
          ...(cursor === null
            ? []
            : [
                descending
                  ? sql`(${posts.createdAt}, ${posts.id}) < (${cursor.createdAt}, ${cursor.id})`
                  : sql`(${posts.createdAt}, ${posts.id}) > (${cursor.createdAt}, ${cursor.id})`,
              ]),
        ),
      )
      .orderBy(
        ...(descending ? [desc(posts.createdAt), desc(posts.id)] : [asc(posts.createdAt), asc(posts.id)]),
      )
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
    const last = page.at(-1);
    return {
      threads,
      // Cursor = last item of the page, so the overflow row opens the next page.
      nextCursor: overflow && last ? threadCursor(last) : null,
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
    const contextFilters: SQL[] = [];
    if (query.lessonIds.length > 0) {
      const lessonFilter = and(eq(posts.contextKind, 'lesson'), inArray(posts.contextId, query.lessonIds));
      if (lessonFilter) contextFilters.push(lessonFilter);
    }
    if (query.spaceIds.length > 0) {
      const spaceFilter = and(eq(posts.contextKind, 'space'), inArray(posts.contextId, query.spaceIds));
      if (spaceFilter) contextFilters.push(spaceFilter);
    }
    if (contextFilters.length === 0) return [];
    const tsquery = buildPrefixTsquery(query.query);
    if (tsquery === null) return [];
    const rows = await db
      .select({
        post: posts,
        snippet: sql<string>`left(regexp_replace(${posts.body}, '\\s+', ' ', 'g'), 180)`,
      })
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          or(...contextFilters),
          sql`${posts.deletedAt} is null`,
          sql`body_tsvector @@ to_tsquery('simple', ${tsquery})`,
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(query.limit);
    return rows.map(
      (row): PostSearchRow => ({
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

export const createSpaceRepository = (db: Db): SpaceRepository => ({
  list: async (tenantId, options) =>
    (
      await db
        .select()
        .from(spaces)
        .where(
          options?.includeArchived
            ? eq(spaces.tenantId, tenantId)
            : and(eq(spaces.tenantId, tenantId), isNull(spaces.archivedAt)),
        )
        .orderBy(asc(spaces.position), asc(spaces.createdAt), asc(spaces.id))
    ).map(parseSpace),
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.tenantId, tenantId), eq(spaces.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parseSpace(row) : null;
  },
  findBySlug: async (tenantId, slug) => {
    const rows = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.tenantId, tenantId), eq(spaces.slug, slug)))
      .limit(1);
    const row = rows[0];
    return row ? parseSpace(row) : null;
  },
  create: async (tenantId, space) => {
    await db.insert(spaces).values({ ...space, tenantId });
  },
  update: async (tenantId, space) => {
    const rows = await db
      .update(spaces)
      .set({
        name: space.name,
        description: space.description,
        visibility: space.visibility,
        productIds: space.productIds,
        position: space.position,
      })
      .where(and(eq(spaces.tenantId, tenantId), eq(spaces.id, space.id)))
      .returning();
    const row = rows[0];
    return row ? parseSpace(row) : null;
  },
  setArchived: async (tenantId, input) => {
    const rows = await db
      .update(spaces)
      .set({ archivedAt: input.archivedAt })
      .where(and(eq(spaces.tenantId, tenantId), eq(spaces.id, input.id)))
      .returning();
    const row = rows[0];
    return row ? parseSpace(row) : null;
  },
  delete: async (tenantId, id) => {
    const rows = await db
      .delete(spaces)
      .where(and(eq(spaces.tenantId, tenantId), eq(spaces.id, id)))
      .returning({ id: spaces.id });
    return rows.length > 0;
  },
  stats: async (tenantId, spaceIds) => {
    const result = new Map<string, { posts: number; followers: number }>();
    if (spaceIds.length === 0) return result;
    for (const id of spaceIds) result.set(id, { posts: 0, followers: 0 });
    const postRows = await db
      .select({ spaceId: posts.contextId, count: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          eq(posts.contextKind, 'space'),
          inArray(posts.contextId, spaceIds),
          isNull(posts.deletedAt),
        ),
      )
      .groupBy(posts.contextId);
    for (const row of postRows) {
      result.set(row.spaceId, { ...(result.get(row.spaceId) ?? { posts: 0, followers: 0 }), posts: row.count });
    }
    const followerRows = await db
      .select({ spaceId: spaceSubscriptions.spaceId, count: sql<number>`count(*)::int` })
      .from(spaceSubscriptions)
      .where(and(eq(spaceSubscriptions.tenantId, tenantId), inArray(spaceSubscriptions.spaceId, spaceIds)))
      .groupBy(spaceSubscriptions.spaceId);
    for (const row of followerRows) {
      result.set(row.spaceId, {
        ...(result.get(row.spaceId) ?? { posts: 0, followers: 0 }),
        followers: row.count,
      });
    }
    return result;
  },
});

export const createPostReactionRepository = (db: Db): PostReactionRepository => ({
  add: async (tenantId, input) => {
    const rows = await db
      .insert(postReactions)
      .values({
        tenantId,
        postId: input.postId,
        userId: input.userId,
        emoji: input.emoji,
        createdAt: input.createdAt,
      })
      .onConflictDoNothing({
        target: [postReactions.postId, postReactions.userId, postReactions.emoji],
      })
      .returning({ postId: postReactions.postId });
    return rows.length > 0;
  },
  remove: async (tenantId, input) => {
    const rows = await db
      .delete(postReactions)
      .where(
        and(
          eq(postReactions.tenantId, tenantId),
          eq(postReactions.postId, input.postId),
          eq(postReactions.userId, input.userId),
          eq(postReactions.emoji, input.emoji),
        ),
      )
      .returning({ postId: postReactions.postId });
    return rows.length > 0;
  },
  summarize: async (tenantId, input) => {
    if (input.postIds.length === 0) return new Map();
    const rows = await db
      .select({
        postId: postReactions.postId,
        emoji: postReactions.emoji,
        count: sql<number>`count(*)::int`,
        viewerReacted: sql<boolean>`bool_or(${postReactions.userId} = ${input.viewerUserId})`,
      })
      .from(postReactions)
      .where(and(eq(postReactions.tenantId, tenantId), inArray(postReactions.postId, input.postIds)))
      .groupBy(postReactions.postId, postReactions.emoji);
    const byPost = new Map<string, ReactionSummary[]>();
    for (const row of rows) {
      const summary = reactionSummarySchema.parse({
        emoji: row.emoji,
        count: row.count,
        viewerReacted: row.viewerReacted,
      });
      byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), summary]);
    }
    const order = new Map(REACTION_EMOJIS.map((emoji, index) => [emoji, index] as const));
    for (const summaries of byPost.values()) {
      summaries.sort((a, b) => (order.get(a.emoji) ?? 0) - (order.get(b.emoji) ?? 0));
    }
    return byPost;
  },
});

export const createSpaceSubscriptionRepository = (db: Db): SpaceSubscriptionRepository => ({
  follow: async (tenantId, input) => {
    await db
      .insert(spaceSubscriptions)
      .values({ tenantId, userId: input.userId, spaceId: input.spaceId, createdAt: input.createdAt })
      .onConflictDoNothing({
        target: [spaceSubscriptions.tenantId, spaceSubscriptions.userId, spaceSubscriptions.spaceId],
      });
  },
  unfollow: async (tenantId, input) => {
    const rows = await db
      .delete(spaceSubscriptions)
      .where(
        and(
          eq(spaceSubscriptions.tenantId, tenantId),
          eq(spaceSubscriptions.userId, input.userId),
          eq(spaceSubscriptions.spaceId, input.spaceId),
        ),
      )
      .returning({ spaceId: spaceSubscriptions.spaceId });
    return rows.length > 0;
  },
  listFollowersForSpace: async (tenantId, spaceId) =>
    db
      .select()
      .from(spaceSubscriptions)
      .where(and(eq(spaceSubscriptions.tenantId, tenantId), eq(spaceSubscriptions.spaceId, spaceId)))
      .orderBy(asc(spaceSubscriptions.createdAt)),
  listForUser: async (tenantId, input) =>
    input.spaceIds.length === 0
      ? []
      : db
          .select()
          .from(spaceSubscriptions)
          .where(
            and(
              eq(spaceSubscriptions.tenantId, tenantId),
              eq(spaceSubscriptions.userId, input.userId),
              inArray(spaceSubscriptions.spaceId, input.spaceIds),
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
        deletedAt: members.deletedAt,
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
        members.deletedAt,
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
        deletedAt: member.deletedAt,
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
});

export const createMemberErasureRepository = (db: Db): MemberErasurePort => ({
  pseudonymize: async (tenantId, input) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(members)
        .where(and(eq(members.tenantId, tenantId), eq(members.id, input.memberId)))
        .limit(1);
      const member = rows[0];
      if (!member) return null;
      if (member.deletedAt !== null) return { alreadyDeleted: true, authUserErased: false };

      await tx
        .update(productGrants)
        .set({ expiresAt: input.deletedAt })
        .where(
          and(
            eq(productGrants.tenantId, tenantId),
            eq(productGrants.memberId, input.memberId),
            or(
              isNull(productGrants.expiresAt),
              sql`${productGrants.expiresAt}::timestamptz > ${input.deletedAt}::timestamptz`,
            ),
          ),
        );

      await tx
        .update(memberSubscriptions)
        .set({ status: 'canceled', cancelAtPeriodEnd: true, updatedAt: input.deletedAt })
        .where(
          and(
            eq(memberSubscriptions.tenantId, tenantId),
            eq(memberSubscriptions.memberId, input.memberId),
            ne(memberSubscriptions.status, 'canceled'),
          ),
        );

      await tx
        .update(posts)
        .set({ authorDisplay: input.postAuthorDisplay })
        .where(and(eq(posts.tenantId, tenantId), eq(posts.authorUserId, member.userId)));

      await tx
        .update(members)
        .set({
          userId: input.severedUserId,
          email: input.tombstoneEmail,
          displayName: null,
          tags: [],
          marketingConsents: {},
          externalCustomerIds: {},
          deletedAt: input.deletedAt,
        })
        .where(and(eq(members.tenantId, tenantId), eq(members.id, input.memberId)));

      const memberLinks = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(members)
        .where(eq(members.userId, member.userId));
      const staffLinks = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(tenantAdmins)
        .where(eq(tenantAdmins.userId, member.userId));
      const linked = (memberLinks[0]?.value ?? 0) + (staffLinks[0]?.value ?? 0);
      if (linked > 0) return { alreadyDeleted: false, authUserErased: false };

      await tx.delete(user).where(eq(user.id, member.userId));
      return { alreadyDeleted: false, authUserErased: true };
    }),
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

const parseProductPrice = (price: ProductPrice): ProductPrice => productPriceSchema.parse(price);

const parseSubscription = (subscription: MemberSubscription): MemberSubscription =>
  memberSubscriptionSchema.parse(subscription);

export const createProductPriceRepository = (db: Db): ProductPriceRepository => ({
  listByProduct: async (tenantId, productId) =>
    (
      await db
        .select()
        .from(productPrices)
        .where(and(eq(productPrices.tenantId, tenantId), eq(productPrices.productId, productId)))
        .orderBy(asc(productPrices.createdAt))
    ).map(parseProductPrice),
  listActiveByProducts: async (tenantId, productIds) => {
    if (productIds.length === 0) return [];
    return (
      await db
        .select()
        .from(productPrices)
        .where(
          and(
            eq(productPrices.tenantId, tenantId),
            eq(productPrices.active, true),
            inArray(productPrices.productId, productIds),
          ),
        )
        .orderBy(asc(productPrices.createdAt))
    ).map(parseProductPrice);
  },
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(productPrices)
      .where(and(eq(productPrices.tenantId, tenantId), eq(productPrices.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parseProductPrice(row) : null;
  },
  create: async (tenantId, price) => {
    await db.insert(productPrices).values({
      id: price.id,
      tenantId,
      productId: price.productId,
      kind: price.kind,
      interval: price.interval,
      amountCents: price.amountCents,
      currency: price.currency,
      active: price.active,
      createdAt: price.createdAt,
    });
  },
  setActive: async (tenantId, id, active) => {
    const rows = await db
      .update(productPrices)
      .set({ active })
      .where(and(eq(productPrices.tenantId, tenantId), eq(productPrices.id, id)))
      .returning();
    const row = rows[0];
    return row ? parseProductPrice(row) : null;
  },
});

export const createOrderRepository = (db: Db): OrderRepository => {
  const conditionsFor = (tenantId: string, query: Parameters<OrderRepository['list']>[1]): SQL[] => {
    const conditions: SQL[] = [eq(orders.tenantId, tenantId)];
    if (query.status !== undefined) conditions.push(eq(orders.status, query.status));
    if (query.productId !== undefined) conditions.push(eq(orders.productId, query.productId));
    if (query.kind !== undefined) conditions.push(eq(orders.kind, query.kind));
    if (query.search !== undefined) {
      const pattern = `%${query.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      const search = or(
        ilike(members.email, pattern),
        ilike(members.displayName, pattern),
        ilike(products.title, pattern),
      );
      if (search) conditions.push(search);
    }
    return conditions;
  };

  return {
    create: async (tenantId, order) => {
      await db.insert(orders).values({
        id: order.id,
        tenantId,
        memberId: order.memberId,
        productId: order.productId,
        priceId: order.priceId,
        kind: order.kind,
        status: order.status,
        amountCents: order.amountCents,
        currency: order.currency,
        provider: order.provider,
        providerObjectIds: order.providerObjectIds,
        createdAt: order.createdAt,
      });
    },
    list: async (tenantId, query) => {
      const conditions = conditionsFor(tenantId, query);
      const rows = await db
        .select({
          order: orders,
          memberEmail: members.email,
          memberName: members.displayName,
          productTitle: products.title,
        })
        .from(orders)
        .innerJoin(members, and(eq(orders.memberId, members.id), eq(members.tenantId, orders.tenantId)))
        .innerJoin(products, and(eq(orders.productId, products.id), eq(products.tenantId, orders.tenantId)))
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const totals = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(orders)
        .innerJoin(members, and(eq(orders.memberId, members.id), eq(members.tenantId, orders.tenantId)))
        .innerJoin(products, and(eq(orders.productId, products.id), eq(products.tenantId, orders.tenantId)))
        .where(and(...conditions));
      return {
        orders: rows.map(
          (row): OrderListItem =>
            orderListItemSchema.parse({
              ...row.order,
              memberEmail: row.memberEmail,
              memberName: row.memberName,
              productTitle: row.productTitle,
            }),
        ),
        total: totals[0]?.value ?? 0,
      };
    },
    revenueSince: async (tenantId, sinceIso) =>
      db
        .select({
          currency: orders.currency,
          amountCents: sql<number>`coalesce(sum(${orders.amountCents}), 0)::int`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            eq(orders.status, 'paid'),
            sql`${orders.createdAt}::timestamptz >= ${sinceIso}::timestamptz`,
          ),
        )
        .groupBy(orders.currency),
    countSince: async (tenantId, sinceIso) => {
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            sql`${orders.createdAt}::timestamptz >= ${sinceIso}::timestamptz`,
          ),
        );
      return rows[0]?.value ?? 0;
    },
  };
};

export const createPaymentRefundRepository = (db: Db): PaymentRefundRepository => ({
  findOrderByProviderObjectIds: async (tenantId, providerObjectIds) => {
    const matches = Object.entries(providerObjectIds).map(
      ([key, value]) => sql`${orders.providerObjectIds} ->> ${key} = ${value}`,
    );
    if (matches.length === 0) return null;
    const rows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), or(...matches)))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(1);
    const row = rows[0];
    return row ? parseOrder(row) : null;
  },
  findLatestSubscriptionOrder: async (tenantId, providerSubscriptionId) => {
    const rows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          sql`${orders.providerObjectIds} ->> 'subscription' = ${providerSubscriptionId}`,
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(1);
    const row = rows[0];
    return row ? parseOrder(row) : null;
  },
  listPaidOrdersForMemberProduct: async (tenantId, memberId, productId) => {
    const rows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.memberId, memberId),
          eq(orders.productId, productId),
          eq(orders.status, 'paid'),
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id));
    return rows.map(parseOrder);
  },
  markOrderRefunded: async (tenantId, orderId) => {
    const rows = await db
      .update(orders)
      .set({ status: 'refunded' })
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.id, orderId),
          sql`${orders.status} <> 'refunded'`,
        ),
      )
      .returning();
    const row = rows[0];
    return row ? parseOrder(row) : null;
  },
});

export const createMemberSubscriptionRepository = (db: Db): MemberSubscriptionRepository => {
  const toRow = (tenantId: string, subscription: MemberSubscription) => ({
    id: subscription.id,
    tenantId,
    memberId: subscription.memberId,
    productId: subscription.productId,
    priceId: subscription.priceId,
    provider: subscription.provider,
    providerSubscriptionId: subscription.providerSubscriptionId,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  });

  return {
    findById: async (tenantId, id) => {
      const rows = await db
        .select()
        .from(memberSubscriptions)
        .where(and(eq(memberSubscriptions.tenantId, tenantId), eq(memberSubscriptions.id, id)))
        .limit(1);
      const row = rows[0];
      return row ? parseSubscription(row) : null;
    },
    findByProviderSubscriptionId: async (tenantId, providerSubscriptionId) => {
      const rows = await db
        .select()
        .from(memberSubscriptions)
        .where(
          and(
            eq(memberSubscriptions.tenantId, tenantId),
            eq(memberSubscriptions.providerSubscriptionId, providerSubscriptionId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? parseSubscription(row) : null;
    },
    listForMember: async (tenantId, memberId) =>
      (
        await db
          .select()
          .from(memberSubscriptions)
          .where(and(eq(memberSubscriptions.tenantId, tenantId), eq(memberSubscriptions.memberId, memberId)))
          .orderBy(asc(memberSubscriptions.createdAt))
      ).map(parseSubscription),
    create: async (tenantId, subscription) => {
      await db.insert(memberSubscriptions).values(toRow(tenantId, subscription));
    },
    update: async (tenantId, subscription) => {
      const rows = await db
        .update(memberSubscriptions)
        .set({
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          providerSubscriptionId: subscription.providerSubscriptionId,
          updatedAt: subscription.updatedAt,
        })
        .where(and(eq(memberSubscriptions.tenantId, tenantId), eq(memberSubscriptions.id, subscription.id)))
        .returning();
      const row = rows[0];
      return row ? parseSubscription(row) : null;
    },
    countActive: async (tenantId, now) => {
      const graceCutoff = new Date(
        Date.parse(now) - SUBSCRIPTION_GRACE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(memberSubscriptions)
        .where(
          and(
            eq(memberSubscriptions.tenantId, tenantId),
            inArray(memberSubscriptions.status, ['active', 'past_due']),
            sql`${memberSubscriptions.currentPeriodEnd}::timestamptz >= ${graceCutoff}::timestamptz`,
          ),
        );
      return rows[0]?.value ?? 0;
    },
  };
};

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
  claim: async (tenantId, event) => {
    const rows = await db
      .insert(processedPaymentEvents)
      .values({ ...event, tenantId })
      .onConflictDoNothing()
      .returning({ id: processedPaymentEvents.id });
    return rows.length > 0;
  },
  release: async (tenantId, eventId) => {
    await db
      .delete(processedPaymentEvents)
      .where(and(eq(processedPaymentEvents.tenantId, tenantId), eq(processedPaymentEvents.id, eventId)));
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
        logoUrl: tenants.logoUrl,
        accentColor: tenants.accentColor,
        faviconUrl: tenants.faviconUrl,
        termsUrl: tenants.termsUrl,
        privacyUrl: tenants.privacyUrl,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          billingPortalUrl: row.billingPortalUrl,
          bunnyStreamLibraryId: row.bunnyStreamLibraryId,
          logoUrl: row.logoUrl,
          accentColor: row.accentColor,
          faviconUrl: row.faviconUrl,
          termsUrl: row.termsUrl,
          privacyUrl: row.privacyUrl,
        }
      : null;
  },
  updateSettings: async (tenantId, settings): Promise<TenantSettings> => {
    await db
      .update(tenants)
      .set({
        billingPortalUrl: settings.billingPortalUrl,
        bunnyStreamLibraryId: settings.bunnyStreamLibraryId,
        logoUrl: settings.logoUrl,
        accentColor: settings.accentColor,
        faviconUrl: settings.faviconUrl,
        termsUrl: settings.termsUrl,
        privacyUrl: settings.privacyUrl,
      })
      .where(eq(tenants.id, tenantId));
    return {
      billingPortalUrl: settings.billingPortalUrl,
      bunnyStreamLibraryId: settings.bunnyStreamLibraryId,
      logoUrl: settings.logoUrl,
      accentColor: settings.accentColor,
      faviconUrl: settings.faviconUrl,
      termsUrl: settings.termsUrl,
      privacyUrl: settings.privacyUrl,
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

export const createTermsConsentRepository = (db: Db): TermsConsentRepository => ({
  record: async (tenantId, consent) => {
    await db.insert(consents).values({ ...consent, tenantId });
  },
  listByEmail: async (tenantId, email) => {
    const rows = await db
      .select()
      .from(consents)
      .where(and(eq(consents.tenantId, tenantId), eq(consents.email, email)))
      .orderBy(asc(consents.acceptedAt));
    return rows.map((row) => termsConsentSchema.parse(row));
  },
});

export const createOnboardingStateRepository = (db: Db): OnboardingStateRepository => ({
  findDismissedAt: async (tenantId) => {
    const rows = await db
      .select({ onboardingDismissedAt: tenants.onboardingDismissedAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return rows[0]?.onboardingDismissedAt ?? null;
  },
  dismiss: async (tenantId, dismissedAt) => {
    await db
      .update(tenants)
      .set({ onboardingDismissedAt: dismissedAt })
      .where(eq(tenants.id, tenantId));
  },
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
    listStaffForTenant: async (tenantId) => {
      const rows = await db
        .select({ userId: tenantAdmins.userId, email: user.email, staffRole: tenantAdmins.role })
        .from(tenantAdmins)
        .innerJoin(user, eq(tenantAdmins.userId, user.id))
        .where(eq(tenantAdmins.tenantId, tenantId));
      return rows.flatMap((row) =>
        parseStaffRole(row.staffRole) === null ? [] : [{ userId: row.userId, email: row.email }],
      );
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
