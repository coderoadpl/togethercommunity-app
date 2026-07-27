import { describe, expect, it } from 'vitest';

import type { OrderRepository } from '../ports.js';
import { listMemberBillingOrders } from './member-billing-orders.js';

const ctx = {
  identity: {
    userId: 'user-1',
    email: 'member@example.com',
    name: 'Member',
    tenantId: 'tenant-1',
    tenantSlug: 'studio',
    tenantName: 'Studio',
    staffRole: null,
    memberId: 'member-1',
  },
};

describe('listMemberBillingOrders', () => {
  it('passes tenant, member and pagination to the narrow repository method', async () => {
    const calls: unknown[][] = [];
    const orders: OrderRepository = {
      create: async () => undefined,
      list: async () => ({ orders: [], total: 0 }),
      listBillingForMember: async (...args) => {
        calls.push(args);
        return {
          orders: [{
            id: 'order-1',
            createdAt: '2026-07-27T10:00:00.000Z',
            billing: {
              nip: '5555555555',
              companyName: 'Acme sp. z o.o.',
              address: 'Prosta 1',
              postalCode: '00-001',
              city: 'Warszawa',
              country: 'PL',
            },
          }],
          total: 1,
        };
      },
      revenueSince: async () => [],
      countSince: async () => 0,
    };
    const result = await listMemberBillingOrders(ctx, { page: 2, pageSize: 10 }, { orders });
    expect(result).toMatchObject({
      ok: true,
      value: {
        orders: [{ id: 'order-1', billing: { companyName: 'Acme sp. z o.o.' } }],
        total: 1,
        page: 2,
        pageSize: 10,
      },
    });
    expect(calls).toEqual([['tenant-1', 'member-1', 2, 10]]);
  });

  it('forbids staff identities without a member record', async () => {
    const orders = {
      create: async () => undefined,
      list: async () => ({ orders: [], total: 0 }),
      revenueSince: async () => [],
      countSince: async () => 0,
    };
    expect(await listMemberBillingOrders(
      { identity: { ...ctx.identity, staffRole: 'owner', memberId: null } },
      { page: 1, pageSize: 25 },
      { orders },
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
