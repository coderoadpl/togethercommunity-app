import { and, asc, eq, gt, notExists, or, sql } from 'drizzle-orm';

import {
  err,
  isSignInClientPlatformHost,
  ok,
  signInClientEventSchema,
  signInClientPublicSchema,
  type SignInClientEvent,
} from '#core/domain/index.js';
import type { SignInClientMutation, SignInClientRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { signInClientEvents, signInClientHostReservations, signInClients, tenantDomains, tenants } from './schema.js';

const publicColumns = {
  id: signInClients.clientId,
  redirectHost: signInClients.redirectHost,
  name: signInClients.name,
  redirectUris: signInClients.redirectUris,
  state: signInClients.state,
  credentialVersion: signInClients.credentialVersion,
  secretExpiresAt: signInClients.secretExpiresAt,
  createdAt: signInClients.createdAt,
  updatedAt: signInClients.updatedAt,
  secretRotatedAt: signInClients.secretRotatedAt,
  hostVerifiedAt: signInClients.hostVerifiedAt,
  activatedAt: signInClients.activatedAt,
  retiredAt: signInClients.retiredAt,
};

type PublicRow = Pick<typeof signInClients.$inferSelect, Exclude<keyof typeof publicColumns, 'id'>> & { id: string };

const iso = (value: string): string => new Date(value).toISOString();
const nullableIso = (value: string | null): string | null => value === null ? null : iso(value);
const parsePublic = (row: PublicRow) => signInClientPublicSchema.parse({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  secretExpiresAt: nullableIso(row.secretExpiresAt),
  secretRotatedAt: nullableIso(row.secretRotatedAt),
  hostVerifiedAt: nullableIso(row.hostVerifiedAt),
  activatedAt: nullableIso(row.activatedAt),
  retiredAt: nullableIso(row.retiredAt),
});

const scopedClient = (tenantId: string, id: string) => and(eq(signInClients.tenantId, tenantId), eq(signInClients.clientId, id));

const appendEvent = async (
  db: Db,
  tenantId: string,
  clientId: string,
  kind: SignInClientEvent['kind'],
  credentialVersion: number,
  stamp: SignInClientMutation,
): Promise<void> => {
  await db.insert(signInClientEvents).values(signInClientEventSchema.parse({
    id: stamp.eventId, tenantId, clientId, kind, actorKind: 'direct_owner', credentialVersion, occurredAt: stamp.at,
  }));
};

const withoutBoundValues = async <T>(query: () => Promise<T>): Promise<T> => {
  try {
    return await query();
  } catch {
    // Driver errors can embed the bound digest and return addresses, including in the cause.
    throw new Error('Sign-in client registry database operation failed');
  }
};

export const createSignInClientRepository = (db: Db, baseDomain: string): SignInClientRepository => ({
  create: async (tenantId, input) => {
    if (isSignInClientPlatformHost(input.redirectHost, baseDomain)) return err('host_unavailable');
    return withoutBoundValues(() => db.transaction(async (tx) => {
      const [workspace] = await tx.select({ id: tenants.id, status: tenants.status })
        .from(tenants).where(eq(tenants.id, tenantId)).for('share');
      if (workspace?.status !== 'active') return err('workspace_unavailable');

      const verifiedDomain = tx.select({ hostname: tenantDomains.domain }).from(tenantDomains).where(and(
        eq(tenantDomains.domain, input.redirectHost), eq(tenantDomains.kind, 'custom'), eq(tenantDomains.verified, true),
      ));
      const reservation = tx.select({
        hostname: sql<string>`${input.redirectHost}`.as('hostname'),
        clientId: sql<string>`${input.id}`.as('client_id'),
        reservedAt: sql<string>`${input.at}::timestamptz`.as('reserved_at'),
      }).from(tenants).where(and(eq(tenants.id, tenantId), notExists(verifiedDomain)));
      const [reserved] = await tx.insert(signInClientHostReservations).select(reservation)
        .onConflictDoNothing({ target: signInClientHostReservations.hostname })
        .returning({ hostname: signInClientHostReservations.hostname });
      if (reserved === undefined) return err('host_unavailable');

      const [row] = await tx.insert(signInClients).values({
        clientId: input.id, tenantId, name: input.name, redirectUris: input.redirectUris, redirectHost: input.redirectHost,
        state: 'pending_activation', credentialVersion: 1, secretHash: input.secretHash, secretExpiresAt: input.secretExpiresAt,
        createdAt: input.at, updatedAt: input.at,
      }).returning(publicColumns);
      if (row === undefined) throw new Error('Sign-in client insert returned no row');
      await appendEvent(tx, tenantId, row.id, 'created', row.credentialVersion, input);
      return ok(parsePublic(row));
    }));
  },
  findById: async (tenantId, id) => withoutBoundValues(async () => {
    const [row] = await db.select(publicColumns).from(signInClients).where(scopedClient(tenantId, id));
    return row === undefined ? null : parsePublic(row);
  }),
  list: async (tenantId, { cursor, limit }) => withoutBoundValues(async () => {
    const [boundary] = cursor === undefined ? [] : await db.select({ createdAt: signInClients.createdAt, id: signInClients.clientId })
      .from(signInClients).where(scopedClient(tenantId, cursor));
    if (cursor !== undefined && boundary === undefined) return { clients: [], nextCursor: null };
    const after = boundary === undefined ? undefined : or(
      gt(signInClients.createdAt, boundary.createdAt),
      and(eq(signInClients.createdAt, boundary.createdAt), gt(signInClients.clientId, boundary.id)),
    );
    const rows = await db.select(publicColumns).from(signInClients)
      .where(and(eq(signInClients.tenantId, tenantId), after))
      .orderBy(asc(signInClients.createdAt), asc(signInClients.clientId)).limit(limit + 1);
    const clients = rows.slice(0, limit).map(parsePublic);
    return { clients, nextCursor: rows.length > limit ? clients.at(-1)?.id ?? null : null };
  }),
  rotate: async (tenantId, id, input) => withoutBoundValues(() => db.transaction(async (tx) => {
    const scope = scopedClient(tenantId, id);
    const [locked] = await tx.select({ state: signInClients.state, version: signInClients.credentialVersion })
      .from(signInClients).where(scope).for('update');
    if (locked === undefined) return err('client_not_found');
    if (locked.state === 'retired') return err('client_retired');
    if (locked.version !== input.expectedCredentialVersion) return err('credential_version_changed');

    const [row] = await tx.update(signInClients).set({
      secretHash: input.secretHash, secretExpiresAt: input.secretExpiresAt, credentialVersion: locked.version + 1,
      secretRotatedAt: input.at, updatedAt: input.at,
    }).where(scope).returning(publicColumns);
    if (row === undefined) throw new Error('Locked sign-in client could not be rotated');
    await appendEvent(tx, tenantId, id, 'secret_rotated', row.credentialVersion, input);
    return ok(parsePublic(row));
  })),
  disable: async (tenantId, id, input) => withoutBoundValues(() => db.transaction(async (tx) => {
    const scope = scopedClient(tenantId, id);
    const [locked] = await tx.select(publicColumns).from(signInClients).where(scope).for('update');
    if (locked === undefined) return err('client_not_found');
    if (locked.state === 'retired') return ok(parsePublic(locked));

    const [row] = await tx.update(signInClients).set({
      state: 'retired', name: null, redirectUris: [], secretHash: null, secretExpiresAt: null,
      credentialVersion: locked.credentialVersion + 1, retiredAt: input.at, updatedAt: input.at,
    }).where(scope).returning(publicColumns);
    if (row === undefined) throw new Error('Locked sign-in client could not be retired');
    await appendEvent(tx, tenantId, id, 'retired', row.credentialVersion, input);
    return ok(parsePublic(row));
  })),
});
