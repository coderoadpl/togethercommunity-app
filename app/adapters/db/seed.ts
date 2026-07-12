import { eq } from 'drizzle-orm';

import { createAuth } from '@adapters/auth/create-auth.js';

import { createDb } from './client.js';
import { members, tenantAdmins, tenantDomains, tenants, todos, user } from './schema.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const db = createDb('node-postgres', connectionString);

const auth = createAuth(db, {
  secret: process.env['BETTER_AUTH_SECRET'] ?? 'dev-only-secret-do-not-use-in-prod',
  baseUrl: 'http://localhost:48730',
  baseDomain: 'localhost',
  trustedOrigins: () => ['http://localhost:48730'],
  secureCookies: false,
});

const PASSWORD = 'demo1234';

interface CreatorSpec {
  email: string;
  name: string;
  tenant: { id: string; slug: string; name: string };
}

const creators: CreatorSpec[] = [
  {
    email: 'creator@together.dev',
    name: 'Studio Creator',
    tenant: { id: 'tenant-studio', slug: 'studio', name: 'Studio Demo' },
  },
  {
    email: 'creator2@together.dev',
    name: 'Acme Creator',
    tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme Courses' },
  },
];

const ensureUser = async (email: string, name: string): Promise<string> => {
  const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (existing.length === 0) {
    await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
  }
  const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Seeded user not found: ${email}`);
  return row.id;
};

const nowIso = new Date().toISOString();

const creatorUserIds = new Map<string, string>();
for (const creator of creators) {
  const userId = await ensureUser(creator.email, creator.name);
  creatorUserIds.set(creator.tenant.id, userId);
}

await db
  .insert(tenants)
  .values(creators.map((creator) => ({ ...creator.tenant, createdAt: nowIso })))
  .onConflictDoNothing();

await db
  .insert(tenantAdmins)
  .values(
    creators.map((creator) => ({
      id: `admin-${creator.tenant.slug}`,
      tenantId: creator.tenant.id,
      userId: creatorUserIds.get(creator.tenant.id) ?? '',
      role: 'owner' as const,
    })),
  )
  .onConflictDoNothing();

await db
  .insert(tenantDomains)
  .values(
    creators.map((creator) => ({
      id: `domain-${creator.tenant.slug}`,
      tenantId: creator.tenant.id,
      domain: `${creator.tenant.slug}.localhost`,
      kind: 'subdomain' as const,
      verified: true,
    })),
  )
  .onConflictDoNothing();

await db
  .insert(members)
  .values([
    {
      id: 'member-studio-student1',
      tenantId: 'tenant-studio',
      userId: 'student1-opaque',
      email: 'student1@together.dev',
      displayName: 'Student One',
      createdAt: nowIso,
    },
    {
      id: 'member-acme-student2',
      tenantId: 'tenant-acme',
      userId: 'student2-opaque',
      email: 'student2@together.dev',
      displayName: 'Student Two',
      createdAt: nowIso,
    },
  ])
  .onConflictDoNothing();

const studioCreator = creatorUserIds.get('tenant-studio') ?? '';
const acmeCreator = creatorUserIds.get('tenant-acme') ?? '';

await db
  .insert(todos)
  .values([
    {
      id: crypto.randomUUID(),
      tenantId: 'tenant-studio',
      title: 'Wdrożyć walking skeleton na produkcję',
      createdBy: studioCreator,
      createdAt: nowIso,
    },
    {
      id: crypto.randomUUID(),
      tenantId: 'tenant-studio',
      title: 'Sprawdzić izolację danych między tenantami',
      createdBy: studioCreator,
      createdAt: nowIso,
    },
    {
      id: crypto.randomUUID(),
      tenantId: 'tenant-acme',
      title: 'Acme: przygotować prezentację architektury',
      createdBy: acmeCreator,
      createdAt: nowIso,
    },
  ])
  .onConflictDoNothing();

console.log('Seed applied:');
for (const creator of creators) {
  console.log(`  creator  ${creator.email} / ${PASSWORD}  ->  ${creator.tenant.slug}`);
}
console.log('  tenants  http://studio.localhost:48730  http://acme.localhost:48730');
process.exit(0);
