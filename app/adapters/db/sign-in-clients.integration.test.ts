import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApiKeyCrypto } from '#adapters/auth/api-key-crypto.js';
import { createSignInClientCrypto } from '#adapters/auth/sign-in-client-crypto.js';
import { signInClientIdSchema, signInClientPageSchema, signInClientSecretSchema } from '#core/domain/index.js';
import {
  authenticateApiKey,
  authenticateShopManagementKey,
  createSignInClient,
  shopManagementKeyHash,
  type Ctx,
  type NewSignInClient,
} from '#core/server/index.js';

import { closeDb, createDb, type Db } from './client.js';
import { createTenantApiKeyRepository } from './repositories.js';
import { signInClientEvents, signInClientHostReservations, signInClients, tenantDomains, tenants } from './schema.js';
import { createShopManagementKeyRateLimitRepository, createShopManagementKeyRepository } from './shop-management-keys.js';
import { createSignInClientRepository } from './sign-in-clients.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-11-27T10:00:00.000Z';
const tomorrow = '2026-11-28T10:00:00.000Z';
const expiry = '2027-02-25T10:00:00.000Z';
const nextExpiry = '2027-02-26T10:00:00.000Z';
const platform = 'platform.example.org';
const workspaceA = 'workspace-a';
const workspaceB = 'workspace-b';
const listWorkspace = 'workspace-list';
const suspendedWorkspace = 'workspace-suspended';
const crypto = createSignInClientCrypto();
const clock = { nowIso: () => now };
const repository = (db: Db) => createSignInClientRepository(db, platform);

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let left: Db;
let right: Db;
let observer: pg.Client;

beforeAll(async () => {
  database = await createTestDatabase('together_sign_in_clients', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values([workspaceA, workspaceB, listWorkspace, suspendedWorkspace].map<typeof tenants.$inferInsert>((id) => ({
    id, slug: id, name: id, createdAt: now, status: id === suspendedWorkspace ? 'suspended' : 'active',
  })));
  observer = new pg.Client({ connectionString: database.url });
  await observer.connect();
  const databaseName = pg.escapeIdentifier(new URL(database.url).pathname.slice(1));
  await observer.query(`ALTER DATABASE ${databaseName} SET default_transaction_isolation = 'repeatable read'`);
  left = createDb('node-postgres', database.url, { max: 1 });
  right = createDb('node-postgres', database.url, { max: 1 });
});

afterAll(async () => {
  if (observer !== undefined) await observer.end();
  if (left !== undefined) await closeDb(left);
  if (right !== undefined) await closeDb(right);
  await database?.close();
});

const draft = (redirectHost: string, patch: Partial<NewSignInClient> = {}): NewSignInClient => ({
  id: crypto.generateId(), name: 'Example application', redirectHost,
  redirectUris: [`https://${redirectHost}/Callback/a%2Fb`, `https://${redirectHost}/second`],
  at: now, eventId: globalThis.crypto.randomUUID(), secretHash: crypto.hash(crypto.generateSecret()), secretExpiresAt: expiry,
  ...patch,
});

const rotation = (expectedCredentialVersion = 1) => ({
  at: tomorrow, eventId: globalThis.crypto.randomUUID(), expectedCredentialVersion,
  secretHash: crypto.hash(crypto.generateSecret()), secretExpiresAt: nextExpiry,
});

const rowsOf = (id: string) => database.db.query.signInClients.findMany({ where: (t, { eq }) => eq(t.clientId, id) });
const eventsOf = (id: string) => database.db.query.signInClientEvents.findMany({
  where: (t, { eq }) => eq(t.clientId, id), orderBy: (t, { asc }) => [asc(t.credentialVersion)],
});
const reservationsFor = (host: string) => database.db.query.signInClientHostReservations.findMany({ where: (t, { eq }) => eq(t.hostname, host) });

const waitForLock = (queryFragment: string) => vi.waitFor(async () => {
  await observer.query('SELECT pg_stat_clear_snapshot()');
  const waiting = await observer.query(
    "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1",
    [`%${queryFragment}%`],
  );
  expect(waiting.rowCount).toBe(1);
});

const contendAfterProjectionWrite = async <First, Second>(
  startFirst: () => Promise<First>,
  startSecond: () => Promise<Second>,
  secondQueryFragment: string,
) => {
  let first: Promise<First> | undefined;
  let second: Promise<Second> | undefined;
  await observer.query('BEGIN');
  try {
    try {
      await observer.query('LOCK TABLE sign_in_client_events IN SHARE MODE');
      first = startFirst();
      void first.catch(() => undefined);
      await waitForLock('insert into "sign_in_client_events"');
      second = startSecond();
      void second.catch(() => undefined);
      await waitForLock(secondQueryFragment);
    } finally {
      await observer.query('ROLLBACK');
    }
    return await Promise.all([first, second]);
  } finally {
    await Promise.allSettled([first, second]);
  }
};

const refused = (error: string) => ({ ok: false, error });

it('refuses platform and verified custom hosts but does not treat an unverified domain as verified', async () => {
  const verifiedHost = 'verified.example.org';
  const pendingHost = 'unverified.example.org';
  await database.db.insert(tenantDomains).values([
    { id: 'verified-domain', tenantId: workspaceB, domain: verifiedHost, kind: 'custom', verified: true },
    { id: 'unverified-domain', tenantId: workspaceB, domain: pendingHost, kind: 'custom', verified: false },
  ]);
  for (const host of [platform, `child.${platform}`, verifiedHost]) {
    const input = draft(host);
    expect(await repository(left).create(workspaceA, input)).toEqual(refused('host_unavailable'));
    expect(await reservationsFor(host)).toEqual([]);
    expect(await rowsOf(input.id)).toEqual([]);
    expect(await eventsOf(input.id)).toEqual([]);
  }
  expect(await repository(left).create(workspaceA, draft(pendingHost))).toMatchObject({ ok: true });
  const suspendedInput = draft('suspended.example.org');
  expect(await repository(left).create(suspendedWorkspace, suspendedInput)).toEqual(refused('workspace_unavailable'));
  expect(await reservationsFor(suspendedInput.redirectHost)).toEqual([]);
});

it('chooses one owner of a contended host and stores no record or event for the other transaction', async () => {
  const host = 'contended.example.org';
  const first = draft(host);
  const second = draft(host);
  const [winner, loser] = await contendAfterProjectionWrite(
    () => repository(left).create(workspaceA, first),
    () => repository(right).create(workspaceB, second),
    'insert into "sign_in_client_host_reservations"',
  );
  expect(winner).toMatchObject({ ok: true, value: { id: first.id } });
  expect(loser).toEqual(refused('host_unavailable'));
  expect(await reservationsFor(host)).toMatchObject([{ hostname: host, clientId: first.id }]);
  expect(await rowsOf(first.id)).toMatchObject([{ tenantId: workspaceA, redirectUris: first.redirectUris }]);
  expect(await eventsOf(first.id)).toMatchObject([{ kind: 'created', actorKind: 'direct_owner', credentialVersion: 1 }]);
  expect(await rowsOf(second.id)).toEqual([]);
  expect(await eventsOf(second.id)).toEqual([]);
});

it('rolls back the reservation if event append fails and does not expose bound values', async () => {
  const first = draft('event-present.example.org');
  const aborted = draft('rolled-back.example.org', { eventId: first.eventId });
  expect(await repository(left).create(workspaceA, first)).toMatchObject({ ok: true });
  const attempt = repository(left).create(workspaceA, aborted);
  await expect(attempt).rejects.toEqual(new Error('Sign-in client registry database operation failed'));
  await expect(attempt).rejects.not.toHaveProperty('cause');
  expect(await reservationsFor(aborted.redirectHost)).toEqual([]);
  expect(await rowsOf(aborted.id)).toEqual([]);
  expect(await eventsOf(aborted.id)).toEqual([]);
  expect(await repository(right).create(workspaceB, draft(aborted.redirectHost))).toMatchObject({ ok: true });
});

it('leaves no reservation and no bound digest in the error when projection insertion fails', async () => {
  const input = draft('failed-projection.example.org', { secretHash: 'invalid-digest-fixture' });
  const attempt = repository(left).create(workspaceA, input);
  await expect(attempt).rejects.toEqual(new Error('Sign-in client registry database operation failed'));
  await expect(attempt).rejects.not.toHaveProperty('cause');
  expect(await reservationsFor(input.redirectHost)).toEqual([]);
  expect(await rowsOf(input.id)).toEqual([]);
  expect(await eventsOf(input.id)).toEqual([]);
});

it('stores one concurrent rotation and its event, and does not overlap old and new hashes', async () => {
  const created = draft('rotation.example.org');
  const first = rotation();
  const second = rotation();
  expect(await repository(left).create(workspaceA, created)).toMatchObject({ ok: true });
  const [rotated, stale] = await contendAfterProjectionWrite(
    () => repository(left).rotate(workspaceA, created.id, first),
    () => repository(right).rotate(workspaceA, created.id, second),
    'for update',
  );
  expect(rotated).toMatchObject({ ok: true, value: {
    credentialVersion: 2, secretExpiresAt: nextExpiry, secretRotatedAt: tomorrow,
  } });
  expect(stale).toEqual(refused('credential_version_changed'));
  expect(await rowsOf(created.id)).toMatchObject([{ credentialVersion: 2, secretHash: first.secretHash, state: 'pending_activation' }]);
  expect(await eventsOf(created.id)).toMatchObject([
    { kind: 'created', credentialVersion: 1 }, { id: first.eventId, kind: 'secret_rotated', credentialVersion: 2 },
  ]);
});

it('preserves the original credential and projection when rotate or disable cannot append an event', async () => {
  const input = draft('failed-transition.example.org');
  const repo = repository(left);
  const created = await repo.create(workspaceA, input);
  expect(created).toMatchObject({ ok: true });
  await expect(repo.rotate(workspaceA, input.id, { ...rotation(), eventId: input.eventId }))
    .rejects.toHaveProperty('message', 'Sign-in client registry database operation failed');
  await expect(repo.disable(workspaceA, input.id, { at: tomorrow, eventId: input.eventId }))
    .rejects.toHaveProperty('message', 'Sign-in client registry database operation failed');
  expect(await rowsOf(input.id)).toMatchObject([{
    state: 'pending_activation', credentialVersion: 1, secretHash: input.secretHash, name: input.name, redirectUris: input.redirectUris,
  }]);
  expect(await eventsOf(input.id)).toMatchObject([{ id: input.eventId, kind: 'created', credentialVersion: 1 }]);
});

it('retirement wins over a waiting rotation, scrubs the projection, and cannot release the host', async () => {
  const input = draft('retirement.example.org');
  const retiredAt = { at: tomorrow, eventId: 'retire-event' };
  expect(await repository(left).create(workspaceA, input)).toMatchObject({ ok: true });
  const [disableOutcome, rotateOutcome] = await contendAfterProjectionWrite(
    () => repository(left).disable(workspaceA, input.id, retiredAt),
    () => repository(right).rotate(workspaceA, input.id, rotation(2)),
    'for update',
  );
  expect(disableOutcome).toMatchObject({ ok: true, value: { state: 'retired' } });
  expect(rotateOutcome).toEqual(refused('client_retired'));
  const retired = await repository(left).findById(workspaceA, input.id);
  expect(retired).toMatchObject({ state: 'retired', name: null, redirectUris: [], secretExpiresAt: null, retiredAt: tomorrow, credentialVersion: 2 });
  expect(await repository(right).disable(workspaceA, input.id, { at: nextExpiry, eventId: 'unused-repeat-event' })).toEqual({ ok: true, value: retired });
  expect(await rowsOf(input.id)).toMatchObject([{ secretHash: null, credentialVersion: 2, state: 'retired' }]);
  expect(await eventsOf(input.id)).toMatchObject([
    { kind: 'created', credentialVersion: 1 }, { id: retiredAt.eventId, kind: 'retired', credentialVersion: 2 },
  ]);
  expect(await reservationsFor(input.redirectHost)).toMatchObject([{ clientId: input.id }]);
  expect(await repository(right).create(workspaceB, draft(input.redirectHost))).toEqual(refused('host_unavailable'));
});

it('returns the same retired client from both concurrent disables and stores one retirement event', async () => {
  const input = draft('repeated-disable.example.org');
  const first = { at: tomorrow, eventId: 'first-concurrent-disable' };
  const second = { at: nextExpiry, eventId: 'second-concurrent-disable' };
  expect(await repository(left).create(workspaceA, input)).toMatchObject({ ok: true });
  const [retired, repeated] = await contendAfterProjectionWrite(
    () => repository(left).disable(workspaceA, input.id, first),
    () => repository(right).disable(workspaceA, input.id, second),
    'for update',
  );
  expect(retired).toMatchObject({ ok: true, value: { state: 'retired', retiredAt: tomorrow, credentialVersion: 2 } });
  expect(repeated).toEqual(retired);
  const rows = await rowsOf(input.id);
  expect(rows).toMatchObject([{
    state: 'retired', credentialVersion: 2, secretHash: null, name: null, redirectUris: [],
  }]);
  expect(Date.parse(rows[0]?.retiredAt ?? '')).toBe(Date.parse(first.at));
  expect(await eventsOf(input.id)).toMatchObject([
    { kind: 'created', credentialVersion: 1 }, { id: first.eventId, kind: 'retired', credentialVersion: 2 },
  ]);
});

it('retires at the next version when a rotation commits first', async () => {
  const input = draft('rotation-before-disable.example.org');
  const first = rotation();
  const second = { at: nextExpiry, eventId: 'disable-after-rotation' };
  expect(await repository(left).create(workspaceA, input)).toMatchObject({ ok: true });
  const [rotated, retired] = await contendAfterProjectionWrite(
    () => repository(left).rotate(workspaceA, input.id, first),
    () => repository(right).disable(workspaceA, input.id, second),
    'for update',
  );
  expect(rotated).toMatchObject({ ok: true, value: { state: 'pending_activation', credentialVersion: 2 } });
  expect(retired).toMatchObject({ ok: true, value: { state: 'retired', retiredAt: nextExpiry, credentialVersion: 3 } });
  expect(await rowsOf(input.id)).toMatchObject([{ state: 'retired', credentialVersion: 3, secretHash: null }]);
  expect(await eventsOf(input.id)).toMatchObject([
    { kind: 'created', credentialVersion: 1 },
    { id: first.eventId, kind: 'secret_rotated', credentialVersion: 2 },
    { id: second.eventId, kind: 'retired', credentialVersion: 3 },
  ]);
});

it('cascades workspace deletion to the client and its events but retains the hostname', async () => {
  const tenantId = 'workspace-to-delete';
  await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace to delete', createdAt: now });
  const input = draft('workspace-deleted.example.org');
  expect(await repository(left).create(tenantId, input)).toMatchObject({ ok: true });
  expect(await eventsOf(input.id)).toHaveLength(1);

  const deleted = await observer.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  expect(deleted.rowCount).toBe(1);
  expect(await rowsOf(input.id)).toEqual([]);
  expect(await eventsOf(input.id)).toEqual([]);
  expect(await reservationsFor(input.redirectHost)).toMatchObject([{ clientId: input.id }]);
  expect(await repository(right).create(workspaceB, draft(input.redirectHost))).toEqual(refused('host_unavailable'));
});

it('scopes lookups, pagination cursors and both writes to the workspace', async () => {
  const [first, second, foreign] = [
    draft('first-page.example.org', { id: `sc_${'A'.repeat(22)}` }),
    draft('second-page.example.org', { id: `sc_${'B'.repeat(22)}` }),
    draft('foreign-page.example.org', { id: `sc_${'C'.repeat(22)}` }),
  ];
  const repo = repository(left);
  expect(await repo.create(listWorkspace, second)).toMatchObject({ ok: true });
  expect(await repo.create(listWorkspace, first)).toMatchObject({ ok: true });
  expect(await repo.create(workspaceB, foreign)).toMatchObject({ ok: true });
  expect(await repo.list(listWorkspace, { limit: 1 })).toMatchObject({ clients: [{ id: first.id }], nextCursor: first.id });
  expect(await repo.list(listWorkspace, { limit: 1, cursor: first.id })).toMatchObject({ clients: [{ id: second.id }], nextCursor: null });
  for (const id of [foreign.id, `sc_${'D'.repeat(22)}`]) {
    expect(await repo.findById(listWorkspace, id)).toBeNull();
    expect(await repo.list(listWorkspace, { limit: 5, cursor: id })).toEqual({ clients: [], nextCursor: null });
    expect(await repo.rotate(listWorkspace, id, rotation())).toEqual(refused('client_not_found'));
    expect(await repo.disable(listWorkspace, id, { at: tomorrow, eventId: 'foreign-disable' })).toEqual(refused('client_not_found'));
  }
  expect(await rowsOf(foreign.id)).toMatchObject([{ tenantId: workspaceB, credentialVersion: 1, state: 'pending_activation' }]);
  expect(await eventsOf(foreign.id)).toHaveLength(1);
});

describe('sign-in client database checks', () => {
  const cases: { name: string; patch: Partial<typeof signInClients.$inferInsert>; check: string }[] = [
    { name: 'pending without name', patch: { name: null }, check: 'lifecycle' },
    { name: 'pending without redirect addresses', patch: { redirectUris: [] }, check: 'lifecycle' },
    { name: 'pending with six redirects', patch: { redirectUris: Array.from({ length: 6 }, (_, i) => `https://constraint.example.org/${String(i)}`) }, check: 'lifecycle' },
    { name: 'pending without hash', patch: { secretHash: null }, check: 'lifecycle' },
    { name: 'a plaintext secret', patch: { secretHash: 'not-a-digest' }, check: 'lifecycle' },
    { name: 'pending without expiry', patch: { secretExpiresAt: null }, check: 'lifecycle' },
    { name: 'retired with unsanitized state', patch: { state: 'retired', retiredAt: tomorrow }, check: 'lifecycle' },
    { name: 'retired without a retirement timestamp', patch: { state: 'retired', name: null, redirectUris: [], secretHash: null, secretExpiresAt: null }, check: 'lifecycle' },
    { name: 'active state', patch: { state: 'active' }, check: 'lifecycle' },
    { name: 'pending with proof', patch: { hostVerifiedAt: now }, check: 'activation' },
    { name: 'pending with activation timestamp', patch: { activatedAt: now }, check: 'activation' },
    { name: 'zero credential version', patch: { credentialVersion: 0 }, check: 'version' },
  ];

  it.each(cases)('rejects $name on direct insert', async ({ check, patch }) => {
    const input = draft(`${globalThis.crypto.randomUUID()}.constraint.example.org`);
    await database.db.insert(signInClientHostReservations).values({ hostname: input.redirectHost, clientId: input.id, reservedAt: now });
    await expect(database.db.insert(signInClients).values({
      clientId: input.id, tenantId: workspaceA, state: 'pending_activation', credentialVersion: 1,
      redirectHost: input.redirectHost, redirectUris: input.redirectUris, name: input.name,
      createdAt: now, updatedAt: now, secretHash: input.secretHash, secretExpiresAt: expiry, ...patch,
    })).rejects.toMatchObject({ cause: { code: '23514', constraint: `sign_in_clients_${check}_check` } });
  });

  it('binds events to their own workspace and limits their state, actor and version', async () => {
    const input = draft('event-constraints.example.org');
    expect(await repository(left).create(workspaceA, input)).toMatchObject({ ok: true });
    const event = { id: 'invalid-event', tenantId: workspaceA, clientId: input.id, kind: 'created', actorKind: 'direct_owner', credentialVersion: 1, occurredAt: now };
    for (const [constraint, patch] of [
      ['client_fk', { tenantId: workspaceB }], ['kind_check', { kind: 'activated' }],
      ['actor_check', { actorKind: 'operator' }], ['version_check', { credentialVersion: 0 }],
    ] as const) {
      await expect(database.db.insert(signInClientEvents).values({ ...event, ...patch }))
        .rejects.toMatchObject({ cause: { constraint: `sign_in_client_events_${constraint}` } });
    }
    expect(await eventsOf(input.id)).toHaveLength(1);
  });
});

it('stores only the domain-specific digest and keeps the issued secret out of reads, events and existing authenticators', async () => {
  const owner: Ctx = { identity: {
    userId: 'test-owner', email: 'owner@example.org', name: 'Owner', emailVerified: true, image: null,
    tenantAccess: 'staff', tenantId: workspaceA, tenantSlug: workspaceA, tenantName: 'Workspace A', staffRole: 'owner',
    staffGrantSource: 'direct', memberId: null, memberDisplayName: null, memberBannedAt: null,
    memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: null,
  } };
  const redirectHost = 'credential.example.org';
  const input = { name: 'Credential fixture', redirectUris: [`https://${redirectHost}/Callback/a%2Fb`] };
  const signInClientsRepo = repository(left);
  const generated = await createSignInClient(owner, input, {
    signInClients: signInClientsRepo, signInClientCrypto: crypto, signInClientHosts: new Map([[workspaceA, new Set([redirectHost])]]),
    ids: { nextId: () => 'credential-made' }, clock,
  });
  expect(generated).toMatchObject({ ok: true });
  if (!generated.ok) return;
  const { client, secret } = generated.value;
  expect(signInClientSecretSchema.safeParse(secret).success).toBe(true);
  expect(signInClientIdSchema.safeParse(client.id).success).toBe(true);
  expect(Buffer.from(secret.slice('tc_sc_'.length), 'base64url')).toHaveLength(32);
  expect(Buffer.from(client.id.slice('sc_'.length), 'base64url')).toHaveLength(16);
  expect(crypto.hash(`tc_sc_${'A'.repeat(43)}`)).toBe('v1:LD0eJJe_c4wklxhqJjm7NCKnE0aGRNIYtYBw46XQ4l8');
  const digest = crypto.hash(secret);
  const stored = await rowsOf(client.id);
  expect(stored).toMatchObject([{ secretHash: digest, redirectUris: input.redirectUris, credentialVersion: 1 }]);
  expect(JSON.stringify(stored)).not.toContain(secret);
  const page = signInClientPageSchema.parse(await signInClientsRepo.list(workspaceA, { limit: 100 }));
  expect(page.clients).toContainEqual(client);
  expect(signInClientPageSchema.safeParse({ clients: [{ ...client, secret }], nextCursor: null }).success).toBe(false);
  expect(signInClientPageSchema.safeParse({ clients: [{ ...client, secretHash: digest }], nextCursor: null }).success).toBe(false);
  for (const value of [page, await signInClientsRepo.findById(workspaceA, client.id), await eventsOf(client.id)]) {
    expect(JSON.stringify(value)).not.toContain(secret);
    expect(JSON.stringify(value)).not.toContain(digest);
  }

  const apiKeyCrypto = createApiKeyCrypto();
  const tenantApiKeys = createTenantApiKeyRepository(database.db);
  const legacy = apiKeyCrypto.generateSecret();
  await tenantApiKeys.create(workspaceA, { id: 'legacy-key', tenantId: workspaceA, name: 'Legacy key', keyHash: apiKeyCrypto.hash(legacy),
    scopes: null, createdAt: now, expiresAt: null, revokedAt: null });
  const legacyDeps = { tenantApiKeys, apiKeyCrypto, clock };
  expect(await authenticateApiKey(workspaceA, legacy, legacyDeps)).toMatchObject({ ok: true });
  expect(await authenticateApiKey(workspaceA, secret, legacyDeps)).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } });

  const tenant = { id: workspaceA, slug: workspaceA, name: 'Workspace A', status: 'active', plan: 'self_hosted', contentVersion: 1 } as const;
  const shopManagementKeys = createShopManagementKeyRepository(database.db);
  const shopDeps = {
    shopManagementKeys, apiKeyCrypto, clock,
    accountIdentities: { findById: async () => ({ userId: owner.identity.userId, email: owner.identity.email, name: owner.identity.name, emailVerified: true }) },
    tenantAccess: { findStaffGrant: async () => ({ tenant, staffRole: 'owner', source: 'direct' } as const), findMember: async () => null },
    shopManagementKeyRateLimits: createShopManagementKeyRateLimitRepository(database.db),
  };
  for (const mode of ['direct', 'propose'] as const) {
    const shopSecret = apiKeyCrypto.generateSecret();
    const id = `test-shop-${mode}`;
    await shopManagementKeys.create(workspaceA, {
      id, tenantId: workspaceA, name: 'Shop key', keyHash: shopManagementKeyHash(apiKeyCrypto, shopSecret, mode),
      scopes: ['shop:catalog:read'], mode, issuedByUserId: owner.identity.userId, createdAt: now, expiresAt: expiry, revokedAt: null,
    }, { id, tenantId: workspaceA, apiKeyId: id, actorUserId: owner.identity.userId, kind: 'created', at: now, method: null, route: null, resourceId: null });
    expect(await authenticateShopManagementKey(tenant, shopSecret, null, shopDeps)).toMatchObject({ result: { ok: true } });
  }
  expect(await authenticateShopManagementKey(tenant, secret, null, shopDeps)).toEqual({
    result: { ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } }, attribution: { match: 'none' },
  });
});
