import { describe, expect, it } from 'vitest';

import type { Invoice, Member, Post } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { exportMyData, type MemberDataExportDeps } from './member-data-export.js';

const now = '2026-07-29T10:00:00.000Z';
const member: Member = {
  id: 'member-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  email: 'member@example.com',
  displayName: 'Member',
  tags: ['customer'],
  marketingConsents: { newsletter: true },
  externalCustomerIds: { stripe: 'cus_1' },
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
  dmOptOutAt: null,
};
const post: Post = {
  id: 'post-1',
  tenantId: 'tenant-1',
  contextKind: 'space',
  contextId: 'space-1',
  rootPostId: 'post-1',
  parentPostId: null,
  authorUserId: 'user-1',
  authorDisplay: 'Member',
  authorIsStaff: false,
  body: 'My post',
  createdAt: now,
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
};
const invoice: Invoice = {
  id: 'invoice-1',
  tenantId: 'tenant-1',
  orderId: 'order-1',
  status: 'issued',
  provider: 'ksef',
  providerInvoiceId: 'provider-invoice-1',
  invoiceNumber: 'FV/1/2026',
  pdfUrl: 'https://invoices.example.com/invoice-1.pdf',
  error: null,
  issuedAt: now,
  createdAt: now,
  ksef: null,
};

const context = (role: 'member' | 'staff' | 'none'): Ctx => ({
  identity: {
    userId: 'user-1',
    email: 'member@example.com',
    name: 'Member',
    emailVerified: true,
    tenantId: role === 'none' ? null : 'tenant-1',
    tenantSlug: role === 'none' ? null : 'acme',
    tenantName: role === 'none' ? null : 'Acme',
    staffRole: role === 'staff' ? 'admin' : null,
    memberId: role === 'member' ? 'member-1' : null,
    image: null,
    memberDisplayName: null,
    memberBannedAt: null,
    memberDmOptOutAt: null,
  },
});

const deps = (
  selectedMember: Member | null = member,
  authoredPosts: Post[] = [post],
): MemberDataExportDeps => ({
  members: {
    findById: async () => selectedMember,
    findByEmail: async () => null,
    listWithProductIds: async () => [],
    create: async () => undefined,
    updateEmail: async () => null,
    updateDisplayName: async () => null,
    updateDmOptOut: async () => null,
    setBanned: async () => null,
  },
  grants: {
    findById: async () => null,
    findGrant: async () => null,
    createGrant: async () => false,
    setGrantWindow: async () => null,
    revokeGrant: async () => null,
    listForMemberWithProductNames: async () => [],
    listActiveForMember: async () => [],
    listGrantedProducts: async () => [],
  },
  subscriptions: {
    findById: async () => null,
    findByProviderSubscriptionId: async () => null,
    listForMember: async () => [],
    create: async () => undefined,
    update: async () => null,
    countActive: async () => 0,
  },
  orders: {
    create: async () => undefined,
    list: async () => ({ orders: [], total: 0 }),
    listForMember: async () => [],
    revenueSince: async () => [],
    countSince: async () => 0,
    listPaidWithoutGrant: async () => [],
  },
  invoices: {
    findById: async () => null,
    findByIdForMember: async () => null,
    listForMember: async () => [invoice],
    findCurrentByOrder: async () => null,
    findLatestRequestedEvent: async () => null,
    create: async () => false,
    claimRetry: async () => false,
    update: async () => null,
    appendEvent: async () => undefined,
  },
  progress: {
    findByMemberAndCourse: async () => null,
    listByMember: async () => [],
    findOrCreate: async () => {
      throw new Error('not used');
    },
    update: async () => null,
    countReferencingLesson: async () => 0,
  },
  posts: {
    createPost: async (_tenantId, value) => value,
    findById: async () => null,
    findByIds: async () => [],
    countByAuthorSince: async () => 0,
    listRecentBodiesByAuthor: async () => [],
    listByAuthor: async (_tenantId, authorUserId) =>
      authoredPosts.filter((value) => value.authorUserId === authorUserId),
    listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
    listThreadsForSpaces: async () => ({ threads: [], nextCursor: null }),
    listReplies: async () => [],
    updateBody: async () => null,
    softDelete: async () => null,
    setPinned: async () => null,
    listPinnedForContext: async () => [],
    countPinnedForContext: async () => 0,
    latestRootPostAt: async () => new Map(),
    search: async () => [],
  },
  consents: {
    record: async () => undefined,
    listByEmail: async () => [],
  },
  marketingConsents: {
    record: async () => undefined,
    listByEmail: async () => [],
    latestByEmail: async () => null,
    findById: async () => null,
    purgeStalePending: async () => 0,
  },
  clock: { nowIso: () => now },
});

describe('exportMyData', () => {
  it('returns the member disclosure package', async () => {
    const result = await exportMyData(context('member'), deps());
    expect(result).toMatchObject({
      ok: true,
      value: { filename: 'moje-dane-acme-2026-07-29.json' },
    });
    if (!result.ok) return;
    expect(JSON.parse(result.value.content)).toMatchObject({
      formatVersion: 1,
      profile: { email: member.email },
      posts: [{ id: post.id, body: post.body }],
      invoices: [{
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        providerInvoiceId: invoice.providerInvoiceId,
      }],
    });
  });

  it('forbids staff without a member row', async () => {
    const result = await exportMyData(context('staff'), deps());
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a tenant', async () => {
    const result = await exportMyData(context('none'), deps());
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('does not export a tombstoned member', async () => {
    const result = await exportMyData(
      context('member'),
      deps({ ...member, deletedAt: now }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('filters authored rows by the signed-in user', async () => {
    const otherPost = { ...post, id: 'post-2', authorUserId: 'user-2' };
    const result = await exportMyData(context('member'), deps(member, [post, otherPost]));
    if (!result.ok) return;
    expect(JSON.parse(result.value.content)).toMatchObject({
      posts: [{ id: 'post-1' }],
    });
  });
});
