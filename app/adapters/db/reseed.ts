import { inArray } from 'drizzle-orm';

import { createDb } from './client.js';
import {
  courseLessons,
  courseModules,
  courses,
  entityVersions,
  memberCourseProgress,
  members,
  notifications,
  posts,
  processedPaymentEvents,
  productGrants,
  products,
  tenantAdmins,
  tenantApiKeys,
  tenantDomains,
  tenantSecrets,
  tenants,
  threadSubscriptions,
} from './schema.js';

const DEMO_TENANT_IDS = ['tenant-studio', 'tenant-acme', 'tenant-akademia'];

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const db = createDb('node-postgres', connectionString);

const wiped: Array<{ table: string; rows: number }> = [];
const record = (table: string, rows: unknown[]): void => {
  wiped.push({ table, rows: rows.length });
};

// Children before parents so the wipe holds even without ON DELETE CASCADE.
record(
  'product_grants',
  await db
    .delete(productGrants)
    .where(inArray(productGrants.tenantId, DEMO_TENANT_IDS))
    .returning({ id: productGrants.id }),
);
record(
  'member_course_progress',
  await db
    .delete(memberCourseProgress)
    .where(inArray(memberCourseProgress.tenantId, DEMO_TENANT_IDS))
    .returning({ id: memberCourseProgress.id }),
);
record(
  'entity_versions',
  await db
    .delete(entityVersions)
    .where(inArray(entityVersions.tenantId, DEMO_TENANT_IDS))
    .returning({ id: entityVersions.id }),
);
record(
  'notifications',
  await db
    .delete(notifications)
    .where(inArray(notifications.tenantId, DEMO_TENANT_IDS))
    .returning({ id: notifications.id }),
);
record(
  'thread_subscriptions',
  await db
    .delete(threadSubscriptions)
    .where(inArray(threadSubscriptions.tenantId, DEMO_TENANT_IDS))
    .returning({ rootPostId: threadSubscriptions.rootPostId }),
);
record(
  'posts',
  await db
    .delete(posts)
    .where(inArray(posts.tenantId, DEMO_TENANT_IDS))
    .returning({ id: posts.id }),
);
record(
  'processed_events',
  await db
    .delete(processedPaymentEvents)
    .where(inArray(processedPaymentEvents.tenantId, DEMO_TENANT_IDS))
    .returning({ id: processedPaymentEvents.id }),
);
record(
  'tenant_api_keys',
  await db
    .delete(tenantApiKeys)
    .where(inArray(tenantApiKeys.tenantId, DEMO_TENANT_IDS))
    .returning({ id: tenantApiKeys.id }),
);
record(
  'tenant_secrets',
  await db
    .delete(tenantSecrets)
    .where(inArray(tenantSecrets.tenantId, DEMO_TENANT_IDS))
    .returning({ id: tenantSecrets.id }),
);
record(
  'tenant_admins',
  await db
    .delete(tenantAdmins)
    .where(inArray(tenantAdmins.tenantId, DEMO_TENANT_IDS))
    .returning({ id: tenantAdmins.id }),
);
record(
  'tenant_domains',
  await db
    .delete(tenantDomains)
    .where(inArray(tenantDomains.tenantId, DEMO_TENANT_IDS))
    .returning({ id: tenantDomains.id }),
);
record(
  'members',
  await db
    .delete(members)
    .where(inArray(members.tenantId, DEMO_TENANT_IDS))
    .returning({ id: members.id }),
);
record(
  'products',
  await db
    .delete(products)
    .where(inArray(products.tenantId, DEMO_TENANT_IDS))
    .returning({ id: products.id }),
);
record(
  'courses',
  await db
    .delete(courses)
    .where(inArray(courses.tenantId, DEMO_TENANT_IDS))
    .returning({ id: courses.id }),
);
record(
  'course_modules',
  await db
    .delete(courseModules)
    .where(inArray(courseModules.tenantId, DEMO_TENANT_IDS))
    .returning({ id: courseModules.id }),
);
record(
  'course_lessons',
  await db
    .delete(courseLessons)
    .where(inArray(courseLessons.tenantId, DEMO_TENANT_IDS))
    .returning({ id: courseLessons.id }),
);
record(
  'tenants',
  await db
    .delete(tenants)
    .where(inArray(tenants.id, DEMO_TENANT_IDS))
    .returning({ id: tenants.id }),
);

console.log(`Demo tenants wiped (${DEMO_TENANT_IDS.join(', ')}):`);
for (const entry of wiped) {
  if (entry.rows > 0) console.log(`  ${entry.table}: ${entry.rows} rows`);
}
console.log('Re-seeding...');

await import('./seed.js');
