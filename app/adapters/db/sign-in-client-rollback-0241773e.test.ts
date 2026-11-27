import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSignInClientCrypto } from '#adapters/auth/sign-in-client-crypto.js';
import { SMOKE_TENANT_ID, SMOKE_TENANT_SLUG } from '#core/domain/index.js';

import { reseedMarkers } from './reseed-guard.js';
import { tenants } from './schema.js';
import { runDemoReseed0241773e, runSmokeReseed0241773e } from './sign-in-client-rollback-0241773e.fixture.js';
import { createSignInClientRepository } from './sign-in-clients.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-11-27T12:00:00.000Z';
const unaffected = 'unaffected-workspace';
const unaffectedHost = 'unaffected.example.test';
const targetHost = 'rollback.example.test';
const crypto = createSignInClientCrypto();
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const seedWorkspace = async (id: string, slug: string) => {
  await database.db.insert(tenants).values({ id, slug, name: 'Workspace', createdAt: now });
};

const registry = () => createSignInClientRepository(database.db, 'platform.example.test');
const clientDraft = (host: string) => ({
  id: crypto.generateId(), eventId: globalThis.crypto.randomUUID(), at: now,
  name: 'Sign-in client', redirectHost: host, redirectUris: [`https://${host}/return`],
  secretExpiresAt: '2027-02-25T12:00:00.000Z', secretHash: crypto.hash(crypto.generateSecret()),
});

const seedClient = async (tenantId: string, host: string) => {
  const draft = clientDraft(host);
  expect(await registry().create(tenantId, draft)).toMatchObject({ ok: true });
  return draft.id;
};

const expectCascade = async (targetId: string, preservedId: string) => {
  expect((await database.db.query.signInClients.findMany()).map(({ clientId }) => clientId)).toEqual([preservedId]);
  expect((await database.db.query.signInClientEvents.findMany()).map(({ clientId }) => clientId)).toEqual([preservedId]);
  const reservations = await database.db.query.signInClientHostReservations.findMany();
  expect(reservations).toHaveLength(2);
  expect(reservations).toEqual(expect.arrayContaining([
    expect.objectContaining({ hostname: targetHost, clientId: targetId }),
    expect.objectContaining({ hostname: unaffectedHost, clientId: preservedId }),
  ]));
  expect(await registry().create(unaffected, clientDraft(targetHost))).toEqual({ ok: false, error: 'host_unavailable' });
};

beforeEach(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  database = await createTestDatabase('together_registry_rollback', databaseUrl);
  await seedWorkspace(unaffected, unaffected);
}, 120_000);

afterEach(async () => { await database?.close(); });

describe('Sign-in client storage with workspace deletion from 0241773e', () => {
  it('lets the old workspace deletion cascade and preserves the reservation', async () => {
    const target = 'deleted-workspace';
    await seedWorkspace(target, target);
    const preservedId = await seedClient(unaffected, unaffectedHost);
    const targetId = await seedClient(target, targetHost);

    await database.db.delete(tenants).where(eq(tenants.id, target));

    expect(await database.db.query.tenants.findFirst({ where: eq(tenants.id, target) })).toBeUndefined();
    await expectCascade(targetId, preservedId);
  });

  it('lets the old full demo reseed delete and recreate a workspace with clients', async () => {
    const target = 'tenant-studio';
    await seedWorkspace(target, 'studio');
    const preservedId = await seedClient(unaffected, unaffectedHost);
    const targetId = await seedClient(target, targetHost);

    const result = await runDemoReseed0241773e(database.db, reseedMarkers({ DATABASE_URL: database.url }));

    expect(result.wiped).toContainEqual({ table: 'tenants', rows: 1 });
    expect(result.wiped.every(({ table }) => !table.startsWith('sign_in_client'))).toBe(true);
    expect(await database.db.query.tenants.findFirst({ where: eq(tenants.id, target) })).toMatchObject({ slug: 'studio' });
    await expectCascade(targetId, preservedId);
  }, 60_000);

  it('lets the old smoke reseed delete and recreate a workspace with clients', async () => {
    await seedWorkspace(SMOKE_TENANT_ID, SMOKE_TENANT_SLUG);
    const preservedId = await seedClient(unaffected, unaffectedHost);
    const targetId = await seedClient(SMOKE_TENANT_ID, targetHost);

    const result = await runSmokeReseed0241773e(database.db, {
      passwords: { member: 'rollback-member-test-password', creator: 'rollback-creator-test-password' },
      nowIso: () => now,
    });

    expect(result.wiped).toContainEqual({ table: 'tenants', rows: 1 });
    expect(result.wiped.every(({ table }) => !table.startsWith('sign_in_client'))).toBe(true);
    expect(await database.db.query.tenants.findFirst({ where: eq(tenants.id, SMOKE_TENANT_ID) })).toMatchObject({ slug: SMOKE_TENANT_SLUG });
    await expectCascade(targetId, preservedId);
  }, 60_000);
});
