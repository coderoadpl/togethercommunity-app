import { describe, expect, it } from 'vitest';

import type { Identity, PaidWithoutGrantRow } from '#core/domain/index.js';

import type { OrderRepository } from '../ports.js';
import { listPaidOrdersWithoutGrant } from './order-reconciliation.js';

const identity = (staffRole: 'owner' | 'admin' | null): Identity => ({
  userId: 'u1',
  email: 'owner@together.dev',
  name: 'Owner',
  emailVerified: true,
  tenantId: 'tenant-a',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole,
  memberId: staffRole === null ? 'member-1' : null,
image: null,
memberDisplayName: null,
memberBannedAt: null,
});

const row: PaidWithoutGrantRow = {
  orderId: 'order-1',
  createdAt: '2026-07-14T09:00:00.000Z',
  memberId: 'member-1',
  memberEmail: 'member@together.dev',
  productId: 'product-1',
  productTitle: 'Course',
  kind: 'one_time',
  provider: 'simulated',
  amountCents: 4900,
  currency: 'PLN',
  providerObjectIds: { checkoutSession: 'checkout-1' },
};

const orders = (rows: PaidWithoutGrantRow[]): OrderRepository => ({
  create: async () => undefined,
  list: async () => ({ orders: [], total: 0 }),
  revenueSince: async () => [],
  countSince: async () => 0,
  listPaidWithoutGrant: async (tenantId, query) =>
    tenantId === 'tenant-a' && query.paidBefore === '2026-07-14T09:45:00.000Z'
      ? rows.slice(0, query.limit)
      : [],
});

describe('listPaidOrdersWithoutGrant', () => {
  it('applies the grace threshold and returns findings for staff', async () => {
    const result = await listPaidOrdersWithoutGrant(
      { identity: identity('admin') },
      { minAgeMinutes: 15, limit: 10 },
      {
        orders: orders([row]),
        clock: { nowIso: () => '2026-07-14T10:00:00.000Z' },
      },
    );

    expect(result).toEqual({
      ok: true,
      value: { rows: [row], checkedThrough: '2026-07-14T09:45:00.000Z' },
    });
  });

  it('denies members without the reconciliation capability', async () => {
    const result = await listPaidOrdersWithoutGrant(
      { identity: identity(null) },
      {},
      {
        orders: orders([row]),
        clock: { nowIso: () => '2026-07-14T10:00:00.000Z' },
      },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('applies default query values', async () => {
    const result = await listPaidOrdersWithoutGrant(
      { identity: identity('owner') },
      {},
      {
        orders: orders([row]),
        clock: { nowIso: () => '2026-07-14T10:00:00.000Z' },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: { rows: [row], checkedThrough: '2026-07-14T09:45:00.000Z' },
    });
  });

  it('rejects out-of-range ages and limits', async () => {
    const deps = {
      orders: orders([row]),
      clock: { nowIso: () => '2026-07-14T10:00:00.000Z' },
    };
    expect(
      await listPaidOrdersWithoutGrant(
        { identity: identity('admin') },
        { minAgeMinutes: -1 },
        deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      await listPaidOrdersWithoutGrant(
        { identity: identity('admin') },
        { limit: 201 },
        deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
