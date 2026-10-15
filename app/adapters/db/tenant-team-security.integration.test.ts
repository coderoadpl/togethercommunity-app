import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ok } from '#core/domain/index.js';

import { createAuth, createAuthPort } from '#adapters/auth/create-auth.js';
import { AUTH_EMAIL_VERIFICATION_PATH, createAuthE2eClient } from '#adapters/auth/e2e-http.js';
import { authorizeTenant } from '#core/server/authorize.js';
import { resolveIdentity } from '#core/server/usecases/resolve-identity.js';
import { addTenantAdmin } from '#core/server/usecases/tenant-team.js';
import { createDevEmailPort } from '#adapters/email/dev.js';

import { createEmailOutboxRepository, createPlatformAuthSendLog } from './email-outbox.js';
import {
  createDevEmailReader,
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

it('removes the registrant session and password before email verification activates an invitation', async () => {
  const clock = { nowIso: () => new Date().toISOString() };
  const ids = { nextId: () => crypto.randomUUID() };
  const email = 'mailbox-owner@example.test';
  const origin = 'http://akademia.localhost:48730';
  await database.db.insert(tenants).values({
    id: 'akademia', slug: 'akademia', name: 'Academy', createdAt: clock.nowIso(),
  });
  await database.db.insert(user).values({
    id: 'verification-owner', email: 'verification-owner@example.test', name: 'Owner', emailVerified: true,
  });
  await database.db.insert(tenantAdmins).values({
    id: 'verification-owner-grant', tenantId: 'akademia', userId: 'verification-owner', role: 'owner',
  });
  const team = createTenantTeamRepository(database.db);
  const auth = createAuth(database.db, {
    secret: 'team-verification-test-secret-at-least-32-characters',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
    trustedOrigins: ['http://localhost:48730', origin],
    secureCookies: false,
    exposeMagicLinks: true,
    emailOutbox: createEmailOutboxRepository(database.db),
    emailSender: {
      send: async (message) => {
        const sent = await createDevEmailPort(database.db).send(message);
        return sent.ok ? ok({ ...sent.value, transport: 'platform' as const }) : sent;
      },
    },
    authSendLog: createPlatformAuthSendLog(database.db),
    ids,
    clock,
    dispatchEmail: () => undefined,
    defaultTenantName: 'Together',
    google: null,
    activateTeamInvitation: async ({ request, userId, email, occurredAt }) => {
      if (new URL(request.url).origin !== origin) return;
      await team.activateInvitation('akademia', userId, ids.nextId(), {
        id: ids.nextId(), tenantId: 'akademia', kind: 'team.admin_activated',
        actorUserId: userId, actorEmail: email, subjectMemberId: null, reason: userId, at: occurredAt,
      });
    },
  });
  const authPort = createAuthPort(auth);
  const authHttp = createAuthE2eClient({
    connectUrl: origin,
    origin,
    request: async (input, init) => auth.handler(new Request(input, init)),
  });
  auth.setEmailVerificationDeliveryContext(email, { tenantId: 'akademia', language: 'en', baseUrl: origin });
  const signedUp = await authHttp.signUpEmail({
    email, name: 'Mailbox owner', password: 'attacker-password-15',
  });
  expect(signedUp.status).toBe(200);
  const attackerHeaders = new Headers({
    authorization: `Bearer ${signedUp.token ?? ''}`,
  });
  const attacker = await authPort.getAuthenticatedUser(attackerHeaders);
  if (attacker === null) throw new Error('Registrant session was not created');
  expect(attacker).toMatchObject({ email, emailVerified: false });
  await auth.flushAuthEmails();
  const verificationEmail = await createDevEmailReader(database.db).findByRecipient(email);
  expect(verificationEmail?.subject).toBe('Verify your email address');
  const verificationLink = verificationEmail?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
  expect(new URL(verificationLink).pathname).toBe(AUTH_EMAIL_VERIFICATION_PATH);
  const identityDeps = {
    authPort, ids, clock,
    members: createMemberRepository(database.db),
    tenantAccess: createTenantAccessReader(database.db),
    tenantDomains: createTenantDomainRepository(database.db),
    tenants: createTenantRepository(database.db),
    baseDomain: 'localhost', platformHost: null, singleTenantMode: false,
  };
  const tenantRequest = { host: new URL(origin).host, tenantHeader: null };
  const owner = await resolveIdentity({
    sessionId: 'verification-owner-session', userId: 'verification-owner',
    email: 'verification-owner@example.test', name: 'Owner', emailVerified: true, image: null,
  }, tenantRequest, identityDeps);
  if (!owner.ok) throw new Error('Owner identity could not be resolved');
  expect(await addTenantAdmin({ identity: owner.value }, { email }, {
    ...identityDeps, team, appBaseUrl: 'http://localhost:48730',
  })).toEqual({ ok: true, value: { status: 'invitation_sent' } });
  expect(await team.list('akademia')).toContainEqual(expect.objectContaining({
    userId: attacker.userId, role: 'admin', status: 'invited',
  }));
  const verified = await auth.handler(new Request(verificationLink));
  expect(verified.status).toBe(302);
  expect(await authPort.getAuthenticatedUser(attackerHeaders)).toBeNull();
  const passwordSignIn = await authHttp.signInEmail({ email, password: 'attacker-password-15' });
  expect(passwordSignIn.status).toBe(401);
  expect(passwordSignIn.token).toBeNull();
  expect(await database.db.select().from(account).where(eq(account.userId, attacker.userId))).toEqual([]);
  const mailboxOwner = await authPort.getAuthenticatedUser(new Headers({
    authorization: `Bearer ${verified.headers.get('set-auth-token') ?? ''}`,
  }));
  expect(mailboxOwner).toMatchObject({ email, emailVerified: true });
  const identity = await resolveIdentity(mailboxOwner, tenantRequest, identityDeps);
  if (!identity.ok) throw new Error('Mailbox owner identity could not be resolved');
  expect(identity.value).toMatchObject({ tenantAccess: 'staff', staffRole: 'admin' });
  expect(authorizeTenant({ identity: identity.value }, 'order:read')).toMatchObject({ ok: true });
  expect(await team.list('akademia')).toContainEqual(expect.objectContaining({
    userId: attacker.userId, role: 'admin', status: 'active',
  }));
  expect(await database.db.select().from(tenantAuditEvents)
    .where(eq(tenantAuditEvents.tenantId, 'akademia'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'team.admin_invited' }),
      expect.objectContaining({ kind: 'team.admin_activated' }),
    ]));
  const invitationLink = await createDevMagicLinkReader(database.db).findByEmail(email);
  expect((await auth.handler(new Request(invitationLink?.url ?? ''))).status).toBe(302);
  const auditEvents = await database.db.select().from(tenantAuditEvents)
    .where(eq(tenantAuditEvents.tenantId, 'akademia'));
  expect(auditEvents.filter((event) => event.kind === 'team.admin_activated')).toHaveLength(1);
  expect(await authPort.getAuthenticatedUser(attackerHeaders)).toBeNull();
  expect(await database.db.select().from(account).where(eq(account.userId, attacker.userId))).toEqual([]);
  await auth.flushAuthEmails();
});
