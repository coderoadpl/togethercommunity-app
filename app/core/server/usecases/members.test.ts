import { describe, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, memberTombstone, type Identity, type Member, type MemberWithProductIds } from '#core/domain/index.js';

import type { MemberErasurePort, MemberPseudonymization, MemberRepository } from '../ports.js';
import { exportMembers, listMembers, removeMember } from './members.js';

const staff = (tenantId: string | null, tenantSlug: string | null): Identity => ({
  userId: 'u-staff',
  email: 'owner@together.dev',
  name: 'Owner',
  tenantId,
  tenantSlug,
  tenantName: tenantSlug ? 'Acme' : null,
  staffRole: tenantId ? 'owner' : null,
  memberId: null,
});

const plainMember = (tenantId: string): Identity => ({
  userId: 'u-member',
  email: 'buyer@together.dev',
  name: 'Buyer',
  tenantId,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'member-1',
});

const memberRow = (input: Partial<MemberWithProductIds> & { id: string }): MemberWithProductIds => ({
  id: input.id,
  email: input.email ?? `${input.id}@together.dev`,
  displayName: input.displayName ?? null,
  tags: input.tags ?? [],
  marketingConsents: input.marketingConsents ?? {},
  externalCustomerIds: input.externalCustomerIds ?? {},
  createdAt: input.createdAt ?? '2026-07-12T00:00:00.000Z',
  deletedAt: input.deletedAt ?? null,
  productIds: input.productIds ?? [],
  activeProductIds: input.activeProductIds ?? [],
});

const clock = { nowIso: () => '2026-07-12T12:00:00.000Z' };

const membersFor = (byTenant: Record<string, MemberWithProductIds[]>): MemberRepository => ({
  findById: async (): Promise<Member | null> => null,
  findByEmail: async (): Promise<Member | null> => null,
  create: async () => undefined,
  listWithProductIds: async (tenantId) => byTenant[tenantId] ?? [],
  updateEmail: async () => null,
});

const erasureFor = (
  byTenant: Record<string, MemberWithProductIds[]>,
  calls: Array<{ tenantId: string; input: MemberPseudonymization }> = [],
): MemberErasurePort => ({
  pseudonymize: async (tenantId, input) => {
    calls.push({ tenantId, input });
    const rows = byTenant[tenantId] ?? [];
    const row = rows.find((member) => member.id === input.memberId);
    if (!row) return null;
    if (row.deletedAt !== null) return { alreadyDeleted: true, authUserErased: false };
    row.deletedAt = input.deletedAt;
    row.email = input.tombstoneEmail;
    row.displayName = null;
    row.tags = [];
    row.marketingConsents = {};
    row.externalCustomerIds = {};
    return { alreadyDeleted: false, authUserErased: true };
  },
});

const depsFor = (
  byTenant: Record<string, MemberWithProductIds[]>,
  calls: Array<{ tenantId: string; input: MemberPseudonymization }> = [],
) => ({
  members: membersFor(byTenant),
  memberErasure: erasureFor(byTenant, calls),
  clock,
});

describe('listMembers', () => {
  it('requires the declared member read capability', async () => {
    const identity = staff('t-acme', 'acme');
    const deps = depsFor({ 't-acme': [memberRow({ id: 'm1' })] });
    expect(await listMembers({ identity, capabilities: ['member:read'] }, deps)).toMatchObject({
      ok: true,
    });
    expect(await listMembers({ identity, capabilities: ['member:export'] }, deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('forbids a plain member identity', async () => {
    const result = await listMembers(
      { identity: plainMember('t-acme') },
      depsFor({ 't-acme': [memberRow({ id: 'm1' })] }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a resolved tenant', async () => {
    const result = await listMembers({ identity: staff(null, null) }, depsFor({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('scopes members to the staff identity tenant', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'acme-1', email: 'acme@together.dev' })],
      't-globex': [memberRow({ id: 'globex-1', email: 'globex@together.dev' })],
    };

    const acme = await listMembers({ identity: staff('t-acme', 'acme') }, depsFor(byTenant));
    const globex = await listMembers({ identity: staff('t-globex', 'globex') }, depsFor(byTenant));

    expect(acme).toMatchObject({ ok: true, value: [{ id: 'acme-1' }] });
    expect(globex).toMatchObject({ ok: true, value: [{ id: 'globex-1' }] });
  });
});

describe('removeMember', () => {
  it('pseudonymizes the member with tombstone identifiers scoped to the staff tenant', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'm1', displayName: 'Jan Kowalski', tags: ['vip'] })],
      't-globex': [memberRow({ id: 'm1' })],
    };
    const calls: Array<{ tenantId: string; input: MemberPseudonymization }> = [];

    const result = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1' },
      depsFor(byTenant, calls),
    );

    expect(result).toEqual({ ok: true, value: { memberId: 'm1' } });
    expect(calls).toEqual([
      {
        tenantId: 't-acme',
        input: {
          memberId: 'm1',
          deletedAt: clock.nowIso(),
          tombstoneEmail: memberTombstone('m1').email,
          severedUserId: memberTombstone('m1').userId,
          postAuthorDisplay: DELETED_MEMBER_DISPLAY,
        },
      },
    ]);
    expect(byTenant['t-acme'][0]).toMatchObject({
      id: 'm1',
      email: memberTombstone('m1').email,
      displayName: null,
      tags: [],
      deletedAt: clock.nowIso(),
    });
    expect(byTenant['t-globex'][0]).toMatchObject({ id: 'm1', deletedAt: null });
  });

  it('keeps the member row so exports and sales history survive removal', async () => {
    const byTenant = { 't-acme': [memberRow({ id: 'm1', productIds: ['p1'] })] };

    await removeMember({ identity: staff('t-acme', 'acme') }, { memberId: 'm1' }, depsFor(byTenant));
    const listed = await listMembers({ identity: staff('t-acme', 'acme') }, depsFor(byTenant));

    expect(listed).toMatchObject({ ok: true, value: [{ id: 'm1', productIds: ['p1'] }] });
  });

  it('stays idempotent for an already pseudonymized member', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'm1', deletedAt: '2026-07-01T00:00:00.000Z' })],
    };

    const result = await removeMember({ identity: staff('t-acme', 'acme') }, { memberId: 'm1' }, depsFor(byTenant));

    expect(result).toEqual({ ok: true, value: { memberId: 'm1' } });
    expect(byTenant['t-acme'][0]?.deletedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('forbids a plain member identity', async () => {
    const result = await removeMember(
      { identity: plainMember('t-acme') },
      { memberId: 'm1' },
      depsFor({ 't-acme': [memberRow({ id: 'm1' })] }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('returns not_found when the member is absent in this tenant', async () => {
    const result = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'missing' },
      depsFor({ 't-acme': [memberRow({ id: 'm1' })] }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('exportMembers', () => {
  it('quotes and escapes CSV fields and joins productIds with a semicolon', async () => {
    const deps = depsFor({
      't-acme': [
        memberRow({
          id: 'm1',
          email: 'jane@together.dev',
          displayName: 'Doe, "Jane"',
          tags: ['vip', 'trial'],
          marketingConsents: { email: true },
          externalCustomerIds: { stripe: 'cus_123' },
          createdAt: '2026-07-12T09:00:00.000Z',
          productIds: ['p1', 'p2'],
        }),
      ],
    });

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'csv' }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.content.split('\n');
    expect(lines[0]).toBe(
      '"id","email","displayName","tags","marketingConsents","externalCustomerIds","createdAt","deletedAt","productIds"',
    );
    expect(lines[1]).toBe(
      '"m1","jane@together.dev","Doe, ""Jane""","vip;trial","{""email"":true}","{""stripe"":""cus_123""}","2026-07-12T09:00:00.000Z","","p1;p2"',
    );
    expect(result.value.filename).toBe('members-acme.csv');
    expect(result.value.mimeType).toContain('text/csv');
  });

  it('keeps pseudonymized rows in the export with their tombstone marker', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'm1', displayName: 'Jan Kowalski', productIds: ['p1'] })],
    };
    await removeMember({ identity: staff('t-acme', 'acme') }, { memberId: 'm1' }, depsFor(byTenant));

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'csv' }, depsFor(byTenant));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.content.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      `"m1","${memberTombstone('m1').email}","","","{}","{}","2026-07-12T00:00:00.000Z","${clock.nowIso()}","p1"`,
    );
  });

  it('neutralizes formula-like CSV cells controlled by members', async () => {
    const deps = depsFor({
      't-acme': [
        memberRow({
          id: 'm1',
          email: '=cmd@together.dev',
          displayName: '+SUM(1,1)',
          tags: ['@tag'],
          externalCustomerIds: { crm: '=abc' },
        }),
      ],
    });

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'csv' }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content.split('\n')[1]).toContain(
      '"\'=cmd@together.dev","\'+SUM(1,1)","\'@tag","{}","{""crm"":""=abc""}"',
    );
  });

  it('serializes the JSON array', async () => {
    const deps = depsFor({ 't-acme': [memberRow({ id: 'm1', productIds: ['p1'] })] });

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'json' }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value.content)).toMatchObject([{ id: 'm1', productIds: ['p1'] }]);
    expect(result.value.filename).toBe('members-acme.json');
  });

  it('forbids a plain member identity', async () => {
    const result = await exportMembers({ identity: plainMember('t-acme') }, { format: 'csv' }, depsFor({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
