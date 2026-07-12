import { describe, expect, it } from 'vitest';

import type { Identity, Member, MemberWithProductIds } from '@core/domain/index.js';

import type { MemberRepository } from '../ports.js';
import { exportMembers, listMembers } from './members.js';

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
  createdAt: input.createdAt ?? '2026-07-12T00:00:00.000Z',
  productIds: input.productIds ?? [],
});

const membersFor = (byTenant: Record<string, MemberWithProductIds[]>): MemberRepository => ({
  findByEmail: async (): Promise<Member | null> => null,
  create: async () => undefined,
  listWithProductIds: async (tenantId) => byTenant[tenantId] ?? [],
});

describe('listMembers', () => {
  it('forbids a plain member identity', async () => {
    const result = await listMembers({ identity: plainMember('t-acme') }, {
      members: membersFor({ 't-acme': [memberRow({ id: 'm1' })] }),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a resolved tenant', async () => {
    const result = await listMembers({ identity: staff(null, null) }, {
      members: membersFor({}),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('scopes members to the staff identity tenant', async () => {
    const members = membersFor({
      't-acme': [memberRow({ id: 'acme-1', email: 'acme@together.dev' })],
      't-globex': [memberRow({ id: 'globex-1', email: 'globex@together.dev' })],
    });

    const acme = await listMembers({ identity: staff('t-acme', 'acme') }, { members });
    const globex = await listMembers({ identity: staff('t-globex', 'globex') }, { members });

    expect(acme).toMatchObject({ ok: true, value: [{ id: 'acme-1' }] });
    expect(globex).toMatchObject({ ok: true, value: [{ id: 'globex-1' }] });
  });
});

describe('exportMembers', () => {
  it('quotes and escapes CSV fields and joins productIds with a semicolon', async () => {
    const members = membersFor({
      't-acme': [
        memberRow({
          id: 'm1',
          email: 'jane@together.dev',
          displayName: 'Doe, "Jane"',
          createdAt: '2026-07-12T09:00:00.000Z',
          productIds: ['p1', 'p2'],
        }),
      ],
    });

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'csv' }, { members });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.content.split('\n');
    expect(lines[0]).toBe('"id","email","displayName","createdAt","productIds"');
    expect(lines[1]).toBe('"m1","jane@together.dev","Doe, ""Jane""","2026-07-12T09:00:00.000Z","p1;p2"');
    expect(result.value.filename).toBe('members-acme.csv');
    expect(result.value.mimeType).toContain('text/csv');
  });

  it('serializes the JSON array', async () => {
    const members = membersFor({ 't-acme': [memberRow({ id: 'm1', productIds: ['p1'] })] });

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'json' }, { members });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value.content)).toMatchObject([{ id: 'm1', productIds: ['p1'] }]);
    expect(result.value.filename).toBe('members-acme.json');
  });

  it('forbids a plain member identity', async () => {
    const result = await exportMembers({ identity: plainMember('t-acme') }, { format: 'csv' }, {
      members: membersFor({}),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
