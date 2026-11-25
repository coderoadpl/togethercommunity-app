import { and, eq, sql } from 'drizzle-orm';

import {
  SMOKE_PURCHASE_PRIVACY_URL,
  SMOKE_PURCHASE_PRODUCT,
  SMOKE_PURCHASE_SALES_LINK,
  SMOKE_PURCHASE_SHIPPING_RATES,
  SMOKE_PURCHASE_TERMS_URL,
  SMOKE_TENANT_COURSE_PRODUCT_ID,
  SMOKE_TENANT_COURSE_TITLE,
  SMOKE_TENANT_CREATOR_EMAIL,
  SMOKE_TENANT_ID,
  SMOKE_TENANT_MEMBER_EMAIL,
  SMOKE_TENANT_PURCHASE_EMAIL,
  SMOKE_TENANT_PURCHASE_USER_ID,
  SMOKE_TENANT_SLUG,
  salesLinkSchema,
  type AccessItem,
  type Chapter,
  type LessonBlock,
  type SmokeTenantPasswords,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import type { SeedUsers } from './seed-users.js';
import {
  courseLessons,
  courseModules,
  courses,
  members,
  productGrants,
  productPrices,
  products,
  productStock,
  salesLinkEvents,
  salesLinks,
  session,
  stockEvents,
  tenantAdmins,
  tenantDomains,
  tenants,
} from './schema.js';

const SMOKE_TENANT_NAME = 'Acme Courses';
const SMOKE_TENANT_LESSON_ID = 'lesson-acme-intro';
const SMOKE_TENANT_STUDENT_EMAIL = 'student2@together.dev';

const COURSE_ID = 'course-acme';
const MODULE_ID = 'module-acme-1';
const PRODUCT_ID = SMOKE_TENANT_COURSE_PRODUCT_ID;

const BUNNY_DEMO_LIBRARY_ID = '197133';
const BUNNY_DEMO_VIDEO_ID = 'dc48a09e-d9bb-420a-83d7-72dc2304c034';

const LESSON_CONTENTS: LessonBlock[] = [
  {
    type: 'video',
    storageKey: `${BUNNY_DEMO_LIBRARY_ID}/${BUNNY_DEMO_VIDEO_ID}`,
    streamVideoId: BUNNY_DEMO_VIDEO_ID,
    streamLibraryId: BUNNY_DEMO_LIBRARY_ID,
  },
  { type: 'html', html: '<p>A sample lesson from the Acme course.</p>' },
];

const CHAPTERS: Chapter[] = [
  {
    id: 'chapter-acme-1',
    name: 'Introduction',
    contents: [{ id: `content-${SMOKE_TENANT_LESSON_ID}`, name: 'Introductory lesson', lessonId: SMOKE_TENANT_LESSON_ID }],
  },
];

const ACCESS_ITEMS: AccessItem[] = [{ level: 'course', courseId: COURSE_ID }];

export const SMOKE_TENANT_PURCHASE_ADMIN_ID = `admin-${SMOKE_TENANT_SLUG}-purchase`;

export interface SmokeTenantSeedSummary {
  tenantId: string;
  creator: { email: string; tenantSlug: string };
  members: Array<{ email: string; tenantId: string }>;
  purchase?: { email: string; tenantSlug: string; role: 'admin' };
}

export interface SmokeTenantSeedOptions {
  users: SeedUsers;
  passwords: SmokeTenantPasswords;
  nextIso: () => string;
  relativeIso: (days: number) => string;
}

const seedPurchaseFixtures = async (
  db: Db,
  options: SmokeTenantSeedOptions,
  password: string,
): Promise<NonNullable<SmokeTenantSeedSummary['purchase']>> => {
  await db.delete(session).where(eq(session.userId, SMOKE_TENANT_PURCHASE_USER_ID));
  const purchaseUserId = await options.users.ensurePasswordedWithId(
    SMOKE_TENANT_PURCHASE_USER_ID,
    SMOKE_TENANT_PURCHASE_EMAIL,
    'Purchase Test Staff',
    password,
  );

  await db
    .insert(tenantAdmins)
    .values({
      id: SMOKE_TENANT_PURCHASE_ADMIN_ID,
      tenantId: SMOKE_TENANT_ID,
      userId: purchaseUserId,
      role: 'admin',
    })
    .onConflictDoNothing();

  await db
    .update(tenants)
    .set({
      shippingRates: [...SMOKE_PURCHASE_SHIPPING_RATES],
      termsUrl: SMOKE_PURCHASE_TERMS_URL,
      privacyUrl: SMOKE_PURCHASE_PRIVACY_URL,
    })
    .where(eq(tenants.id, SMOKE_TENANT_ID));

  await db
    .update(products)
    .set({ vatRate: 23 })
    .where(and(eq(products.tenantId, SMOKE_TENANT_ID), eq(products.id, PRODUCT_ID)));

  await db
    .insert(products)
    .values({
      id: SMOKE_PURCHASE_PRODUCT.id,
      tenantId: SMOKE_TENANT_ID,
      type: SMOKE_PURCHASE_PRODUCT.type,
      slug: SMOKE_PURCHASE_PRODUCT.slug,
      title: SMOKE_PURCHASE_PRODUCT.title,
      description: '',
      priceCents: SMOKE_PURCHASE_PRODUCT.priceCents,
      vatRate: SMOKE_PURCHASE_PRODUCT.vatRate,
      currency: SMOKE_PURCHASE_PRODUCT.currency,
      published: SMOKE_PURCHASE_PRODUCT.published,
      deliveryMethod: SMOKE_PURCHASE_PRODUCT.deliveryMethod,
      createdAt: options.nextIso(),
    })
    .onConflictDoNothing();

  await db
    .insert(productPrices)
    .values({
      id: SMOKE_PURCHASE_PRODUCT.priceId,
      tenantId: SMOKE_TENANT_ID,
      productId: SMOKE_PURCHASE_PRODUCT.id,
      kind: 'one_time',
      interval: null,
      amountCents: SMOKE_PURCHASE_PRODUCT.priceCents,
      currency: SMOKE_PURCHASE_PRODUCT.currency,
      active: true,
      createdAt: options.nextIso(),
    })
    .onConflictDoNothing();

  const stockSince = options.nextIso();
  const [tracked] = await db
    .insert(productStock)
    .values({
      tenantId: SMOKE_TENANT_ID,
      productId: SMOKE_PURCHASE_PRODUCT.id,
      onHand: SMOKE_PURCHASE_PRODUCT.stockOnHand,
      reserved: 0,
      updatedAt: stockSince,
    })
    .onConflictDoNothing()
    .returning({ productId: productStock.productId });
  if (tracked !== undefined) {
    await db.insert(stockEvents).values({
      tenantId: SMOKE_TENANT_ID,
      productId: SMOKE_PURCHASE_PRODUCT.id,
      type: 'tracking_enabled',
      quantity: SMOKE_PURCHASE_PRODUCT.stockOnHand,
      reference: {},
      actorUserId: null,
      occurredAt: stockSince,
    });
  }

  const linkSince = options.nextIso();
  const link = salesLinkSchema.parse({
    ...SMOKE_PURCHASE_SALES_LINK,
    productIds: [...SMOKE_PURCHASE_SALES_LINK.productIds],
    tenantId: SMOKE_TENANT_ID,
    createdAt: linkSince,
    updatedAt: linkSince,
  });
  const [created] = await db
    .insert(salesLinks)
    .values(link)
    .onConflictDoNothing()
    .returning({ id: salesLinks.id });
  if (created !== undefined) {
    await db.insert(salesLinkEvents).values({
      tenantId: SMOKE_TENANT_ID,
      salesLinkId: link.id,
      revision: link.revision,
      type: 'created',
      snapshot: link,
      occurredAt: link.updatedAt,
    });
  }

  return { email: SMOKE_TENANT_PURCHASE_EMAIL, tenantSlug: SMOKE_TENANT_SLUG, role: 'admin' };
};

export const applySmokeTenantSeed = async (
  db: Db,
  options: SmokeTenantSeedOptions,
): Promise<SmokeTenantSeedSummary> => {
  const creatorUserId = await options.users.ensurePassworded(
    SMOKE_TENANT_CREATOR_EMAIL,
    'Acme Creator',
    options.passwords.creator,
  );
  const smokeUserId = await options.users.ensurePassworded(
    SMOKE_TENANT_MEMBER_EMAIL,
    'Smoke Member',
    options.passwords.member,
  );
  const studentUserId = await options.users.ensurePasswordless(
    'student2-opaque',
    SMOKE_TENANT_STUDENT_EMAIL,
    'Student Two',
  );

  await db
    .insert(tenants)
    .values({
      id: SMOKE_TENANT_ID,
      slug: SMOKE_TENANT_SLUG,
      name: SMOKE_TENANT_NAME,
      defaultLanguage: 'en',
      createdAt: options.nextIso(),
    })
    .onConflictDoUpdate({ target: tenants.id, set: { defaultLanguage: 'en' } });

  await db
    .insert(tenantAdmins)
    .values({
      id: `admin-${SMOKE_TENANT_SLUG}`,
      tenantId: SMOKE_TENANT_ID,
      userId: creatorUserId,
      role: 'owner',
    })
    .onConflictDoNothing();

  await db
    .insert(tenantDomains)
    .values({
      id: `domain-${SMOKE_TENANT_SLUG}`,
      tenantId: SMOKE_TENANT_ID,
      domain: `${SMOKE_TENANT_SLUG}.localhost`,
      kind: 'subdomain',
      verified: true,
    })
    .onConflictDoNothing();

  await db
    .insert(courseLessons)
    .values({
      id: SMOKE_TENANT_LESSON_ID,
      tenantId: SMOKE_TENANT_ID,
      name: 'Introductory lesson',
      isPreview: false,
      contents: LESSON_CONTENTS,
      durationMinutes: 4,
      createdAt: options.nextIso(),
    })
    .onConflictDoUpdate({
      target: [courseLessons.tenantId, courseLessons.id],
      set: { contents: sql`excluded.contents`, name: sql`excluded.name` },
    });

  await db
    .insert(courses)
    .values({
      id: COURSE_ID,
      tenantId: SMOKE_TENANT_ID,
      name: SMOKE_TENANT_COURSE_TITLE,
      description: 'A demo course used by the smoke test.',
      imageUrl: null,
      moduleOrder: [MODULE_ID],
      publiclyVisible: false,
      createdAt: options.nextIso(),
    })
    .onConflictDoUpdate({
      target: [courses.tenantId, courses.id],
      set: { name: sql`excluded.name`, moduleOrder: sql`excluded.module_order` },
    });

  await db
    .insert(courseModules)
    .values({
      id: MODULE_ID,
      tenantId: SMOKE_TENANT_ID,
      courseIds: [COURSE_ID],
      title: 'Introductory module',
      prefix: 'Part 1',
      chapters: CHAPTERS,
      createdAt: options.nextIso(),
    })
    .onConflictDoUpdate({
      target: [courseModules.tenantId, courseModules.id],
      set: { chapters: sql`excluded.chapters`, courseIds: sql`excluded.course_ids` },
    });

  await db
    .insert(products)
    .values({
      id: PRODUCT_ID,
      tenantId: SMOKE_TENANT_ID,
      type: 'course',
      slug: 'acme-course',
      title: SMOKE_TENANT_COURSE_TITLE,
      description: '',
      priceCents: 9900,
      currency: 'PLN',
      published: true,
      accessItems: ACCESS_ITEMS,
      createdAt: options.nextIso(),
    })
    .onConflictDoUpdate({
      target: [products.tenantId, products.id],
      set: { published: sql`excluded.published`, accessItems: sql`excluded.access_items` },
    });

  await db
    .insert(productPrices)
    .values({
      id: `price-${PRODUCT_ID}`,
      tenantId: SMOKE_TENANT_ID,
      productId: PRODUCT_ID,
      kind: 'one_time',
      interval: null,
      amountCents: 9900,
      currency: 'PLN',
      active: true,
      createdAt: options.nextIso(),
    })
    .onConflictDoNothing();

  const memberRows = [
    {
      id: 'member-acme-smoke',
      userId: smokeUserId,
      email: SMOKE_TENANT_MEMBER_EMAIL,
      displayName: 'Smoke Member',
    },
    {
      id: 'member-acme-student2',
      userId: studentUserId,
      email: SMOKE_TENANT_STUDENT_EMAIL,
      displayName: 'Student Two',
    },
  ];

  await db
    .insert(members)
    .values(memberRows.map((member) => ({
      ...member,
      tenantId: SMOKE_TENANT_ID,
      createdAt: options.nextIso(),
    })))
    .onConflictDoNothing();

  await db
    .insert(productGrants)
    .values({
      id: 'grant-acme-smoke',
      tenantId: SMOKE_TENANT_ID,
      memberId: 'member-acme-smoke',
      productId: PRODUCT_ID,
      source: 'manual',
      startsAt: options.relativeIso(-30),
      expiresAt: null,
      createdAt: options.nextIso(),
    })
    .onConflictDoNothing();

  const summary: SmokeTenantSeedSummary = {
    tenantId: SMOKE_TENANT_ID,
    creator: { email: SMOKE_TENANT_CREATOR_EMAIL, tenantSlug: SMOKE_TENANT_SLUG },
    members: memberRows.map((member) => ({ email: member.email, tenantId: SMOKE_TENANT_ID })),
  };
  if (options.passwords.purchase === null) return summary;
  return { ...summary, purchase: await seedPurchaseFixtures(db, options, options.passwords.purchase) };
};
