import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { createOrganizationFakes } from '../testing/organization-fakes.js';
import { operatorCtx } from '../testing/operator-tenant-fakes.js';

import { createOrganization, setOrganizationLimits, type OperatorOrganizationDeps } from './operator-organizations.js';

const accounts = [
  { userId: 'owner-1', email: 'owner@example.test', emailVerified: true },
  { userId: 'owner-2', email: 'other@example.test', emailVerified: true },
  { userId: 'unverified-1', email: 'unverified@example.test', emailVerified: false },
];

const harness = () => {
  const fakes = createOrganizationFakes(accounts);
  let nextId = 0;
  const deps: OperatorOrganizationDeps = {
    organizations: fakes.repositories.organizations,
    authPort: fakes.authPort,
    ids: { nextId: () => `id-${++nextId}` },
    clock: { nowIso: () => '2026-11-15T12:00:00.000Z' },
  };
  return { ...fakes, deps };
};

const input = { slug: 'holding', name: 'Holding', ownerEmail: 'owner@example.test' };

describe('operator organization creation', () => {
  it('creates the organization, the owner membership and both audit events once', async () => {
    const h = harness();
    const first = await createOrganization(operatorCtx, { ...input, maxWorkspaces: 3 }, h.deps);
    expect(first).toMatchObject({ ok: true, value: { created: true, ownerUserId: 'owner-1', organization: { slug: 'holding', maxWorkspaces: 3, status: 'active' } } });
    expect(h.memberRows).toEqual([expect.objectContaining({ userId: 'owner-1', role: 'owner', organizationId: h.organizationRows[0]?.id })]);
    expect(h.auditRows.map((event) => [event.kind, event.subjectUserId])).toEqual([['organization.created', null], ['member.added', 'owner-1']]);
    expect(h.auditRows.every((event) => event.actorUserId === 'operator-secret')).toBe(true);
  });

  it('is idempotent by slug for the same owner', async () => {
    const h = harness();
    const first = await createOrganization(operatorCtx, input, h.deps);
    const replay = await createOrganization(operatorCtx, { ...input, ownerEmail: ' OWNER@example.test ' }, h.deps);
    expect(replay).toEqual({ ok: true, value: { organization: first.ok ? first.value.organization : null, created: false, ownerUserId: 'owner-1' } });
    expect(h.organizationRows).toHaveLength(1);
    expect(h.memberRows).toHaveLength(1);
    expect(h.auditRows).toHaveLength(2);
  });

  it('refuses the same slug for another owner without writing anything', async () => {
    const h = harness();
    await createOrganization(operatorCtx, input, h.deps);
    const other = await createOrganization(operatorCtx, { ...input, ownerEmail: 'other@example.test' }, h.deps);
    expect(other).toEqual({ ok: false, error: { code: 'conflict', message: 'Organization slug belongs to another owner' } });
    expect(h.memberRows).toHaveLength(1);
    expect(h.auditRows).toHaveLength(2);
  });

  it.each(['missing@example.test', 'unverified@example.test'])('refuses the owner %s', async (ownerEmail) => {
    const h = harness();
    expect(await createOrganization(operatorCtx, { ...input, ownerEmail }, h.deps)).toEqual({
      ok: false, error: { code: 'validation', message: 'Owner account not found or not verified' },
    });
    expect(h.organizationRows).toEqual([]);
    expect(h.auditRows).toEqual([]);
  });

  it('refuses reserved slugs and callers without the operator capability', async () => {
    const h = harness();
    expect(await createOrganization(operatorCtx, { ...input, slug: 'www' }, h.deps)).toMatchObject({ ok: false, error: { code: 'slug_reserved' } });
    const identity: Identity = { ...operatorCtx.identity, userId: 'owner-1', email: 'owner@example.test' };
    const session: Ctx = { identity };
    expect(await createOrganization(session, input, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await setOrganizationLimits(session, { organizationId: 'id-1', maxWorkspaces: 2 }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.organizationRows).toEqual([]);
  });
});

describe('operator organization limits', () => {
  it('sets maxWorkspaces with an audit event and answers not_found for an unknown organization', async () => {
    const h = harness();
    const created = await createOrganization(operatorCtx, input, h.deps);
    const organizationId = created.ok ? created.value.organization.id : '';
    expect(await setOrganizationLimits(operatorCtx, { organizationId, maxWorkspaces: 5 }, h.deps))
      .toMatchObject({ ok: true, value: { organization: { id: organizationId, maxWorkspaces: 5 } } });
    expect(h.auditRows.at(-1)).toMatchObject({ kind: 'organization.updated', data: { maxWorkspaces: 5 }, organizationId });
    expect(await setOrganizationLimits(operatorCtx, { organizationId: 'unknown', maxWorkspaces: 5 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await setOrganizationLimits(operatorCtx, { organizationId, maxWorkspaces: -1 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
