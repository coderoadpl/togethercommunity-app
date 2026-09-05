import { and, asc, desc, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, ne, notExists, or, sql, type SQL } from 'drizzle-orm';

import migrationJournal from '../../drizzle/meta/_journal.json' with { type: 'json' };
import committedFingerprint from '../../drizzle/meta/schema-fingerprint.json' with { type: 'json' };

import {
  ACCESS_RETAINING_ORDER_STATUSES,
  SUBSCRIPTION_GRACE_DAYS,
  computeCourseModuleName,
  billingDataSchema,
  courseLessonSchema,
  lessonAttachmentSchema,
  courseModuleSchema,
  courseSchema,
  entityHistoryEntrySchema,
  dmConversationSchema,
  dmConversationStateSchema,
  dmMessageSchema,
  dmReportSchema,
  dnsRecordSchema,
  memberCourseProgressSchema,
  memberEventSchema,
  memberGrantSchema,
  memberSubscriptionSchema,
  normalizeEmail,
  notificationSchema,
  orderSchema,
  orderListItemSchema,
  paidWithoutGrantRowSchema,
  productPriceSchema,
  productDownloadAssetSchema,
  postSchema,
  postReportSchema,
  REACTION_EMOJIS,
  reactionSummarySchema,
  spaceEventSchema,
  spaceEventRsvpSchema,
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
  type LessonAttachment,
  type CourseModule,
  type CheckoutConsentCapture,
  type DmConversation,
  type DmConversationState,
  type DmMessage,
  type MemberCourseProgress,
  type MemberGrant,
  type DmBlockDirections,
  type DmReport,
  type MemberSubscription,
  type Membership,
  type Notification,
  type Order,
  type OrderListItem,
  type ProductPrice,
  type ProductDownloadAsset,
  type Post,
  type PostReport,
  type Product,
  type ReactionSummary,
  type Space,
  type SpaceEvent,
  type SpaceEventRsvp,
  type ProductGrant,
  type StaffRole,
  type Tenant,
  type TenantApiKey,
  type TenantDomain,
  type TenantSecret,
  type TenantSettings,
} from '#core/domain/index.js';
import type {
  AvatarSourceReader,
  CourseLessonRepository,
  LessonAttachmentRepository,
  CourseModuleRepository,
  CourseRepository,
  CheckoutConsentCaptureRepository,
  DevEmailReader,
  DevMagicLinkReader,
  DevSinkPurge,
  DmConversationRepository,
  DmConversationStateRepository,
  DmMessageRepository,
  DmReportRepository,
  MemberBlockRepository,
  EntityVersionRecord,
  EntityVersionRepository,
  HealthPort,
  EmailHmac,
  MemberErasurePort,
  MemberRepository,
  MemberCourseProgressRepository,
  MemberSubscriptionRepository,
  NotificationRepository,
  OrderRepository,
  OrderDetailRepository,
  MemberOrderListReader,
  PaymentRefundRepository,
  ProductPriceRepository,
  ProductDownloadAssetRepository,
  PostRepository,
  PostReportRepository,
  PostSearchRow,
  PurchaseRepository,
  ProductGrantRepository,
  ProductMetadataRepository,
  PaymentEventClaim,
  ProcessedPaymentEventRepository,
  ProductRepository,
  ProductBatchReader,
  OnboardingStateRepository,
  PostReactionRepository,
  SpaceEventRepository,
  SpaceEventRsvpRepository,
  SpaceRepository,
  SpaceSeenRepository,
  SpaceSubscriptionRepository,
  SignInMethodReader,
  TenantAccessReader,
  TenantApiKeyRepository,
  TenantDomainEventRepository,
  TenantDomainRepository,
  TenantRepository,
  TenantSecretRepository,
  TermsConsentRepository,
  ThreadSubscriptionRepository,
  UserDisplayReader,
  ApiKeyRateLimitRepository,
  PublicRateLimitRepository,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { uniqueViolation } from './pg-errors.js';
import { appendMemberEvent } from './member-events.js';
import { insertFanoutJob } from './notification-fanout-jobs.js';
import { buildPrefixTsquery } from './post-search-query.js';
import { fingerprintHash, introspectSchema, shortFingerprint } from './schema-fingerprint.js';
import {
  account,
  consents,
  campaignSends,
  checkoutConsentCaptures,
  couponCheckoutSessions,
  couponRedemptions,
  coupons,
  courseLessons,
  lessonAttachments,
  courseModules,
  courses,
  devEmails,
  devMagicLinks,
  dmConversations,
  dmConversationStates,
  dmMessages,
  dmReports,
  memberBlocks,
  emailEvents,
  erasedMemberImports,
  entityVersions,
  invoices,
  memberCourseProgress,
  memberErasureRequestEvents,
  memberErasureRequests,
  members,
  memberSubscriptions,
  marketingConsents,
  notifications,
  orders,
  postReactions,
  postReportEvents,
  postReports,
  posts,
  productGrants,
  productPrices,
  productDownloadAssets,
  processedPaymentEvents,
  products,
  spaces,
  suppressions,
  spaceEventRsvps,
  spaceEvents,
  spaceSeenMarks,
  spaceSubscriptions,
  tenantAdmins,
  tenantApiKeys,
  apiKeyRateLimitBuckets,
  rateLimitBuckets,
  tenantDomainEvents,
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

const parseLessonAttachment = (attachment: LessonAttachment): LessonAttachment =>
  lessonAttachmentSchema.parse(attachment);

const parseProductDownloadAsset = (asset: ProductDownloadAsset): ProductDownloadAsset =>
  productDownloadAssetSchema.parse(asset);

const parseGrant = (grant: ProductGrant): ProductGrant => productGrantSchema.parse(grant);

const parseOrder = (order: Order): Order => orderSchema.parse(order);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsPattern = (value: string): string =>
  `%${value.replace(/[\\%_]/g, '\\$&')}%`;

const replaceEmailInText = (
  value: string,
  email: string,
  replacement: string,
): string =>
  value.replace(new RegExp(escapeRegExp(email), 'gi'), () => replacement);

const replaceEmailInJson = (
  value: unknown,
  email: string,
  replacement: string,
): unknown => {
  if (typeof value === 'string') {
    return replaceEmailInText(value, email, replacement);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceEmailInJson(item, email, replacement));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        replaceEmailInText(key, email, replacement),
        replaceEmailInJson(item, email, replacement),
      ]),
    );
  }
  return value;
};

const replaceEmailInMeta = (
  value: Record<string, unknown>,
  email: string,
  replacement: string,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      replaceEmailInText(key, email, replacement),
      replaceEmailInJson(item, email, replacement),
    ]),
  );

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
const parsePostReport = (report: typeof postReports.$inferSelect): PostReport =>
  postReportSchema.parse(report);

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

const countThreadReplies = async (
  db: Db,
  tenantId: string,
  post: { id: string; rootPostId: string },
): Promise<number> => {
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
  return counts[0]?.value ?? 0;
};

const parseSpace = (space: typeof spaces.$inferSelect): Space => spaceSchema.parse(space);

const parseNotification = (notification: typeof notifications.$inferSelect): Notification =>
  notificationSchema.parse(notification);

const notificationCursor = (notification: { createdAt: string; id: string }): string =>
  `${notification.createdAt}|${notification.id}`;

const parseNotificationCursor = (cursor: string): { createdAt: string; id: string } => {
  const separator = cursor.indexOf('|');
  return {
    createdAt: cursor.slice(0, separator),
    id: cursor.slice(separator + 1),
  };
};

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

export const createProductRepository = (
  db: Db,
): ProductRepository & ProductBatchReader & ProductMetadataRepository => ({
  listByTenant: async (tenantId) =>
    (await db.select().from(products).where(eq(products.tenantId, tenantId)).orderBy(asc(products.createdAt), asc(products.id))).map(
      parseProduct,
    ),
  listPublishedByTenant: async (tenantId) =>
    (
      await db
        .select()
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.published, true)))
        .orderBy(asc(products.createdAt), asc(products.id))
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
  findByIds: async (tenantId, ids) => {
    if (ids.length === 0) return [];
    return (
      await db
        .select()
        .from(products)
        .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)))
    ).map(parseProduct);
  },
  create: async (tenantId, product) => {
    try {
      await db.insert(products).values({
        id: product.id,
        tenantId,
        type: product.type,
        slug: product.slug,
        title: product.title,
        description: product.description,
        coverUrl: product.coverUrl,
        priceCents: product.priceCents,
        currency: product.currency,
        published: product.published,
        accessItems: product.accessItems,
        checkoutConsentDefinitionIds: product.checkoutConsentDefinitionIds ?? [],
        legacyId: product.legacyId,
        createdAt: product.createdAt,
      });
      return 'created';
    } catch (cause) {
      if (uniqueViolation(cause, 'products_tenant_slug_uidx')) return 'slug_taken';
      throw cause;
    }
  },
  update: async (tenantId, product, version) => db.transaction(async (tx) => {
    await insertEntityVersion(tx, tenantId, version);
    const rows = await tx
      .update(products)
      .set({
        title: product.title,
        description: product.description,
        coverUrl: product.coverUrl,
      })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, product.id)))
      .returning();
    const row = rows[0];
    return row ? parseProduct(row) : null;
  }),
  updateAccessItems: async (tenantId, id, accessItems, version, checkoutConsentDefinitionIds) => {
    const apply = async (executor: Db): Promise<Product | null> => {
      const changes = checkoutConsentDefinitionIds === undefined
        ? { accessItems }
        : { accessItems, checkoutConsentDefinitionIds };
      const rows = await executor
        .update(products)
        .set(changes)
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
          publiclyVisible: course.publiclyVisible,
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
  listPreviews: async (tenantId) => {
    const [lessonRows, moduleRows] = await Promise.all([
      db
        .select({ id: courseLessons.id, name: courseLessons.name })
        .from(courseLessons)
        .where(and(eq(courseLessons.tenantId, tenantId), eq(courseLessons.isPreview, true)))
        .orderBy(asc(courseLessons.createdAt)),
      db
        .select({ courseIds: courseModules.courseIds, chapters: courseModules.chapters })
        .from(courseModules)
        .where(eq(courseModules.tenantId, tenantId))
        .orderBy(asc(courseModules.createdAt)),
    ]);
    const lessonById = new Map(lessonRows.map((lesson) => [lesson.id, lesson]));
    const seen = new Set<string>();
    const previews = [];
    for (const module of moduleRows) {
      for (const chapter of module.chapters) {
        for (const content of chapter.contents) {
          const lesson = lessonById.get(content.lessonId);
          if (lesson === undefined) continue;
          for (const courseId of module.courseIds) {
            const key = `${courseId}:${lesson.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            previews.push({ ...lesson, courseId });
          }
        }
      }
    }
    return previews;
  },
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
          isPreview: lesson.isPreview,
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

export const createLessonAttachmentRepository = (db: Db): LessonAttachmentRepository => ({
  create: async (tenantId, attachment) => {
    await db.insert(lessonAttachments).values({ ...attachment, tenantId });
  },
  findById: async (tenantId, attachmentId) => {
    const rows = await db
      .select()
      .from(lessonAttachments)
      .where(and(eq(lessonAttachments.tenantId, tenantId), eq(lessonAttachments.id, attachmentId)))
      .limit(1);
    const row = rows[0];
    return row ? parseLessonAttachment(row) : null;
  },
  listByLesson: async (tenantId, lessonId) =>
    (
      await db
        .select()
        .from(lessonAttachments)
        .where(and(
          eq(lessonAttachments.tenantId, tenantId),
          eq(lessonAttachments.lessonId, lessonId),
        ))
        .orderBy(asc(lessonAttachments.createdAt))
    ).map(parseLessonAttachment),
  listReadyByLesson: async (tenantId, lessonId) =>
    (
      await db
        .select()
        .from(lessonAttachments)
        .where(and(
          eq(lessonAttachments.tenantId, tenantId),
          eq(lessonAttachments.lessonId, lessonId),
          eq(lessonAttachments.status, 'ready'),
        ))
        .orderBy(asc(lessonAttachments.createdAt))
    ).map(parseLessonAttachment),
  markReady: async (tenantId, attachmentId, sizeBytes) => {
    const rows = await db
      .update(lessonAttachments)
      .set({ status: 'ready', sizeBytes })
      .where(and(eq(lessonAttachments.tenantId, tenantId), eq(lessonAttachments.id, attachmentId)))
      .returning();
    const row = rows[0];
    return row ? parseLessonAttachment(row) : null;
  },
  delete: async (tenantId, attachmentId) => {
    const rows = await db
      .delete(lessonAttachments)
      .where(and(eq(lessonAttachments.tenantId, tenantId), eq(lessonAttachments.id, attachmentId)))
      .returning({ id: lessonAttachments.id });
    return rows.length > 0;
  },
});

export const createProductDownloadAssetRepository = (db: Db): ProductDownloadAssetRepository => ({
  create: async (tenantId, asset) => {
    await db.insert(productDownloadAssets).values({ ...asset, tenantId });
  },
  findById: async (tenantId, assetId) => {
    const rows = await db
      .select()
      .from(productDownloadAssets)
      .where(and(eq(productDownloadAssets.tenantId, tenantId), eq(productDownloadAssets.id, assetId)))
      .limit(1);
    const row = rows[0];
    return row ? parseProductDownloadAsset(row) : null;
  },
  listByProduct: async (tenantId, productId) =>
    (
      await db
        .select()
        .from(productDownloadAssets)
        .where(and(
          eq(productDownloadAssets.tenantId, tenantId),
          eq(productDownloadAssets.productId, productId),
        ))
        .orderBy(asc(productDownloadAssets.createdAt))
    ).map(parseProductDownloadAsset),
  listReadyByProduct: async (tenantId, productId) =>
    (
      await db
        .select()
        .from(productDownloadAssets)
        .where(and(
          eq(productDownloadAssets.tenantId, tenantId),
          eq(productDownloadAssets.productId, productId),
          eq(productDownloadAssets.status, 'ready'),
        ))
        .orderBy(asc(productDownloadAssets.createdAt))
    ).map(parseProductDownloadAsset),
  markReady: async (tenantId, assetId, sizeBytes) => {
    const rows = await db
      .update(productDownloadAssets)
      .set({ status: 'ready', sizeBytes })
      .where(and(eq(productDownloadAssets.tenantId, tenantId), eq(productDownloadAssets.id, assetId)))
      .returning();
    const row = rows[0];
    return row ? parseProductDownloadAsset(row) : null;
  },
  delete: async (tenantId, assetId) => {
    const rows = await db
      .delete(productDownloadAssets)
      .where(and(eq(productDownloadAssets.tenantId, tenantId), eq(productDownloadAssets.id, assetId)))
      .returning({ id: productDownloadAssets.id });
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
  findDisplayNames: async (tenantId, userIds) => {
    if (userIds.length === 0) return new Map();
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(
        and(
          inArray(user.id, userIds),
          or(
            exists(
              db
                .select({ id: tenantAdmins.id })
                .from(tenantAdmins)
                .where(
                  and(eq(tenantAdmins.tenantId, tenantId), eq(tenantAdmins.userId, user.id)),
                ),
            ),
            exists(
              db
                .select({ id: members.id })
                .from(members)
                .where(and(eq(members.tenantId, tenantId), eq(members.userId, user.id))),
            ),
          ),
        ),
      );
    return new Map(
      rows.map((row) => [row.id, row.name.trim().length > 0 ? row.name.trim() : row.email]),
    );
  },
});

export const createAvatarSourceReader = (db: Db): AvatarSourceReader => ({
  listAvatarSources: async (tenantId, userIds) => {
    if (userIds.length === 0) return [];
    const rows = await db
      .select({
        userId: user.id,
        accountEmail: user.email,
        memberEmail: members.email,
        image: user.image,
      })
      .from(user)
      .leftJoin(members, and(eq(members.tenantId, tenantId), eq(members.userId, user.id)))
      .where(
        and(
          inArray(user.id, userIds),
          or(
            isNotNull(members.id),
            exists(
              db
                .select({ id: tenantAdmins.id })
                .from(tenantAdmins)
                .where(
                  and(eq(tenantAdmins.tenantId, tenantId), eq(tenantAdmins.userId, user.id)),
                ),
            ),
          ),
        ),
      );
    return rows.map((row) => ({
      userId: row.userId,
      email: row.memberEmail ?? row.accountEmail,
      image: row.image,
    }));
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
  update: async (tenantId, progress) => db.transaction(async (tx) => {
    const [current] = await tx
      .select({ completedLessonIds: memberCourseProgress.completedLessonIds })
      .from(memberCourseProgress)
      .where(and(eq(memberCourseProgress.tenantId, tenantId), eq(memberCourseProgress.id, progress.id)))
      .for('update');
    const rows = await tx
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
    if (row === undefined) return null;
    const previous = new Set(current?.completedLessonIds ?? []);
    for (const lessonId of progress.completedLessonIds) {
      if (previous.has(lessonId)) continue;
      await appendMemberEvent(tx, memberEventSchema.parse({
        id: `lesson-completion:${progress.id}:${lessonId}:${progress.updatedAt}`,
        tenantId,
        memberId: row.memberId,
        type: 'lesson-completion',
        payload: { courseId: progress.courseId, lessonId },
        occurredAt: progress.updatedAt,
      }));
    }
    return parseProgress({
      ...row,
      lastViewedLessonId: row.lastViewedLessonId ?? undefined,
      lastViewedModuleId: row.lastViewedModuleId ?? undefined,
      lastViewedChapterId: row.lastViewedChapterId ?? undefined,
    });
  }),
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
  createPost: async (tenantId, post, fanoutJob) => {
    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(posts)
        .values({ ...post, tenantId })
        .returning();
      if (fanoutJob !== undefined) await insertFanoutJob(tx, tenantId, fanoutJob);
      return inserted[0];
    });
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
  findByIds: async (tenantId, ids) => {
    if (ids.length === 0) return [];
    const rows = await db
      .select()
      .from(posts)
      .where(and(eq(posts.tenantId, tenantId), inArray(posts.id, ids)));
    return rows.map(parsePost);
  },
  countByAuthorSince: async (tenantId, query) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(
        eq(posts.tenantId, tenantId),
        eq(posts.authorUserId, query.authorUserId),
        gte(posts.createdAt, query.since),
        isNull(posts.deletedAt),
      ));
    return rows[0]?.value ?? 0;
  },
  listRecentBodiesByAuthor: async (tenantId, query) =>
    (
      await db
        .select({ body: posts.body })
        .from(posts)
        .where(and(
          eq(posts.tenantId, tenantId),
          eq(posts.authorUserId, query.authorUserId),
          gte(posts.createdAt, query.since),
          isNull(posts.deletedAt),
        ))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(query.limit)
    ).map((row) => row.body),
  listByAuthor: async (tenantId, authorUserId) =>
    (
      await db
        .select()
        .from(posts)
        .where(and(eq(posts.tenantId, tenantId), eq(posts.authorUserId, authorUserId)))
        .orderBy(asc(posts.createdAt), asc(posts.id))
    ).map(parsePost),
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
      page.map(async (post) => ({
        post: parsePost(post),
        replyCount: await countThreadReplies(db, tenantId, post),
      })),
    );
    const last = page.at(-1);
    return {
      threads,
      // Cursor = last item of the page, so the overflow row opens the next page.
      nextCursor: overflow && last ? threadCursor(last) : null,
    };
  },
  listThreadsForSpaces: async (tenantId, query) => {
    if (query.spaceIds.length === 0) return { threads: [], nextCursor: null };
    const cursor = query.cursor === undefined ? null : parseThreadCursor(query.cursor);
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          eq(posts.contextKind, 'space'),
          inArray(posts.contextId, query.spaceIds),
          sql`${posts.parentPostId} is null`,
          ...(cursor === null
            ? []
            : [sql`(${posts.createdAt}, ${posts.id}) < (${cursor.createdAt}, ${cursor.id})`]),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const overflow = rows[query.limit];
    const threads = await Promise.all(
      page.map(async (post) => ({
        post: parsePost(post),
        replyCount: await countThreadReplies(db, tenantId, post),
      })),
    );
    const last = page.at(-1);
    return { threads, nextCursor: overflow && last ? threadCursor(last) : null };
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
      .set({ deletedAt: input.deletedAt, pinnedAt: null })
      .where(and(eq(posts.tenantId, tenantId), eq(posts.id, input.id)))
      .returning();
    const row = rows[0];
    return row ? parsePost(row) : null;
  },
  setPinned: async (tenantId, input) => {
    const rows = await db
      .update(posts)
      .set({ pinnedAt: input.pinnedAt })
      .where(and(eq(posts.tenantId, tenantId), eq(posts.id, input.id)))
      .returning();
    const row = rows[0];
    return row ? parsePost(row) : null;
  },
  listPinnedForContext: async (tenantId, query) =>
    (
      await db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.tenantId, tenantId),
            eq(posts.contextKind, query.contextKind),
            eq(posts.contextId, query.contextId),
            isNotNull(posts.pinnedAt),
          ),
        )
        .orderBy(desc(posts.pinnedAt), desc(posts.id))
        .limit(query.limit)
    ).map(parsePost),
  countPinnedForContext: async (tenantId, query) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          eq(posts.contextKind, query.contextKind),
          eq(posts.contextId, query.contextId),
          isNotNull(posts.pinnedAt),
        ),
      );
    return rows[0]?.value ?? 0;
  },
  latestRootPostAt: async (tenantId, spaceIds) => {
    if (spaceIds.length === 0) return new Map();
    const rows = await db
      .select({ spaceId: posts.contextId, latestAt: sql<string>`max(${posts.createdAt})` })
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          eq(posts.contextKind, 'space'),
          inArray(posts.contextId, spaceIds),
          isNull(posts.parentPostId),
          isNull(posts.deletedAt),
        ),
      )
      .groupBy(posts.contextId);
    return new Map(rows.map((row) => [row.spaceId, row.latestAt]));
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

export const createPostReportRepository = (db: Db): PostReportRepository => ({
  open: async (tenantId, report, event) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .insert(postReports)
        .values({ ...report, tenantId })
        .onConflictDoNothing()
        .returning();
      const row = rows[0];
      if (!row) return null;
      await tx.insert(postReportEvents).values({ ...event, tenantId });
      return parsePostReport(row);
    }),
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(postReports)
      .where(and(eq(postReports.tenantId, tenantId), eq(postReports.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parsePostReport(row) : null;
  },
  listByStatus: async (tenantId, query) => {
    const cursor = query.cursor === undefined ? null : parseThreadCursor(query.cursor);
    const rows = await db
      .select()
      .from(postReports)
      .where(and(
        eq(postReports.tenantId, tenantId),
        eq(postReports.status, query.status),
        ...(cursor === null
          ? []
          : [sql`(${postReports.createdAt}, ${postReports.id}) < (${cursor.createdAt}, ${cursor.id})`]),
      ))
      .orderBy(desc(postReports.createdAt), desc(postReports.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      reports: page.map(parsePostReport),
      nextCursor: rows[query.limit] && last ? threadCursor(last) : null,
    };
  },
  countOpenByPost: async (tenantId, postIds) => {
    if (postIds.length === 0) return new Map();
    const rows = await db
      .select({ postId: postReports.postId, value: sql<number>`count(*)::int` })
      .from(postReports)
      .where(and(
        eq(postReports.tenantId, tenantId),
        eq(postReports.status, 'open'),
        inArray(postReports.postId, postIds),
      ))
      .groupBy(postReports.postId);
    return new Map(rows.map((row) => [row.postId, row.value]));
  },
  countOpen: async (tenantId) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(postReports)
      .where(and(eq(postReports.tenantId, tenantId), eq(postReports.status, 'open')));
    return rows[0]?.value ?? 0;
  },
  resolve: async (tenantId, input, event) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .update(postReports)
        .set({
          status: input.status,
          resolvedAt: input.resolvedAt,
          resolvedByUserId: input.resolvedByUserId,
        })
        .where(and(
          eq(postReports.tenantId, tenantId),
          eq(postReports.id, input.id),
          eq(postReports.status, 'open'),
        ))
        .returning();
      const row = rows[0];
      if (!row) return null;
      await tx.insert(postReportEvents).values({ ...event, tenantId });
      return parsePostReport(row);
    }),
  resolveAllForPost: async (tenantId, input, event) =>
    db.transaction(async (tx) => {
      const open = await tx
        .select({ id: postReports.id })
        .from(postReports)
        .where(and(
          eq(postReports.tenantId, tenantId),
          eq(postReports.postId, input.postId),
          eq(postReports.status, 'open'),
        ));
      if (open.length === 0) return 0;
      await tx
        .update(postReports)
        .set({
          status: 'resolved',
          resolvedAt: input.resolvedAt,
          resolvedByUserId: input.resolvedByUserId,
        })
        .where(and(
          eq(postReports.tenantId, tenantId),
          eq(postReports.postId, input.postId),
          eq(postReports.status, 'open'),
        ));
      await tx.insert(postReportEvents).values(open.map(({ id }) => ({ ...event(id), tenantId })));
      return open.length;
    }),
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
  listSubscribersPage: async (tenantId, query) =>
    db
      .select()
      .from(threadSubscriptions)
      .where(
        and(
          eq(threadSubscriptions.tenantId, tenantId),
          eq(threadSubscriptions.rootPostId, query.rootPostId),
          ...(query.afterUserId === null ? [] : [gt(threadSubscriptions.userId, query.afterUserId)]),
        ),
      )
      .orderBy(asc(threadSubscriptions.userId))
      .limit(query.limit),
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
        publicReadOnly: space.publicReadOnly,
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

const parseSpaceEvent = (row: typeof spaceEvents.$inferSelect): SpaceEvent =>
  spaceEventSchema.parse(row);

const eventCursor = (row: { id: string; startsAt: string }): string =>
  `${row.startsAt}|${row.id}`;

const parseEventCursor = (cursor: string): { startsAt: string; id: string } => {
  const separator = cursor.indexOf('|');
  return { startsAt: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
};

export const createSpaceEventRepository = (db: Db): SpaceEventRepository => ({
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(spaceEvents)
      .where(and(eq(spaceEvents.tenantId, tenantId), eq(spaceEvents.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parseSpaceEvent(row) : null;
  },
  insert: async (tenantId, event, fanoutJob) => {
    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(spaceEvents)
        .values({ ...event, tenantId })
        .returning();
      if (fanoutJob !== undefined) await insertFanoutJob(tx, tenantId, fanoutJob);
      return inserted[0];
    });
    if (!row) throw new Error('space_events insert returned no row');
    return parseSpaceEvent(row);
  },
  update: async (tenantId, event) => {
    const rows = await db
      .update(spaceEvents)
      .set({
        title: event.title,
        description: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        location: event.location,
        url: event.url,
        liveEmbedUrl: event.liveEmbedUrl,
        replayUrl: event.replayUrl,
        discussionRootPostId: event.discussionRootPostId,
        updatedAt: event.updatedAt,
      })
      .where(and(eq(spaceEvents.tenantId, tenantId), eq(spaceEvents.id, event.id)))
      .returning();
    const row = rows[0];
    return row ? parseSpaceEvent(row) : null;
  },
  softDelete: async (tenantId, input) => {
    const rows = await db
      .update(spaceEvents)
      .set({ deletedAt: input.deletedAt })
      .where(and(eq(spaceEvents.tenantId, tenantId), eq(spaceEvents.id, input.id)))
      .returning();
    const row = rows[0];
    return row ? parseSpaceEvent(row) : null;
  },
  listForSpace: async (tenantId, query) => {
    const cursor = query.cursor === undefined ? null : parseEventCursor(query.cursor);
    const upcoming = query.scope === 'upcoming';
    const rows = await db
      .select()
      .from(spaceEvents)
      .where(
        and(
          eq(spaceEvents.tenantId, tenantId),
          eq(spaceEvents.spaceId, query.spaceId),
          isNull(spaceEvents.deletedAt),
          upcoming
            ? gte(spaceEvents.endsAt, query.now)
            : sql`${spaceEvents.endsAt} < ${query.now}`,
          ...(cursor === null
            ? []
            : [
                upcoming
                  ? sql`(${spaceEvents.startsAt}, ${spaceEvents.id}) > (${cursor.startsAt}, ${cursor.id})`
                  : sql`(${spaceEvents.startsAt}, ${spaceEvents.id}) < (${cursor.startsAt}, ${cursor.id})`,
              ]),
        ),
      )
      .orderBy(
        upcoming ? asc(spaceEvents.startsAt) : desc(spaceEvents.startsAt),
        upcoming ? asc(spaceEvents.id) : desc(spaceEvents.id),
      )
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const overflow = rows[query.limit];
    const last = page.at(-1);
    return {
      events: page.map(parseSpaceEvent),
      nextCursor: overflow && last ? eventCursor(last) : null,
    };
  },
  listUpcomingForSpaces: async (tenantId, query) => {
    if (query.spaceIds.length === 0) return [];
    const rows = await db
      .select()
      .from(spaceEvents)
      .where(
        and(
          eq(spaceEvents.tenantId, tenantId),
          inArray(spaceEvents.spaceId, query.spaceIds),
          isNull(spaceEvents.deletedAt),
          gte(spaceEvents.endsAt, query.now),
        ),
      )
      .orderBy(asc(spaceEvents.startsAt), asc(spaceEvents.id))
      .limit(query.limit);
    return rows.map(parseSpaceEvent);
  },
});

export const createSpaceEventRsvpRepository = (db: Db): SpaceEventRsvpRepository => ({
  upsert: async (tenantId, input) => {
    const rows = await db
      .insert(spaceEventRsvps)
      .values({
        tenantId,
        eventId: input.eventId,
        userId: input.userId,
        status: input.status,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: [spaceEventRsvps.tenantId, spaceEventRsvps.eventId, spaceEventRsvps.userId],
        set: { status: input.status, updatedAt: input.updatedAt },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('space_event_rsvps upsert returned no row');
    return spaceEventRsvpSchema.parse(row);
  },
  countsForEvents: async (tenantId, eventIds) => {
    const counts = new Map<string, { going: number; notGoing: number }>();
    if (eventIds.length === 0) return counts;
    for (const eventId of eventIds) counts.set(eventId, { going: 0, notGoing: 0 });
    const rows = await db
      .select({
        eventId: spaceEventRsvps.eventId,
        status: spaceEventRsvps.status,
        count: sql<number>`count(*)::int`,
      })
      .from(spaceEventRsvps)
      .where(and(eq(spaceEventRsvps.tenantId, tenantId), inArray(spaceEventRsvps.eventId, eventIds)))
      .groupBy(spaceEventRsvps.eventId, spaceEventRsvps.status);
    for (const row of rows) {
      const current = counts.get(row.eventId) ?? { going: 0, notGoing: 0 };
      counts.set(
        row.eventId,
        row.status === 'going'
          ? { ...current, going: row.count }
          : { ...current, notGoing: row.count },
      );
    }
    return counts;
  },
  listForViewer: async (tenantId, input) =>
    input.eventIds.length === 0
      ? []
      : (
          await db
            .select()
            .from(spaceEventRsvps)
            .where(
              and(
                eq(spaceEventRsvps.tenantId, tenantId),
                eq(spaceEventRsvps.userId, input.userId),
                inArray(spaceEventRsvps.eventId, input.eventIds),
              ),
            )
        ).map((row): SpaceEventRsvp => spaceEventRsvpSchema.parse(row)),
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
  listFollowersPage: async (tenantId, query) =>
    db
      .select()
      .from(spaceSubscriptions)
      .where(
        and(
          eq(spaceSubscriptions.tenantId, tenantId),
          eq(spaceSubscriptions.spaceId, query.spaceId),
          ...(query.afterUserId === null ? [] : [gt(spaceSubscriptions.userId, query.afterUserId)]),
        ),
      )
      .orderBy(asc(spaceSubscriptions.userId))
      .limit(query.limit),
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

export const createSpaceSeenRepository = (db: Db): SpaceSeenRepository => ({
  markSeen: async (tenantId, input) => {
    await db
      .insert(spaceSeenMarks)
      .values({ tenantId, userId: input.userId, spaceId: input.spaceId, seenAt: input.seenAt })
      .onConflictDoUpdate({
        target: [spaceSeenMarks.tenantId, spaceSeenMarks.userId, spaceSeenMarks.spaceId],
        set: { seenAt: input.seenAt },
      });
  },
  listForUser: async (tenantId, input) =>
    input.spaceIds.length === 0
      ? []
      : db
          .select({ spaceId: spaceSeenMarks.spaceId, seenAt: spaceSeenMarks.seenAt })
          .from(spaceSeenMarks)
          .where(
            and(
              eq(spaceSeenMarks.tenantId, tenantId),
              eq(spaceSeenMarks.userId, input.userId),
              inArray(spaceSeenMarks.spaceId, input.spaceIds),
            ),
          ),
});

const parseDmConversation = (row: typeof dmConversations.$inferSelect): DmConversation =>
  dmConversationSchema.parse(row);

const parseDmMessage = (row: typeof dmMessages.$inferSelect): DmMessage =>
  dmMessageSchema.parse(row);

const dmCursor = (row: { id: string }, at: string): string => `${at}|${row.id}`;

const parseDmCursor = (cursor: string): { at: string; id: string } => {
  const separator = cursor.indexOf('|');
  return { at: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
};

export const createDmConversationRepository = (db: Db): DmConversationRepository => ({
  findById: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(dmConversations)
      .where(and(eq(dmConversations.tenantId, tenantId), eq(dmConversations.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? parseDmConversation(row) : null;
  },
  findByParticipants: async (tenantId, pair) => {
    const rows = await db
      .select()
      .from(dmConversations)
      .where(
        and(
          eq(dmConversations.tenantId, tenantId),
          eq(dmConversations.participantLowUserId, pair.low),
          eq(dmConversations.participantHighUserId, pair.high),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? parseDmConversation(row) : null;
  },
  insert: async (tenantId, conversation) => {
    const rows = await db
      .insert(dmConversations)
      .values({ ...conversation, tenantId })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('dm_conversations insert returned no row');
    return parseDmConversation(row);
  },
  listForParticipant: async (tenantId, query) => {
    const cursor = query.cursor === undefined ? null : parseDmCursor(query.cursor);
    const rows = await db
      .select()
      .from(dmConversations)
      .where(
        and(
          eq(dmConversations.tenantId, tenantId),
          or(
            eq(dmConversations.participantLowUserId, query.userId),
            eq(dmConversations.participantHighUserId, query.userId),
          ),
          ...(cursor === null
            ? []
            : [sql`(${dmConversations.lastMessageAt}, ${dmConversations.id}) < (${cursor.at}, ${cursor.id})`]),
        ),
      )
      .orderBy(desc(dmConversations.lastMessageAt), desc(dmConversations.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const overflow = rows[query.limit];
    const last = page.at(-1);
    return {
      conversations: page.map(parseDmConversation),
      nextCursor: overflow && last ? dmCursor(last, last.lastMessageAt) : null,
    };
  },
  countCreatedBySince: async (tenantId, query) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(dmConversations)
      .where(
        and(
          eq(dmConversations.tenantId, tenantId),
          eq(dmConversations.createdByUserId, query.createdByUserId),
          gte(dmConversations.createdAt, query.since),
        ),
      );
    return rows[0]?.value ?? 0;
  },
  countUnreadForParticipant: async (tenantId, userId) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(dmConversations)
      .leftJoin(
        dmConversationStates,
        and(
          eq(dmConversationStates.tenantId, dmConversations.tenantId),
          eq(dmConversationStates.conversationId, dmConversations.id),
          eq(dmConversationStates.userId, userId),
        ),
      )
      .where(
        and(
          eq(dmConversations.tenantId, tenantId),
          or(
            eq(dmConversations.participantLowUserId, userId),
            eq(dmConversations.participantHighUserId, userId),
          ),
          isNotNull(dmConversations.lastMessageId),
          ne(dmConversations.lastMessageSenderUserId, userId),
          or(
            isNull(dmConversationStates.lastReadAt),
            sql`${dmConversations.lastMessageAt} > ${dmConversationStates.lastReadAt}`,
          ),
        ),
      );
    return rows[0]?.value ?? 0;
  },
  applyLastMessage: async (tenantId, input) => {
    const rows = await db
      .update(dmConversations)
      .set({
        lastMessageId: input.lastMessageId,
        lastMessageAt: input.lastMessageAt,
        lastMessageSnippet: input.lastMessageSnippet,
        lastMessageSenderUserId: input.lastMessageSenderUserId,
      })
      .where(
        and(eq(dmConversations.tenantId, tenantId), eq(dmConversations.id, input.conversationId)),
      )
      .returning();
    const row = rows[0];
    return row ? parseDmConversation(row) : null;
  },
});

export const createDmMessageRepository = (db: Db): DmMessageRepository => ({
  insert: async (tenantId, message) => {
    const rows = await db
      .insert(dmMessages)
      .values({ ...message, tenantId })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('dm_messages insert returned no row');
    return parseDmMessage(row);
  },
  listForConversation: async (tenantId, query) => {
    const cursor = query.cursor === undefined ? null : parseDmCursor(query.cursor);
    const rows = await db
      .select()
      .from(dmMessages)
      .where(
        and(
          eq(dmMessages.tenantId, tenantId),
          eq(dmMessages.conversationId, query.conversationId),
          ...(cursor === null
            ? []
            : [sql`(${dmMessages.createdAt}, ${dmMessages.id}) < (${cursor.at}, ${cursor.id})`]),
        ),
      )
      .orderBy(desc(dmMessages.createdAt), desc(dmMessages.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const overflow = rows[query.limit];
    const last = page.at(-1);
    return {
      messages: page.map(parseDmMessage),
      nextCursor: overflow && last ? dmCursor(last, last.createdAt) : null,
    };
  },
  countRecentBySender: async (tenantId, senderUserId, sinceIso) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(dmMessages)
      .where(
        and(
          eq(dmMessages.tenantId, tenantId),
          eq(dmMessages.senderUserId, senderUserId),
          gte(dmMessages.createdAt, sinceIso),
        ),
      );
    return rows[0]?.value ?? 0;
  },
});

export const createDmConversationStateRepository = (db: Db): DmConversationStateRepository => ({
  findForViewer: async (tenantId, input) =>
    input.conversationIds.length === 0
      ? []
      : (
          await db
            .select()
            .from(dmConversationStates)
            .where(
              and(
                eq(dmConversationStates.tenantId, tenantId),
                eq(dmConversationStates.userId, input.userId),
                inArray(dmConversationStates.conversationId, input.conversationIds),
              ),
            )
        ).map((row): DmConversationState => dmConversationStateSchema.parse(row)),
  markRead: async (tenantId, input) => {
    const rows = await db
      .insert(dmConversationStates)
      .values({
        tenantId,
        conversationId: input.conversationId,
        userId: input.userId,
        lastReadAt: input.lastReadAt,
      })
      .onConflictDoUpdate({
        target: [
          dmConversationStates.tenantId,
          dmConversationStates.conversationId,
          dmConversationStates.userId,
        ],
        set: { lastReadAt: input.lastReadAt },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('dm_conversation_states upsert returned no row');
    return dmConversationStateSchema.parse(row);
  },
});

export const createMemberBlockRepository = (db: Db): MemberBlockRepository => ({
  block: async (tenantId, block) => {
    const rows = await db
      .insert(memberBlocks)
      .values({ ...block, tenantId })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  },
  unblock: async (tenantId, input) => {
    const rows = await db
      .delete(memberBlocks)
      .where(
        and(
          eq(memberBlocks.tenantId, tenantId),
          eq(memberBlocks.blockerUserId, input.blockerUserId),
          eq(memberBlocks.blockedUserId, input.blockedUserId),
        ),
      )
      .returning();
    return rows.length > 0;
  },
  findDirections: async (tenantId, query) => {
    const directions = new Map<string, DmBlockDirections>(
      query.otherUserIds.map((userId) => [userId, { blockedByViewer: false, blocksViewer: false }]),
    );
    if (query.otherUserIds.length === 0) return directions;
    const rows = await db
      .select()
      .from(memberBlocks)
      .where(
        and(
          eq(memberBlocks.tenantId, tenantId),
          or(
            and(
              eq(memberBlocks.blockerUserId, query.viewerUserId),
              inArray(memberBlocks.blockedUserId, query.otherUserIds),
            ),
            and(
              eq(memberBlocks.blockedUserId, query.viewerUserId),
              inArray(memberBlocks.blockerUserId, query.otherUserIds),
            ),
          ),
        ),
      );
    for (const row of rows) {
      const viewerIsBlocker = row.blockerUserId === query.viewerUserId;
      const otherUserId = viewerIsBlocker ? row.blockedUserId : row.blockerUserId;
      const current = directions.get(otherUserId);
      if (current === undefined) continue;
      directions.set(otherUserId, {
        blockedByViewer: current.blockedByViewer || viewerIsBlocker,
        blocksViewer: current.blocksViewer || !viewerIsBlocker,
      });
    }
    return directions;
  },
});

const parseDmReport = (report: typeof dmReports.$inferSelect): DmReport =>
  dmReportSchema.parse(report);

export const createDmReportRepository = (db: Db): DmReportRepository => ({
  open: async (tenantId, report) => {
    const rows = await db
      .insert(dmReports)
      .values({ ...report, tenantId })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    return row ? parseDmReport(row) : null;
  },
  listByStatus: async (tenantId, query) => {
    const cursor = query.cursor === undefined ? null : parseThreadCursor(query.cursor);
    const rows = await db
      .select()
      .from(dmReports)
      .where(and(
        eq(dmReports.tenantId, tenantId),
        eq(dmReports.status, query.status),
        ...(cursor === null
          ? []
          : [sql`(${dmReports.createdAt}, ${dmReports.id}) < (${cursor.createdAt}, ${cursor.id})`]),
      ))
      .orderBy(desc(dmReports.createdAt), desc(dmReports.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      reports: page.map(parseDmReport),
      nextCursor: rows[query.limit] && last ? threadCursor(last) : null,
    };
  },
  countOpen: async (tenantId) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(dmReports)
      .where(and(eq(dmReports.tenantId, tenantId), eq(dmReports.status, 'open')));
    return rows[0]?.value ?? 0;
  },
  resolve: async (tenantId, input) => {
    const rows = await db
      .update(dmReports)
      .set({
        status: 'resolved',
        resolvedAt: input.resolvedAt,
        resolvedByUserId: input.resolvedByUserId,
      })
      .where(and(
        eq(dmReports.tenantId, tenantId),
        eq(dmReports.id, input.id),
        eq(dmReports.status, 'open'),
      ))
      .returning();
    const row = rows[0];
    return row ? parseDmReport(row) : null;
  },
});

const unreadDmConversationFilter = (
  tenantId: string,
  recipientUserId: string,
  conversationId: string,
): SQL[] => [
  eq(notifications.tenantId, tenantId),
  eq(notifications.recipientUserId, recipientUserId),
  eq(notifications.kind, 'dm-message'),
  sql`${notifications.readAt} is null`,
  sql`${notifications.payload}->>'contextId' = ${conversationId}`,
];

/** Keyed on the context rather than the kind, so a future DM-flavoured kind is excluded too. */
const notDirectMessage = (): SQL =>
  sql`${notifications.payload}->>'contextKind' is distinct from 'dm'`;

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
  insertMany: async (tenantId, batch) => {
    if (batch.length === 0) return [];
    const rows = await db
      .insert(notifications)
      .values(batch.map((notification) => ({ ...notification, tenantId })))
      .onConflictDoNothing({
        target: [notifications.tenantId, notifications.recipientUserId, notifications.sourceKey],
        where: sql`${notifications.sourceKey} is not null`,
      })
      .returning();
    return rows.map(parseNotification);
  },
  listForRecipient: async (tenantId, query) => {
    const cursor = query.cursor === undefined ? null : parseNotificationCursor(query.cursor);
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientUserId, query.recipientUserId),
          ...(query.excludeDms === true ? [notDirectMessage()] : []),
          ...(cursor === null
            ? []
            : [sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.createdAt}, ${cursor.id})`]),
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const overflow = rows[query.limit];
    const last = page.at(-1);
    return {
      notifications: page.map(parseNotification),
      nextCursor: overflow && last ? notificationCursor(last) : null,
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
  unreadCount: async (tenantId, recipientUserId, options) => {
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientUserId, recipientUserId),
          ...(options?.excludeDms === true ? [notDirectMessage()] : []),
          sql`${notifications.readAt} is null`,
        ),
      );
    return rows[0]?.value ?? 0;
  },
  hasUnreadDmNotification: async (tenantId, recipientUserId, conversationId) => {
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(...unreadDmConversationFilter(tenantId, recipientUserId, conversationId)))
      .limit(1);
    return rows.length > 0;
  },
  markDmConversationRead: async (tenantId, input) => {
    const rows = await db
      .update(notifications)
      .set({ readAt: input.readAt })
      .where(
        and(...unreadDmConversationFilter(tenantId, input.recipientUserId, input.conversationId)),
      )
      .returning({ id: notifications.id });
    return rows.length;
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
        bannedAt: members.bannedAt,
        bannedReason: members.bannedReason,
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
        members.bannedAt,
        members.bannedReason,
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
        language: member.language ?? null,
        tags: member.tags,
        marketingConsents: member.marketingConsents,
        externalCustomerIds: member.externalCustomerIds,
        createdAt: member.createdAt,
        deletedAt: member.deletedAt,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
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
  updateDisplayName: async (tenantId, memberId, displayName) => {
    const rows = await db
      .update(members)
      .set({ displayName })
      .where(and(
        eq(members.tenantId, tenantId),
        eq(members.id, memberId),
        isNull(members.deletedAt),
      ))
      .returning();
    return rows[0] ?? null;
  },
  updateLanguage: async (tenantId, memberId, language) => {
    const rows = await db
      .update(members)
      .set({ language })
      .where(and(
        eq(members.tenantId, tenantId),
        eq(members.id, memberId),
        isNull(members.deletedAt),
      ))
      .returning();
    return rows[0] ?? null;
  },
  updateVideoAutoplay: async (tenantId, memberId, videoAutoplay) => {
    const rows = await db
      .update(members)
      .set({ videoAutoplay })
      .where(and(
        eq(members.tenantId, tenantId),
        eq(members.id, memberId),
        isNull(members.deletedAt),
      ))
      .returning();
    return rows[0] ?? null;
  },
  updateDmOptOut: async (tenantId, memberId, dmOptOutAt) => {
    const rows = await db
      .update(members)
      .set({ dmOptOutAt })
      .where(and(
        eq(members.tenantId, tenantId),
        eq(members.id, memberId),
        isNull(members.deletedAt),
      ))
      .returning();
    return rows[0] ?? null;
  },
  setBanned: async (tenantId, input, event) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .update(members)
        .set({
          bannedAt: input.bannedAt,
          bannedReason: input.reason,
          bannedByUserId: input.bannedAt === null ? null : input.actorUserId,
        })
        .where(and(
          eq(members.tenantId, tenantId),
          eq(members.id, input.memberId),
          isNull(members.deletedAt),
        ))
        .returning();
      const row = rows[0];
      if (!row) return null;
      await appendMemberEvent(tx, memberEventSchema.parse({ ...event, tenantId }));
      return row;
    }),
});

const erasedDmSnapshot = (display: string, senderIsReporter: boolean): SQL =>
  sql`(
    select coalesce(
      jsonb_agg(
        case
          when (entry->>'senderIsReporter')::boolean = ${senderIsReporter}::boolean
            then jsonb_set(entry, '{senderDisplay}', to_jsonb(${display}::text))
          else entry
        end
        order by idx
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(${dmReports.snapshot}) with ordinality as tail(entry, idx)
  )`;

export const createMemberErasureRepository = (db: Db, emailHmac: EmailHmac): MemberErasurePort => ({
  pseudonymize: async (tenantId, input) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(members)
        .where(and(eq(members.tenantId, tenantId), eq(members.id, input.memberId)))
        .limit(1);
      const member = rows[0];
      if (!member) return null;
      if (member.deletedAt !== null) {
        return {
          alreadyDeleted: true,
          authUserErased: false,
          erasureRequestId: null,
        };
      }
      const [openErasureRequest] = await tx
        .select({ id: memberErasureRequests.id })
        .from(memberErasureRequests)
        .where(
          and(
            eq(memberErasureRequests.tenantId, tenantId),
            eq(memberErasureRequests.memberId, input.memberId),
            eq(memberErasureRequests.status, 'open'),
          ),
        )
        .limit(1);

      await tx.insert(erasedMemberImports).values({
        memberId: member.id,
        tenantId,
        legacyId: member.legacyId,
        emailHmac: emailHmac.compute(tenantId, member.email),
        erasedAt: input.deletedAt,
      }).onConflictDoNothing({ target: erasedMemberImports.memberId });

      await tx.update(consents).set({ retentionStartedAt: input.deletedAt }).where(and(
        eq(consents.tenantId, tenantId),
        or(eq(consents.userId, member.userId), eq(consents.email, member.email)),
        isNull(consents.retentionStartedAt),
      ));
      await tx.update(marketingConsents).set({ retentionStartedAt: input.deletedAt }).where(and(
        eq(marketingConsents.tenantId, tenantId),
        or(eq(marketingConsents.memberId, member.id), eq(marketingConsents.email, member.email)),
        isNull(marketingConsents.retentionStartedAt),
      ));

      await tx
        .update(productGrants)
        .set({ expiresAt: input.deletedAt, legacyId: null })
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
        .update(postReports)
        .set({ reporterDisplay: input.postAuthorDisplay })
        .where(and(
          eq(postReports.tenantId, tenantId),
          eq(postReports.reporterUserId, member.userId),
        ));

      await tx
        .update(dmReports)
        .set({
          reporterDisplay: input.postAuthorDisplay,
          snapshot: erasedDmSnapshot(input.postAuthorDisplay, true),
        })
        .where(and(eq(dmReports.tenantId, tenantId), eq(dmReports.reporterUserId, member.userId)));
      await tx
        .update(dmReports)
        .set({
          reportedDisplay: input.postAuthorDisplay,
          snapshot: erasedDmSnapshot(input.postAuthorDisplay, false),
        })
        .where(and(eq(dmReports.tenantId, tenantId), eq(dmReports.reportedUserId, member.userId)));
      await tx
        .delete(memberBlocks)
        .where(and(
          eq(memberBlocks.tenantId, tenantId),
          or(
            eq(memberBlocks.blockerUserId, member.userId),
            eq(memberBlocks.blockedUserId, member.userId),
          ),
        ));

      await tx
        .update(members)
        .set({
          userId: input.severedUserId,
          email: input.tombstoneEmail,
          displayName: null,
          tags: [],
          marketingConsents: {},
          externalCustomerIds: {},
          legacyId: null,
          deletedAt: input.deletedAt,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
        })
        .where(and(eq(members.tenantId, tenantId), eq(members.id, input.memberId)));

      await tx.insert(suppressions).values({
        id: sql`gen_random_uuid()::text`, tenantId, email: null,
        emailHmac: emailHmac.compute(tenantId, member.email), reason: 'erasure',
        sourceRef: input.memberId, createdAt: input.deletedAt,
      }).onConflictDoNothing();
      await tx
        .update(campaignSends)
        .set({ memberId: null, email: input.tombstoneEmail })
        .where(and(
          eq(campaignSends.tenantId, tenantId),
          eq(campaignSends.memberId, input.memberId),
          eq(campaignSends.email, member.email),
        ));
      await tx
        .update(couponRedemptions)
        .set({ email: input.tombstoneEmail })
        .where(and(
          eq(couponRedemptions.tenantId, tenantId),
          eq(couponRedemptions.memberId, input.memberId),
        ));
      await tx
        .update(couponCheckoutSessions)
        .set({ memberEmail: input.tombstoneEmail })
        .where(and(
          eq(couponCheckoutSessions.tenantId, tenantId),
          sql`lower(${couponCheckoutSessions.memberEmail}) = lower(${member.email})`,
        ));

      const eventRows = await tx
        .select({ id: emailEvents.id, meta: emailEvents.meta })
        .from(emailEvents)
        .where(
          and(
            eq(emailEvents.tenantId, tenantId),
            isNotNull(emailEvents.meta),
            sql`${emailEvents.meta}::text ilike ${containsPattern(member.email)} escape '\\'`,
          ),
        );
      for (const event of eventRows) {
        if (event.meta === null) continue;
        const meta = replaceEmailInMeta(event.meta, member.email, input.tombstoneEmail);
        if (JSON.stringify(meta) === JSON.stringify(event.meta)) continue;
        await tx
          .update(emailEvents)
          .set({ meta })
          .where(and(eq(emailEvents.tenantId, tenantId), eq(emailEvents.id, event.id)));
      }

      const memberLinks = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(members)
        .where(eq(members.userId, member.userId));
      const staffLinks = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(tenantAdmins)
        .where(eq(tenantAdmins.userId, member.userId));
      const linked = (memberLinks[0]?.value ?? 0) + (staffLinks[0]?.value ?? 0);
      if (openErasureRequest !== undefined) {
        await tx
          .update(memberErasureRequests)
          .set({
            status: 'completed',
            resolvedAt: input.deletedAt,
            resolvedByUserId: null,
            resolutionNote: null,
          })
          .where(
            and(
              eq(memberErasureRequests.tenantId, tenantId),
              eq(memberErasureRequests.id, openErasureRequest.id),
              eq(memberErasureRequests.status, 'open'),
            ),
          );
        await tx.insert(memberErasureRequestEvents).values({
          id: sql`gen_random_uuid()::text`,
          tenantId,
          requestId: openErasureRequest.id,
          type: 'completed',
          actorUserId: null,
          meta: null,
          occurredAt: input.deletedAt,
          createdAt: input.deletedAt,
        });
      }
      if (linked > 0) {
        return {
          alreadyDeleted: false,
          authUserErased: false,
          erasureRequestId: openErasureRequest?.id ?? null,
        };
      }

      await tx.delete(user).where(eq(user.id, member.userId));
      return {
        alreadyDeleted: false,
        authUserErased: true,
        erasureRequestId: openErasureRequest?.id ?? null,
      };
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
  createGrant: async (tenantId, grant) => db.transaction(async (tx) => {
    const rows = await tx
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
      .returning();
    const row = rows[0];
    if (row === undefined) return false;
    await appendMemberEvent(tx, memberEventSchema.parse({
      id: `grant:${row.id}:${row.startsAt}:${row.expiresAt ?? 'perpetual'}`,
      tenantId,
      memberId: row.memberId,
      type: 'grant',
      payload: {
        grantId: row.id,
        productId: row.productId,
        source: row.source,
        startsAt: row.startsAt,
        expiresAt: row.expiresAt,
      },
      occurredAt: row.createdAt,
    }));
    return true;
  }),
  setGrantWindow: async (tenantId, grantId, window) => db.transaction(async (tx) => {
    const rows = await tx
      .update(productGrants)
      .set({ startsAt: window.startsAt, expiresAt: window.expiresAt })
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, grantId)))
      .returning();
    const row = rows[0];
    if (row === undefined) return null;
    await appendMemberEvent(tx, memberEventSchema.parse({
      id: `grant:${row.id}:${row.startsAt}:${row.expiresAt ?? 'perpetual'}`,
      tenantId,
      memberId: row.memberId,
      type: 'grant',
      payload: {
        grantId: row.id,
        productId: row.productId,
        source: row.source,
        startsAt: row.startsAt,
        expiresAt: row.expiresAt,
      },
      occurredAt: window.occurredAt,
    }));
    return parseGrant(row);
  }),
  revokeGrant: async (tenantId, grantId, expiresAt) => db.transaction(async (tx) => {
    const rows = await tx
      .update(productGrants)
      .set({ expiresAt })
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, grantId)))
      .returning();
    const row = rows[0];
    if (row === undefined) return null;
    await appendMemberEvent(tx, memberEventSchema.parse({
      id: `revoke:${row.id}:${expiresAt}`,
      tenantId,
      memberId: row.memberId,
      type: 'revoke',
      payload: { grantId: row.id, productId: row.productId, expiresAt },
      occurredAt: expiresAt,
    }));
    return parseGrant(row);
  }),
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
          type: products.type,
          slug: products.slug,
          title: products.title,
          description: products.description,
          coverUrl: products.coverUrl,
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

export const createOrderRepository = (
  db: Db,
): OrderRepository & OrderDetailRepository & MemberOrderListReader => {
  const conditionsFor = (tenantId: string, query: Parameters<OrderRepository['list']>[1]): SQL[] => {
    const conditions: SQL[] = [eq(orders.tenantId, tenantId)];
    if (query.status !== undefined) conditions.push(eq(orders.status, query.status));
    if (query.productId !== undefined) conditions.push(eq(orders.productId, query.productId));
    if (query.kind !== undefined) conditions.push(eq(orders.kind, query.kind));
    if (query.couponId !== undefined) conditions.push(eq(orders.couponId, query.couponId));
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
    create: async (tenantId, order) => db.transaction(async (tx) => {
      const rows = await tx
        .insert(orders)
        .values({
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
          couponId: order.couponId,
          discountCents: order.discountCents,
          billing: order.billing ?? null,
          createdAt: order.createdAt,
        })
        .onConflictDoNothing()
        .returning();
      const row = rows[0];
      if (row === undefined) return;
      await appendMemberEvent(tx, memberEventSchema.parse({
        id: `purchase:${row.id}`,
        tenantId,
        memberId: row.memberId,
        type: 'purchase',
        payload: {
          orderId: row.id,
          productId: row.productId,
          kind: row.kind,
          status: row.status,
          amountCents: row.amountCents,
          currency: row.currency,
          provider: row.provider,
        },
        occurredAt: row.createdAt,
      }));
    }),
    findById: async (tenantId, id) => {
      const rows = await db
        .select({
          order: orders,
          memberEmail: members.email,
          memberName: members.displayName,
          productTitle: products.title,
          couponCode: coupons.code,
        })
        .from(orders)
        .innerJoin(members, and(eq(orders.memberId, members.id), eq(members.tenantId, orders.tenantId)))
        .innerJoin(products, and(eq(orders.productId, products.id), eq(products.tenantId, orders.tenantId)))
        .leftJoin(coupons, and(eq(orders.couponId, coupons.id), eq(coupons.tenantId, orders.tenantId)))
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : orderListItemSchema.parse({ ...row.order, ...row });
    },
    list: async (tenantId, query) => {
      const conditions = conditionsFor(tenantId, query);
      const rows = await db
        .select({
          order: orders,
          memberEmail: members.email,
          memberName: members.displayName,
          productTitle: products.title,
          couponCode: coupons.code,
        })
        .from(orders)
        .innerJoin(members, and(eq(orders.memberId, members.id), eq(members.tenantId, orders.tenantId)))
        .innerJoin(products, and(eq(orders.productId, products.id), eq(products.tenantId, orders.tenantId)))
        .leftJoin(coupons, and(eq(orders.couponId, coupons.id), eq(coupons.tenantId, orders.tenantId)))
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
              couponCode: row.couponCode,
            }),
        ),
        total: totals[0]?.value ?? 0,
      };
    },
    listForMember: async (tenantId, memberId) => {
      const rows = await db
        .select({
          order: orders,
          memberEmail: members.email,
          memberName: members.displayName,
          productTitle: products.title,
          couponCode: coupons.code,
        })
        .from(orders)
        .innerJoin(members, and(eq(orders.memberId, members.id), eq(members.tenantId, orders.tenantId)))
        .innerJoin(products, and(eq(orders.productId, products.id), eq(products.tenantId, orders.tenantId)))
        .leftJoin(coupons, and(eq(orders.couponId, coupons.id), eq(coupons.tenantId, orders.tenantId)))
        .where(and(eq(orders.tenantId, tenantId), eq(orders.memberId, memberId)))
        .orderBy(desc(orders.createdAt), desc(orders.id));
      return rows.map((row) => orderListItemSchema.parse({ ...row.order, ...row }));
    },
    listBillingForMember: async (tenantId, memberId, page, pageSize) => {
      const memberCondition = and(
        eq(orders.tenantId, tenantId),
        eq(orders.memberId, memberId),
      );
      const visibleCondition = or(isNotNull(orders.billing), eq(invoices.provider, 'ksef'));
      const invoiceJoin = and(
        eq(invoices.tenantId, orders.tenantId),
        eq(invoices.orderId, orders.id),
        inArray(invoices.status, ['issued', 'delivered']),
      );
      const [rows, totals] = await Promise.all([
        db
          .select({
            id: orders.id,
            createdAt: orders.createdAt,
            billing: orders.billing,
            invoiceId: invoices.id,
            invoiceStatus: invoices.status,
            invoiceProvider: invoices.provider,
          })
          .from(orders)
          .leftJoin(invoices, invoiceJoin)
          .where(and(memberCondition, visibleCondition))
          .orderBy(desc(orders.createdAt), desc(orders.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .select({ value: sql<number>`count(*)::int` })
          .from(orders)
          .leftJoin(invoices, invoiceJoin)
          .where(and(memberCondition, visibleCondition)),
      ]);
      return {
        orders: rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          billing: row.billing === null ? null : billingDataSchema.parse(row.billing),
          invoice: row.invoiceId === null
            ? null
            : {
                id: row.invoiceId,
                status: row.invoiceStatus === 'delivered' ? 'delivered' as const : 'issued' as const,
                provider: row.invoiceProvider ?? '',
              },
        })),
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
    listPaidWithoutGrant: async (tenantId, query) =>
      (
        await db
          .select({
            orderId: orders.id,
            createdAt: orders.createdAt,
            memberId: orders.memberId,
            memberEmail: members.email,
            productId: orders.productId,
            productTitle: products.title,
            kind: orders.kind,
            provider: orders.provider,
            amountCents: orders.amountCents,
            currency: orders.currency,
            providerObjectIds: orders.providerObjectIds,
          })
          .from(orders)
          .innerJoin(members, and(eq(orders.memberId, members.id), eq(members.tenantId, orders.tenantId)))
          .innerJoin(products, and(eq(orders.productId, products.id), eq(products.tenantId, orders.tenantId)))
          .where(
            and(
              eq(orders.tenantId, tenantId),
              eq(orders.status, 'paid'),
              sql`${orders.createdAt} <= ${query.paidBefore}`,
              notExists(
                db
                  .select({ id: productGrants.id })
                  .from(productGrants)
                  .where(
                    and(
                      eq(productGrants.tenantId, orders.tenantId),
                      eq(productGrants.memberId, orders.memberId),
                      eq(productGrants.productId, orders.productId),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(desc(orders.createdAt), desc(orders.id))
          .limit(query.limit)
      ).map((row) => paidWithoutGrantRowSchema.parse(row)),
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
  listAccessRetainingOrdersForMemberProduct: async (tenantId, memberId, productId) => {
    const rows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.memberId, memberId),
          eq(orders.productId, productId),
          inArray(orders.status, [...ACCESS_RETAINING_ORDER_STATUSES]),
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
  markOrderPartiallyRefunded: async (tenantId, orderId) => {
    const rows = await db
      .update(orders)
      .set({ status: 'partially_refunded' })
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.id, orderId),
          eq(orders.status, 'paid'),
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
    couponId: subscription.couponId,
    couponDiscountCents: subscription.couponDiscountCents,
    couponRecurringDuration: subscription.couponRecurringDuration,
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
    create: async (tenantId, subscription) => db.transaction(async (tx) => {
      const [row] = await tx.insert(memberSubscriptions).values(toRow(tenantId, subscription)).returning();
      if (row === undefined) return;
      await appendMemberEvent(tx, memberEventSchema.parse({
        id: `subscription-change:${row.id}:${row.updatedAt}:${row.status}:${row.currentPeriodEnd}`,
        tenantId,
        memberId: row.memberId,
        type: 'subscription-change',
        payload: {
          subscriptionId: row.id,
          productId: row.productId,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          provider: row.provider,
        },
        occurredAt: row.updatedAt,
      }));
    }),
    update: async (tenantId, subscription) => db.transaction(async (tx) => {
      const rows = await tx
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
      if (row === undefined) return null;
      await appendMemberEvent(tx, memberEventSchema.parse({
        id: `subscription-change:${row.id}:${row.updatedAt}:${row.status}:${row.currentPeriodEnd}`,
        tenantId,
        memberId: row.memberId,
        type: 'subscription-change',
        payload: {
          subscriptionId: row.id,
          productId: row.productId,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          provider: row.provider,
        },
        occurredAt: row.updatedAt,
      }));
      return parseSubscription(row);
    }),
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
      scopes: apiKey.scopes,
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
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

export const createApiKeyRateLimitRepository = (db: Db): ApiKeyRateLimitRepository => ({
  claim: async (tenantId, input) => {
    const cost = input.cost ?? 1;
    if (cost > input.limit) return false;
    const [owned] = await db.select({ id: tenantApiKeys.id }).from(tenantApiKeys).where(and(
      eq(tenantApiKeys.tenantId, tenantId),
      eq(tenantApiKeys.id, input.apiKeyId),
    )).limit(1);
    if (owned === undefined) return false;
    const [row] = await db.insert(apiKeyRateLimitBuckets).values({
      apiKeyId: input.apiKeyId,
      period: input.period,
      windowStartedAt: input.windowStartedAt,
      count: cost,
    }).onConflictDoUpdate({
      target: [apiKeyRateLimitBuckets.apiKeyId, apiKeyRateLimitBuckets.period],
      set: {
        windowStartedAt: input.windowStartedAt,
        count: sql`case when ${apiKeyRateLimitBuckets.windowStartedAt} = ${input.windowStartedAt}::timestamptz then ${apiKeyRateLimitBuckets.count} + ${cost} else ${cost} end`,
      },
      setWhere: or(
        ne(apiKeyRateLimitBuckets.windowStartedAt, input.windowStartedAt),
        sql`${apiKeyRateLimitBuckets.count} + ${cost} <= ${input.limit}`,
      ) ?? sql`false`,
    }).returning({ count: apiKeyRateLimitBuckets.count });
    return row !== undefined;
  },
  release: async (tenantId, input) => {
    const cost = input.cost ?? 1;
    const [owned] = await db.select({ id: tenantApiKeys.id }).from(tenantApiKeys).where(and(
      eq(tenantApiKeys.tenantId, tenantId),
      eq(tenantApiKeys.id, input.apiKeyId),
    )).limit(1);
    if (owned === undefined) return;
    await db
      .update(apiKeyRateLimitBuckets)
      .set({ count: sql`greatest(0, ${apiKeyRateLimitBuckets.count} - ${cost})` })
      .where(and(
        eq(apiKeyRateLimitBuckets.apiKeyId, input.apiKeyId),
        eq(apiKeyRateLimitBuckets.period, input.period),
        eq(apiKeyRateLimitBuckets.windowStartedAt, input.windowStartedAt),
      ));
  },
});

export const createPublicRateLimitRepository = (db: Db): PublicRateLimitRepository => ({
  claim: async (input) => {
    const [row] = await db.insert(rateLimitBuckets).values({
      scope: input.scope,
      key: input.key,
      windowStartedAt: input.windowStartedAt,
      expiresAt: input.expiresAt,
      count: 1,
    }).onConflictDoUpdate({
      target: [rateLimitBuckets.scope, rateLimitBuckets.key],
      set: {
        windowStartedAt: input.windowStartedAt,
        expiresAt: input.expiresAt,
        count: sql`case when ${rateLimitBuckets.windowStartedAt} = ${input.windowStartedAt}::timestamptz then ${rateLimitBuckets.count} + 1 else 1 end`,
      },
      setWhere: or(
        ne(rateLimitBuckets.windowStartedAt, input.windowStartedAt),
        sql`${rateLimitBuckets.count} + 1 <= ${input.limit}`,
      ) ?? sql`false`,
    }).returning({ count: rateLimitBuckets.count });
    return row !== undefined;
  },
  purgeExpired: async (before) => {
    const purged = await db
      .delete(rateLimitBuckets)
      .where(sql`${rateLimitBuckets.expiresAt} <= ${before}::timestamptz`)
      .returning({ key: rateLimitBuckets.key });
    return purged.length;
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

export const createProcessedPaymentEventRepository = (db: Db): ProcessedPaymentEventRepository => {
  const settledOutcome = async (
    where: ReturnType<typeof and>,
  ): Promise<Exclude<PaymentEventClaim, 'claimed'>> => {
    const rows = await db
      .select({ status: processedPaymentEvents.status })
      .from(processedPaymentEvents)
      .where(where)
      .limit(1);
    return rows[0]?.status === 'processed' ? 'processed' : 'in_progress';
  };

  return {
    claim: async (tenantId, event, lease) => {
      try {
        const rows = await db
          .insert(processedPaymentEvents)
          .values({
            ...event,
            tenantId,
            status: 'processing',
            workerId: lease.workerId,
            claimedAt: lease.now,
            leaseExpiresAt: lease.leaseExpiresAt,
          })
          .onConflictDoUpdate({
            target: processedPaymentEvents.id,
            set: {
              status: 'processing',
              workerId: lease.workerId,
              claimedAt: lease.now,
              leaseExpiresAt: lease.leaseExpiresAt,
            },
            setWhere: sql`${processedPaymentEvents.status} = 'processing'
              and ${processedPaymentEvents.leaseExpiresAt} <= ${lease.now}`,
          })
          .returning({ id: processedPaymentEvents.id });
        if (rows.length > 0) return 'claimed';
        return await settledOutcome(and(
          eq(processedPaymentEvents.tenantId, tenantId),
          eq(processedPaymentEvents.id, event.id),
        ));
      } catch (cause) {
        if (!uniqueViolation(cause)) throw cause;
        return await settledOutcome(and(
          eq(processedPaymentEvents.tenantId, tenantId),
          eq(processedPaymentEvents.objectId, event.objectId),
          eq(processedPaymentEvents.type, event.type),
        ));
      }
    },
    finalize: async (tenantId, eventId, workerId, processedAt) => {
      await db
        .update(processedPaymentEvents)
        .set({
          status: 'processed',
          processedAt,
          workerId: null,
          claimedAt: null,
          leaseExpiresAt: null,
        })
        .where(and(
          eq(processedPaymentEvents.tenantId, tenantId),
          eq(processedPaymentEvents.id, eventId),
          eq(processedPaymentEvents.workerId, workerId),
          eq(processedPaymentEvents.status, 'processing'),
        ));
    },
    release: async (tenantId, eventId, workerId) => {
      await db
        .delete(processedPaymentEvents)
        .where(and(
          eq(processedPaymentEvents.tenantId, tenantId),
          eq(processedPaymentEvents.id, eventId),
          eq(processedPaymentEvents.workerId, workerId),
        ));
    },
  };
};

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
        .returning();

      const grant = grantRows[0];
      if (grant !== undefined) {
        await appendMemberEvent(tx, memberEventSchema.parse({
          id: `grant:${grant.id}:${grant.startsAt}:${grant.expiresAt ?? 'perpetual'}`,
          tenantId: input.tenantId,
          memberId: grant.memberId,
          type: 'grant',
          payload: {
            grantId: grant.id,
            productId: grant.productId,
            source: grant.source,
            startsAt: grant.startsAt,
            expiresAt: grant.expiresAt,
          },
          occurredAt: grant.createdAt,
        }));
      }

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

export const createDevSinkPurge = (db: Db): DevSinkPurge => ({
  purge: async () => {
    const [magicLinks, emails] = await Promise.all([
      db.delete(devMagicLinks).returning({ email: devMagicLinks.email }),
      db.delete(devEmails).returning({ to: devEmails.to }),
    ]);
    return { magicLinks: magicLinks.length, emails: emails.length };
  },
});

type TenantDomainRow = typeof tenantDomains.$inferSelect;

/** Postgres hands back `2026-09-04 10:15:00+00`; every contract schema expects ISO-8601. */
const toIsoTimestamp = (value: string): string => new Date(value).toISOString();

const toNullableIsoTimestamp = (value: string | null): string | null =>
  value === null ? null : toIsoTimestamp(value);

const toTenantDomain = (row: TenantDomainRow): TenantDomain => ({
  id: row.id,
  tenantId: row.tenantId,
  domain: row.domain,
  kind: row.kind,
  verified: row.verified,
  provider: row.provider,
  verification: dnsRecordSchema.array().catch([]).parse(row.verification),
  createdAt: toIsoTimestamp(row.createdAt),
  verifiedAt: toNullableIsoTimestamp(row.verifiedAt),
  lastCheckedAt: toNullableIsoTimestamp(row.lastCheckedAt),
  lastError: row.lastError,
});

export const createTenantDomainRepository = (db: Db): TenantDomainRepository => ({
  findByDomain: async (domain) => {
    const rows = await db
      .select()
      .from(tenantDomains)
      .where(and(eq(tenantDomains.domain, domain), eq(tenantDomains.verified, true)))
      .limit(1);
    return rows[0] === undefined ? null : toTenantDomain(rows[0]);
  },
  findAnyByDomain: async (domain) => {
    const rows = await db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.domain, domain))
      .limit(1);
    return rows[0] === undefined ? null : toTenantDomain(rows[0]);
  },
  listVerifiedDomains: async () =>
    (await db.select().from(tenantDomains).where(eq(tenantDomains.verified, true)))
      .map(toTenantDomain),
  listByTenant: async (tenantId) =>
    (await db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId))
      .orderBy(tenantDomains.domain)).map(toTenantDomain),
  insert: async (tenantId, domain) => {
    const rows = await db
      .insert(tenantDomains)
      .values({ ...domain, tenantId })
      .onConflictDoNothing({ target: tenantDomains.domain })
      .returning();
    return rows[0] === undefined ? null : toTenantDomain(rows[0]);
  },
  patch: async (tenantId, id, patch) => {
    const rows = await db
      .update(tenantDomains)
      .set(patch)
      .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.id, id)))
      .returning();
    return rows[0] === undefined ? null : toTenantDomain(rows[0]);
  },
  markVerified: async (tenantId, id, patch) => {
    const rows = await db
      .update(tenantDomains)
      .set({ ...patch, verified: true })
      .where(and(
        eq(tenantDomains.tenantId, tenantId),
        eq(tenantDomains.id, id),
        eq(tenantDomains.verified, false),
      ))
      .returning();
    return rows[0] === undefined ? null : toTenantDomain(rows[0]);
  },
  remove: async (tenantId, id) => {
    const rows = await db
      .delete(tenantDomains)
      .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.id, id)))
      .returning({ id: tenantDomains.id });
    return rows.length > 0;
  },
  listOldestPendingPerTenant: async (limit) => {
    const ranked = db
      .select({
        id: tenantDomains.id,
        rank: sql<number>`row_number() over (partition by ${tenantDomains.tenantId} order by ${tenantDomains.lastCheckedAt} asc nulls first, ${tenantDomains.createdAt} asc)`.as('rank'),
      })
      .from(tenantDomains)
      .where(and(eq(tenantDomains.kind, 'custom'), eq(tenantDomains.verified, false)))
      .as('ranked');
    const rows = await db
      .select({ domain: tenantDomains })
      .from(tenantDomains)
      .innerJoin(ranked, eq(ranked.id, tenantDomains.id))
      .where(eq(ranked.rank, 1))
      .orderBy(
        sql`${tenantDomains.lastCheckedAt} asc nulls first`,
        asc(tenantDomains.createdAt),
      )
      .limit(limit);
    return rows.map((row) => toTenantDomain(row.domain));
  },
});

export const createTenantDomainEventRepository = (db: Db): TenantDomainEventRepository => ({
  append: async (tenantId, event) => {
    await db.insert(tenantDomainEvents).values({ ...event, tenantId });
  },
});

export const createTenantRepository = (
  db: Db,
  options: { onMultipleTenants?(): void } = {},
): TenantRepository => ({
  findById: async (tenantId) => {
    const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return rows[0] ?? null;
  },
  findBySlug: async (slug) => {
    const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return rows[0] ?? null;
  },
  findSole: async () => {
    const rows = await db.select().from(tenants).limit(2);
    if (rows.length > 1) options.onMultipleTenants?.();
    return rows.length === 1 ? rows[0] ?? null : null;
  },
  findSettings: async (tenantId) => {
    const rows = await db
      .select({
        name: tenants.name,
        defaultLanguage: tenants.defaultLanguage,
        socialLinks: tenants.socialLinks,
        billingPortalUrl: tenants.billingPortalUrl,
        bunnyStreamLibraryId: tenants.bunnyStreamLibraryId,
        bunnyStreamCdnHostname: tenants.bunnyStreamCdnHostname,
        logoUrl: tenants.logoUrl,
        logoDarkUrl: tenants.logoDarkUrl,
        accentColor: tenants.accentColor,
        faviconUrl: tenants.faviconUrl,
        ogTitle: tenants.ogTitle,
        ogDescription: tenants.ogDescription,
        ogImageUrl: tenants.ogImageUrl,
        supportEmail: tenants.supportEmail,
        supportUrl: tenants.supportUrl,
        termsUrl: tenants.termsUrl,
        privacyUrl: tenants.privacyUrl,
        defaultHomeSpaceId: tenants.defaultHomeSpaceId,
        directMessagesEnabled: tenants.directMessagesEnabled,
        autoIssueInvoices: tenants.autoIssueInvoices,
        autoIssueInvoiceScope: tenants.autoIssueInvoiceScope,
        invoiceVatRatePercent: tenants.invoiceVatRatePercent,
        invoiceVatMode: tenants.invoiceVatMode,
        invoiceExemptionBasisKind: tenants.invoiceExemptionBasisKind,
        invoiceExemptionBasis: tenants.invoiceExemptionBasis,
        invoicingProvider: tenants.invoicingProvider,
        invoiceSellerName: tenants.invoiceSellerName,
        invoiceSellerAddress: tenants.invoiceSellerAddress,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          name: row.name,
          defaultLanguage: row.defaultLanguage,
          socialLinks: row.socialLinks,
          billingPortalUrl: row.billingPortalUrl,
          bunnyStreamLibraryId: row.bunnyStreamLibraryId,
          bunnyStreamCdnHostname: row.bunnyStreamCdnHostname,
          logoUrl: row.logoUrl,
          logoDarkUrl: row.logoDarkUrl,
          accentColor: row.accentColor,
          faviconUrl: row.faviconUrl,
          ogTitle: row.ogTitle,
          ogDescription: row.ogDescription,
          ogImageUrl: row.ogImageUrl,
          supportEmail: row.supportEmail,
          supportUrl: row.supportUrl,
          termsUrl: row.termsUrl,
          privacyUrl: row.privacyUrl,
          defaultHomeSpaceId: row.defaultHomeSpaceId,
          directMessagesEnabled: row.directMessagesEnabled,
          autoIssueInvoices: row.autoIssueInvoices,
          autoIssueInvoiceScope: row.autoIssueInvoiceScope,
          invoiceVatRatePercent:
            row.invoiceVatRatePercent === 5 ||
            row.invoiceVatRatePercent === 8 ||
            row.invoiceVatRatePercent === 23
              ? row.invoiceVatRatePercent
              : null,
          invoiceVatMode:
            row.invoiceVatMode === 'rate' || row.invoiceVatMode === 'exempt'
              ? row.invoiceVatMode
              : null,
          invoiceExemptionBasisKind:
            row.invoiceExemptionBasisKind === 'art_113_1' ||
            row.invoiceExemptionBasisKind === 'art_113_9' ||
            row.invoiceExemptionBasisKind === 'art_43_1' ||
            row.invoiceExemptionBasisKind === 'other_statute' ||
            row.invoiceExemptionBasisKind === 'other'
              ? row.invoiceExemptionBasisKind
              : null,
          invoiceExemptionBasis: row.invoiceExemptionBasis,
          invoicingProvider: row.invoicingProvider,
          invoiceSellerName: row.invoiceSellerName,
          invoiceSellerAddress: row.invoiceSellerAddress,
        }
      : null;
  },
  updateSettings: async (tenantId, settings): Promise<TenantSettings> => {
    await db
      .update(tenants)
      .set({
        name: settings.name,
        defaultLanguage: settings.defaultLanguage,
        socialLinks: settings.socialLinks,
        contentVersion: sql`${tenants.contentVersion} + 1`,
        billingPortalUrl: settings.billingPortalUrl,
        bunnyStreamLibraryId: settings.bunnyStreamLibraryId,
        bunnyStreamCdnHostname: settings.bunnyStreamCdnHostname,
        logoUrl: settings.logoUrl,
        logoDarkUrl: settings.logoDarkUrl,
        accentColor: settings.accentColor,
        faviconUrl: settings.faviconUrl,
        ogTitle: settings.ogTitle,
        ogDescription: settings.ogDescription,
        ogImageUrl: settings.ogImageUrl,
        supportEmail: settings.supportEmail,
        supportUrl: settings.supportUrl,
        termsUrl: settings.termsUrl,
        privacyUrl: settings.privacyUrl,
        defaultHomeSpaceId: settings.defaultHomeSpaceId,
        directMessagesEnabled: settings.directMessagesEnabled,
        autoIssueInvoices: settings.autoIssueInvoices,
        autoIssueInvoiceScope: settings.autoIssueInvoiceScope,
        invoiceVatRatePercent: settings.invoiceVatRatePercent,
        invoiceVatMode: settings.invoiceVatMode ?? undefined,
        invoiceExemptionBasisKind: settings.invoiceExemptionBasisKind,
        invoiceExemptionBasis: settings.invoiceExemptionBasis,
        invoicingProvider: settings.invoicingProvider,
        invoiceSellerName: settings.invoiceSellerName,
        invoiceSellerAddress: settings.invoiceSellerAddress,
      })
      .where(eq(tenants.id, tenantId));
    return {
      name: settings.name,
      defaultLanguage: settings.defaultLanguage,
      socialLinks: settings.socialLinks,
      billingPortalUrl: settings.billingPortalUrl,
      bunnyStreamLibraryId: settings.bunnyStreamLibraryId,
      bunnyStreamCdnHostname: settings.bunnyStreamCdnHostname,
      logoUrl: settings.logoUrl,
      logoDarkUrl: settings.logoDarkUrl,
      accentColor: settings.accentColor,
      faviconUrl: settings.faviconUrl,
      ogTitle: settings.ogTitle,
      ogDescription: settings.ogDescription,
      ogImageUrl: settings.ogImageUrl,
      supportEmail: settings.supportEmail,
      supportUrl: settings.supportUrl,
      termsUrl: settings.termsUrl,
      privacyUrl: settings.privacyUrl,
      defaultHomeSpaceId: settings.defaultHomeSpaceId,
      directMessagesEnabled: settings.directMessagesEnabled,
      autoIssueInvoices: settings.autoIssueInvoices,
      autoIssueInvoiceScope: settings.autoIssueInvoiceScope,
      invoiceVatRatePercent: settings.invoiceVatRatePercent,
      invoiceVatMode: settings.invoiceVatMode,
      invoiceExemptionBasisKind: settings.invoiceExemptionBasisKind,
      invoiceExemptionBasis: settings.invoiceExemptionBasis,
      invoicingProvider: settings.invoicingProvider,
      invoiceSellerName: settings.invoiceSellerName,
      invoiceSellerAddress: settings.invoiceSellerAddress,
    };
  },
  createTenantWithOwnerGrant: async (input, options) =>
    db.transaction(async (tx) => {
      if (options?.requireEmpty === true) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('together:first-tenant'))`);
        const existing = await tx.select({ id: tenants.id }).from(tenants).limit(1);
        if (existing.length > 0) return null;
      }
      const rows = await tx
        .insert(tenants)
        .values(input.tenant)
        .returning({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          plan: tenants.plan,
          contentVersion: tenants.contentVersion,
        });
      const tenant = rows[0];
      if (tenant === undefined) throw new Error('Tenant insert did not return a row');
      await tx.insert(tenantAdmins).values({
        id: input.ownerGrant.id,
        tenantId: input.tenant.id,
        userId: input.ownerGrant.userId,
        role: input.ownerGrant.staffRole,
      });
      return tenant;
    }),
  hasAny: async () => {
    const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
    return rows.length > 0;
  },
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

export const createCheckoutConsentCaptureRepository = (
  db: Db,
): CheckoutConsentCaptureRepository => ({
  create: async (tenantId, input) => {
    await db.insert(checkoutConsentCaptures).values({ ...input, tenantId });
  },
  findById: async (tenantId, id): Promise<CheckoutConsentCapture | null> => {
    const rows = await db
      .select({ capture: checkoutConsentCaptures.capture })
      .from(checkoutConsentCaptures)
      .where(
        and(
          eq(checkoutConsentCaptures.tenantId, tenantId),
          eq(checkoutConsentCaptures.id, id),
        ),
      )
      .limit(1);
    return rows[0]?.capture ?? null;
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

export const createSignInMethodReader = (db: Db): SignInMethodReader => ({
  hasCredentialAccount: async (tenantId, email) => {
    const rows = await db
      .select({ credentialId: account.id })
      .from(user)
      .leftJoin(members, and(
        eq(members.userId, user.id),
        eq(members.tenantId, tenantId),
        isNull(members.deletedAt),
      ))
      .leftJoin(tenantAdmins, and(
        eq(tenantAdmins.userId, user.id),
        eq(tenantAdmins.tenantId, tenantId),
      ))
      .leftJoin(account, and(
        eq(account.userId, user.id),
        eq(account.providerId, 'credential'),
        isNotNull(account.password),
      ))
      .where(and(
        eq(user.email, normalizeEmail(email)),
        or(isNotNull(members.id), isNotNull(tenantAdmins.id)),
      ))
      .limit(1);
    return (rows[0]?.credentialId ?? null) !== null;
  },
});

export const createTenantAccessReader = (db: Db): TenantAccessReader => {
  const baseQuery = () =>
    db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        plan: tenants.plan,
        contentVersion: tenants.contentVersion,
        staffRole: tenantAdmins.role,
      })
      .from(tenantAdmins)
      .innerJoin(tenants, eq(tenantAdmins.tenantId, tenants.id));

  const toMembership = (row: Tenant & { staffRole: string }): Membership | null => {
    const staffRole = parseStaffRole(row.staffRole);
    return staffRole
      ? {
          tenant: {
            id: row.id,
            slug: row.slug,
            name: row.name,
            status: row.status,
            plan: row.plan,
            contentVersion: row.contentVersion,
          },
          staffRole,
        }
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
        .select({
          userId: tenantAdmins.userId,
          email: user.email,
          staffRole: tenantAdmins.role,
          language: members.language,
        })
        .from(tenantAdmins)
        .innerJoin(user, eq(tenantAdmins.userId, user.id))
        .leftJoin(
          members,
          and(
            eq(members.tenantId, tenantId),
            eq(members.userId, tenantAdmins.userId),
            isNull(members.deletedAt),
          ),
        )
        .where(eq(tenantAdmins.tenantId, tenantId));
      return rows.flatMap((row) => {
        const staffRole = parseStaffRole(row.staffRole);
        return staffRole === null
          ? []
          : [{ userId: row.userId, email: row.email, staffRole, language: row.language ?? null }];
      });
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
    findMember: async (tenantId, userId) => {
      const rows = await db
        .select()
        .from(members)
        .where(and(eq(members.userId, userId), eq(members.tenantId, tenantId)))
        .limit(1);
      return rows[0] ?? null;
    },
  };
};

const firstRow = (result: unknown): unknown => {
  if (typeof result !== 'object' || result === null || !('rows' in result) || !Array.isArray(result.rows)) {
    throw new Error('Schema status query did not return rows');
  }
  const row = result.rows[0];
  if (row === undefined) throw new Error('Schema status query returned no rows');
  return row;
};

const numberField = (row: unknown, field: string): number => {
  if (typeof row !== 'object' || row === null || !(field in row)) {
    throw new Error(`Schema status query did not return ${field}`);
  }
  const value = Object.entries(row).find(([key]) => key === field)?.[1];
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Schema status query returned invalid ${field}`);
  return parsed;
};

const FINGERPRINT_CACHE_TTL_MS = 60_000;

type FingerprintStatus = {
  schemaFingerprint: string | null;
  schemaFingerprintMatch: boolean | null;
};

const readFingerprintStatus = async (db: Db): Promise<FingerprintStatus> => {
  try {
    const hash = fingerprintHash(await introspectSchema(db));
    return {
      schemaFingerprint: shortFingerprint(hash),
      schemaFingerprintMatch: hash === committedFingerprint.hash,
    };
  } catch {
    return { schemaFingerprint: null, schemaFingerprintMatch: null };
  }
};

export const createHealthPort = (db: Db): HealthPort => {
  let cached: { at: number; value: FingerprintStatus } | null = null;
  const fingerprintStatus = async (): Promise<FingerprintStatus> => {
    const now = Date.now();
    if (cached !== null && now - cached.at < FINGERPRINT_CACHE_TTL_MS) return cached.value;
    const value = await readFingerprintStatus(db);
    cached = { at: now, value };
    return value;
  };

  return {
    pingDatabase: async () => {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    schemaStatus: async () => {
      const expectedMigrations = migrationJournal.entries.length;
      const lastJournalWhen = migrationJournal.entries.at(-1)?.when ?? 0;
      const fingerprint = await fingerprintStatus();
      try {
        const result = await db.execute(
          sql`select count(*)::int as applied, coalesce(max(created_at), 0) as latest from drizzle.__drizzle_migrations`,
        );
        const row = firstRow(result);
        return {
          expectedMigrations,
          appliedMigrations: numberField(row, 'applied'),
          schemaCurrent: numberField(row, 'latest') >= lastJournalWhen,
          ...fingerprint,
        };
      } catch {
        return { expectedMigrations, appliedMigrations: null, schemaCurrent: false, ...fingerprint };
      }
    },
  };
};
