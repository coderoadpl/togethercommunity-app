import { err, isSignInClientPlatformHost, ok, type SignInClientEvent, type SignInClientPublic } from '#core/domain/index.js';

import type { SignInClientMutation, SignInClientRepository } from '../ports.js';

export const createInMemorySignInClientRepository = (options: { baseDomain?: string; verifiedHosts?: ReadonlySet<string> } = {}) => {
  const stored = new Map<string, { tenantId: string; publicClient: SignInClientPublic; secretHash: string | null }>();
  const reserved = new Set<string>();
  const events: SignInClientEvent[] = [];

  const find = (tenantId: string, id: string) => {
    const row = stored.get(id);
    return row?.tenantId === tenantId ? row : undefined;
  };

  const record = (tenantId: string, client: SignInClientPublic, kind: SignInClientEvent['kind'], stamp: SignInClientMutation) => {
    events.push({
      id: stamp.eventId, tenantId, clientId: client.id, kind, actorKind: 'direct_owner',
      credentialVersion: client.credentialVersion, occurredAt: stamp.at,
    });
  };

  const repo: SignInClientRepository = {
    create: async (tenantId, input) => {
      if (reserved.has(input.redirectHost) || options.verifiedHosts?.has(input.redirectHost) === true
        || (options.baseDomain !== undefined && isSignInClientPlatformHost(input.redirectHost, options.baseDomain))) {
        return err('host_unavailable');
      }
      if (stored.has(input.id)) throw new Error('Duplicate sign-in client ID');
      const publicClient: SignInClientPublic = {
        id: input.id, state: 'pending_activation', name: input.name, redirectHost: input.redirectHost,
        redirectUris: [...input.redirectUris], credentialVersion: 1, secretExpiresAt: input.secretExpiresAt,
        createdAt: input.at, updatedAt: input.at, secretRotatedAt: null, retiredAt: null, hostVerifiedAt: null, activatedAt: null,
      };
      reserved.add(input.redirectHost);
      stored.set(input.id, { tenantId, publicClient, secretHash: input.secretHash });
      record(tenantId, publicClient, 'created', input);
      return ok(structuredClone(publicClient));
    },
    findById: async (tenantId, id) => structuredClone(find(tenantId, id)?.publicClient ?? null),
    list: async (tenantId, { cursor, limit }) => {
      const rows = [...stored.values()].filter((row) => row.tenantId === tenantId).map((row) => row.publicClient)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const boundary = cursor === undefined ? 0 : rows.findIndex((row) => row.id === cursor) + 1;
      if (cursor !== undefined && boundary === 0) return { clients: [], nextCursor: null };
      const clients = rows.slice(boundary, boundary + limit);
      return { clients: structuredClone(clients), nextCursor: rows.length > boundary + limit ? clients.at(-1)?.id ?? null : null };
    },
    rotate: async (tenantId, id, input) => {
      const row = find(tenantId, id);
      if (row === undefined) return err('client_not_found');
      if (row.publicClient.state === 'retired') return err('client_retired');
      if (row.publicClient.credentialVersion !== input.expectedCredentialVersion) return err('credential_version_changed');
      row.publicClient = {
        ...row.publicClient, secretExpiresAt: input.secretExpiresAt, secretRotatedAt: input.at,
        updatedAt: input.at, credentialVersion: row.publicClient.credentialVersion + 1,
      };
      row.secretHash = input.secretHash;
      record(tenantId, row.publicClient, 'secret_rotated', input);
      return ok(structuredClone(row.publicClient));
    },
    disable: async (tenantId, id, input) => {
      const row = find(tenantId, id);
      if (row === undefined) return err('client_not_found');
      if (row.publicClient.state === 'retired') return ok(structuredClone(row.publicClient));
      row.publicClient = {
        ...row.publicClient, state: 'retired', name: null, redirectUris: [], secretExpiresAt: null,
        retiredAt: input.at, updatedAt: input.at, credentialVersion: row.publicClient.credentialVersion + 1,
      };
      row.secretHash = null;
      record(tenantId, row.publicClient, 'retired', input);
      return ok(structuredClone(row.publicClient));
    },
  };
  return {
    repo,
    events: (): readonly SignInClientEvent[] => structuredClone(events),
    storedHash: (tenantId: string, id: string) => find(tenantId, id)?.secretHash ?? null,
  };
};
