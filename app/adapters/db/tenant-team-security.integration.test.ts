import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ok } from '#core/domain/index.js';

import { createAuth, createAuthPort } from '#adapters/auth/create-auth.js';
import { authorizeTenant } from '#core/server/authorize.js';
import { resolveIdentity } from '#core/server/usecases/resolve-identity.js';
import { addTenantAdmin } from '#core/server/usecases/tenant-team.js';

import { createEmailOutboxRepository, createPlatformAuthSendLog } from './email-outbox.js';
import {
  createDevMagicLinkReader,
  createMemberRepository,
  createTenantAccessReader,
  createTenantDomainRepository,
  createTenantRepository,
  createTenantTeamRepository,
} from './repositories.js';
import { account, session, tenantAdmins, tenantAuditEvents, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase(
    'together_team_security_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together',
  );
});

afterAll(async () => { await database?.close(); });

it('withholds staff access until mailbox proof, then activates the invitation and invalidates the unverified session', async () => {
  const clock = { nowIso: () => new Date().toISOString() };
  const ids = { nextId: () => crypto.randomUUID() };
  await database.db.insert(tenants).values([
    { id: 'acme', slug: 'acme', name: 'Acme', createdAt: clock.nowIso() },
    { id: 'studio', slug: 'studio', name: 'Studio', createdAt: clock.nowIso() },
  ]);
  await database.db.insert(user).values([
    { id: 'owner', email: 'owner@example.test', name: 'Owner', emailVerified: true },
    { id: 'invitee', email: 'invitee@example.test', name: 'Invitee', emailVerified: false },
  ]);
  await database.db.insert(tenantAdmins).values({
    id: 'owner-grant', tenantId: 'acme', userId: 'owner', role: 'owner',
  });
  const team = createTenantTeamRepository(database.db);
  const auth = createAuth(database.db, {
    secret: 'team-security-test-secret-at-least-32-characters',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
    trustedOrigins: ['http://localhost:48730', 'http://acme.localhost:48730'],
    secureCookies: false,
    exposeMagicLinks: true,
    emailOutbox: createEmailOutboxRepository(database.db),
    emailSender: { send: async () => ok({ messageId: 'test-message', transport: 'platform' }) },
    authSendLog: createPlatformAuthSendLog(database.db),
    ids,
    clock,
    dispatchEmail: () => undefined,
    defaultTenantName: 'Together',
    google: null,
    activateTeamInvitation: async ({ request, userId, email, occurredAt }) => {
      if (new URL(request.url).hostname !== 'acme.localhost') return;
      await team.activateInvitation('acme', userId, ids.nextId(), {
        id: ids.nextId(), tenantId: 'acme', kind: 'team.admin_activated',
        actorUserId: userId, actorEmail: email, subjectMemberId: null, reason: userId, at: occurredAt,
      });
    },
  });
  const authPort = createAuthPort(auth);
  const authContext = await auth.$context;
  const password = await authContext.password.hash('attacker-password-15');
  await database.db.insert(account).values({
    id: 'invitee-credential', accountId: 'invitee', providerId: 'credential', userId: 'invitee',
    password, updatedAt: new Date(),
  });
  await database.db.insert(session).values({
    id: 'invitee-session', token: 'pre-existing-session-token', userId: 'invitee',
    expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date(),
  });
  const identityDeps = {
    authPort, ids, clock,
    members: createMemberRepository(database.db),
    tenantAccess: createTenantAccessReader(database.db),
    tenantDomains: createTenantDomainRepository(database.db),
    tenants: createTenantRepository(database.db),
    baseDomain: 'localhost', platformHost: null, singleTenantMode: false,
  };
  const request = { host: 'acme.localhost:48730', tenantHeader: null };
  const owner = await resolveIdentity({
    sessionId: 'owner-session', userId: 'owner', email: 'owner@example.test', name: 'Owner',
    emailVerified: true, image: null,
  }, request, identityDeps);
  if (!owner.ok) throw new Error('Owner identity could not be resolved');
  expect(await addTenantAdmin({ identity: owner.value }, { email: 'invitee@example.test' }, {
    ...identityDeps,
    team,
    appBaseUrl: 'http://localhost:48730',
  })).toEqual({ ok: true, value: { status: 'invitation_sent' } });
  expect(await team.list('acme')).toContainEqual(expect.objectContaining({
    userId: 'invitee', name: null, role: 'admin', status: 'invited',
  }));
  expect(await database.db.select().from(tenantAuditEvents)
    .where(eq(tenantAuditEvents.kind, 'team.admin_activated'))).toEqual([]);

  const authenticated = await authPort.getAuthenticatedUser(new Headers({
    authorization: 'Bearer pre-existing-session-token',
  }));
  expect(authenticated).toMatchObject({ userId: 'invitee', emailVerified: false });
  const identity = await resolveIdentity(authenticated, request, identityDeps);
  if (!identity.ok) throw new Error('Invitee identity could not be resolved');
  expect(identity.value).toMatchObject({ tenantAccess: 'none', staffRole: null });
  for (const capability of ['order:read', 'member:read', 'member:impersonate'] as const) {
    expect(authorizeTenant({ identity: identity.value }, capability))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
  }
  await team.inviteAdmin('studio', 'invitee', 'invitee@example.test', ids.nextId(), {
    id: ids.nextId(), tenantId: 'studio', kind: 'team.admin_invited', actorUserId: 'owner',
    actorEmail: 'owner@example.test', subjectMemberId: null, reason: 'invitee', at: clock.nowIso(),
  });
  const link = await createDevMagicLinkReader(database.db).findByEmail('invitee@example.test');
  expect(link).not.toBeNull();
  const signedIn = await auth.handler(new Request(link?.url ?? ''));
  expect(signedIn.status).toBe(302);
  expect(await team.list('acme')).toContainEqual(expect.objectContaining({
    userId: 'invitee', role: 'admin', status: 'active',
  }));
  expect(await database.db.select().from(tenantAuditEvents)
    .where(eq(tenantAuditEvents.kind, 'team.admin_activated'))).toHaveLength(1);
  expect(await authPort.getAuthenticatedUser(new Headers({
    authorization: 'Bearer pre-existing-session-token',
  }))).toBeNull();
  expect(await team.list('studio')).toContainEqual(expect.objectContaining({
    userId: 'invitee', status: 'invited',
  }));
  await auth.flushAuthEmails();
});
