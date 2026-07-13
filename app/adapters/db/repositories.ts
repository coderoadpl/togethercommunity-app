import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  computeCourseModuleName,
  courseLessonSchema,
  courseModuleSchema,
  courseSchema,
  memberCourseProgressSchema,
  productGrantSchema,
  productSchema,
  staffRoleSchema,
  tenantApiKeySchema,
  type Course,
  type CourseLesson,
  type CourseModule,
  type MemberCourseProgress,
  type Membership,
  type Product,
  type ProductGrant,
  type StaffRole,
  type TenantApiKey,
} from '@core/domain/index.js';
import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  DevEmailReader,
  DevMagicLinkReader,
  HealthPort,
  MemberRepository,
  MemberCourseProgressRepository,
  PurchaseRepository,
  ProductGrantRepository,
  ProductRepository,
  TenantAccessReader,
  TenantApiKeyRepository,
  TenantDomainRepository,
  TenantRepository,
} from '@core/server/index.js';

import type { Db } from './client.js';
import {
  courseLessons,
  courseModules,
  courses,
  devEmails,
  devMagicLinks,
  memberCourseProgress,
  members,
  productGrants,
  products,
  tenantAdmins,
  tenantApiKeys,
  tenantDomains,
  tenants,
} from './schema.js';

const parseStaffRole = (raw: string): StaffRole | null => {
  const parsed = staffRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const parseProduct = (product: Product): Product => productSchema.parse(product);

const parseGrant = (grant: ProductGrant): ProductGrant => productGrantSchema.parse(grant);

const parseLesson = (lesson: CourseLesson): CourseLesson => courseLessonSchema.parse(lesson);

const parseModule = (module: Omit<CourseModule, 'name'>): CourseModule =>
  courseModuleSchema.parse({
    ...module,
    name: computeCourseModuleName(module.prefix, module.title),
  });

const parseCourse = (course: Course): Course => courseSchema.parse(course);

const parseProgress = (progress: MemberCourseProgress): MemberCourseProgress =>
  memberCourseProgressSchema.parse(progress);

const parseApiKey = (apiKey: TenantApiKey): TenantApiKey => tenantApiKeySchema.parse(apiKey);

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
  updateAccessItems: async (tenantId, id, accessItems) => {
    const rows = await db
      .update(products)
      .set({ accessItems })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
      .returning();
    const row = rows[0];
    return row ? parseProduct(row) : null;
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
  update: async (tenantId, course) => {
    const rows = await db
      .update(courses)
      .set({
        name: course.name,
        description: course.description,
        imageUrl: course.imageUrl,
        legacyId: course.legacyId,
      })
      .where(and(eq(courses.tenantId, tenantId), eq(courses.id, course.id)))
      .returning();
    const row = rows[0];
    return row ? parseCourse(row) : null;
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
  update: async (tenantId, module) => {
    const rows = await db
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
  update: async (tenantId, lesson) => {
    const rows = await db
      .update(courseLessons)
      .set({
        name: lesson.name,
        contents: lesson.contents,
        legacyId: lesson.legacyId,
      })
      .where(and(eq(courseLessons.tenantId, tenantId), eq(courseLessons.id, lesson.id)))
      .returning();
    const row = rows[0];
    return row ? parseLesson(row) : null;
  },
  delete: async (tenantId, id) => {
    const rows = await db
      .delete(courseLessons)
      .where(and(eq(courseLessons.tenantId, tenantId), eq(courseLessons.id, id)))
      .returning({ id: courseLessons.id });
    return rows.length > 0;
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
        tags: members.tags,
        marketingConsents: members.marketingConsents,
        externalCustomerIds: members.externalCustomerIds,
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
