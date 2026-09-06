import { sql } from 'drizzle-orm';

import {
  SMOKE_TENANT_COURSE_TITLE,
  SMOKE_TENANT_CREATOR_EMAIL,
  SMOKE_TENANT_ID,
  SMOKE_TENANT_MEMBER_EMAIL,
  SMOKE_TENANT_SLUG,
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
  tenantAdmins,
  tenantDomains,
  tenants,
} from './schema.js';

/**
 * The shared demo password; production seeds the smoke accounts from
 * SMOKE_MEMBER_PASSWORD and SMOKE_CREATOR_PASSWORD instead.
 */
export const DEMO_SEED_PASSWORD = 'demo-password-15';

const SMOKE_TENANT_NAME = 'Acme Courses';
const SMOKE_TENANT_LESSON_ID = 'lesson-acme-intro';
const SMOKE_TENANT_STUDENT_EMAIL = 'student2@together.dev';

const COURSE_ID = 'course-acme';
const MODULE_ID = 'module-acme-1';
const PRODUCT_ID = 'product-acme-course';

/**
 * The publicly embeddable Bunny Stream demo the studio fixture uses, so the
 * smoke's lesson-playback check resolves a real signed URL.
 */
const BUNNY_DEMO_LIBRARY_ID = '197133';
const BUNNY_DEMO_VIDEO_ID = 'dc48a09e-d9bb-420a-83d7-72dc2304c034';

const LESSON_CONTENTS: LessonBlock[] = [
  {
    type: 'video',
    storageKey: `${BUNNY_DEMO_LIBRARY_ID}/${BUNNY_DEMO_VIDEO_ID}`,
    streamVideoId: BUNNY_DEMO_VIDEO_ID,
    streamLibraryId: BUNNY_DEMO_LIBRARY_ID,
  },
  { type: 'html', html: '<p>Lekcja demonstracyjna kursu Acme.</p>' },
];

const CHAPTERS: Chapter[] = [
  {
    id: 'chapter-acme-1',
    name: 'Wprowadzenie',
    contents: [{ id: `content-${SMOKE_TENANT_LESSON_ID}`, name: 'Lekcja wprowadzająca', lessonId: SMOKE_TENANT_LESSON_ID }],
  },
];

const ACCESS_ITEMS: AccessItem[] = [{ level: 'course', courseId: COURSE_ID }];

export interface SmokeTenantSeedSummary {
  tenantId: string;
  creator: { email: string; tenantSlug: string };
  members: Array<{ email: string; tenantId: string }>;
}

export interface SmokeTenantSeedOptions {
  users: SeedUsers;
  passwords: SmokeTenantPasswords;
  nextIso: () => string;
  relativeIso: (days: number) => string;
}

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
      createdAt: options.nextIso(),
    })
    .onConflictDoNothing();

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
      name: 'Lekcja wprowadzająca',
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
      description: 'Kurs demonstracyjny używany przez smoke test.',
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
      title: 'Moduł wprowadzający',
      prefix: 'Część 1',
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

  return {
    tenantId: SMOKE_TENANT_ID,
    creator: { email: SMOKE_TENANT_CREATOR_EMAIL, tenantSlug: SMOKE_TENANT_SLUG },
    members: memberRows.map((member) => ({ email: member.email, tenantId: SMOKE_TENANT_ID })),
  };
};
