import { describe, expect, it } from 'vitest';

import { ok, type EmailOutboxPayload, type Member, type Order, type Product, type ProductGrant, type TenantApiKey } from '#core/domain/index.js';

import type {
  ApiKeyCrypto,
  AuthPort,
  DevMagicLinkReader,
  EmailOutboxRepository,
  MemberRepository,
  ProductGrantRepository,
  ProductRepository,
  TenantApiKeyRepository,
} from '../ports.js';
import { authenticateApiKey, m2mEnroll, type M2mEnrollDeps } from './m2m-enroll.js';

const NOW = '2026-06-01T00:00:00.000Z';
const FUTURE = '2026-12-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const NEW_EXPIRY = '2027-06-01T00:00:00.000Z';
const TENANT = { id: 't1', name: 'Tenant One', slug: 'tenant-one' };

const product = (id: string, published: boolean): Product => ({
  id,
  tenantId: 't1',
  title: `Product ${id}`,
  description: '',
  priceCents: 0,
  currency: 'PLN',
  published,
  accessItems: [],
  legacyId: null,
  createdAt: PAST,
});

interface Sent {
  to: string;
  payload: EmailOutboxPayload;
}

interface Harness {
  deps: M2mEnrollDeps;
  grants: ProductGrant[];
  orders: Order[];
  sent: Sent[];
  captured: Array<{ email: string; callbackURL: string; baseUrl: string }>;
}

const harness = (options: {
  products: Product[];
  grants?: ProductGrant[];
  exposeMagicLinks?: boolean;
}): Harness => {
  const grants: ProductGrant[] = options.grants ? [...options.grants] : [];
  const members: Member[] = [];
  const orders: Order[] = [];
  const sent: Sent[] = [];
  const captured: Array<{ email: string; callbackURL: string; baseUrl: string }> = [];
  let seq = 0;

  const productsRepo: ProductRepository = {
    listByTenant: async () => options.products,
    listPublishedByTenant: async () => options.products.filter((p) => p.published),
    findById: async (_t, id) => options.products.find((p) => p.id === id) ?? null,
    create: async () => undefined,
    updateAccessItems: async () => null,
    setPublished: async () => undefined,
    bumpContentVersion: async () => undefined,
  };

  const grantsRepo: ProductGrantRepository = {
    findById: async (_t, id) => grants.find((g) => g.id === id) ?? null,
    findGrant: async (_t, memberId, productId) =>
      grants.find((g) => g.memberId === memberId && g.productId === productId) ?? null,
    createGrant: async (_t, grant) => {
      grants.push(grant);
      return true;
    },
    setGrantWindow: async (_t, grantId, window) => {
      const grant = grants.find((g) => g.id === grantId);
      if (!grant) return null;
      grant.startsAt = window.startsAt;
      grant.expiresAt = window.expiresAt;
      return grant;
    },
    revokeGrant: async () => null,
    listForMemberWithProductNames: async () => [],
    listActiveForMember: async () => [],
    listGrantedProducts: async () => [],
  };

  const membersRepo: MemberRepository = {
    findById: async (_t, id) => members.find((m) => m.id === id) ?? null,
    findByEmail: async (_t, email) => members.find((m) => m.email === email) ?? null,
    listWithProductIds: async () => [],
    create: async (_t, m) => {
      members.push(m);
    },
    updateEmail: async () => null,
  setBanned: async () => null,
  };

  const authPort: AuthPort = {
    getAuthenticatedUser: async () => null,
    ensureUser: async () => ({ userId: 'u-new', created: true }),
    requestMagicLink: async () => undefined,
    createEnrollmentMagicLink: async ({ email, callbackURL, baseUrl }) => {
      captured.push({ email, callbackURL, baseUrl });
      return { url: 'https://tenant.example/magic?token=abc' };
    },
  };

  const emailOutbox: EmailOutboxRepository = {
    enqueue: async (message) => {
      sent.push({ to: message.to, payload: message.payload });
      return ok({ id: message.id });
    },
    claimBatch: async () => ok([]),
    markSent: async () => ok(undefined),
    markFailed: async () => ok(undefined),
  };

  const devMagicLinks: DevMagicLinkReader = {
    findByEmail: async (address) => ({ email: address, url: 'https://tenant.example/magic?token=abc', token: 'abc' }),
  };

  return {
    grants,
    orders,
    sent,
    captured,
    deps: {
      products: productsRepo,
      grants: grantsRepo,
      members: membersRepo,
      tenants: {
        findById: async () => null,
        findBySlug: async () => null,
        findSettings: async () => null,
        updateSettings: async (_tenantId, next) => next,
        createTenantWithOwnerGrant: async () => {
          throw new Error('not used');
        },
      },
      authPort,
      enrollmentTransaction: { run: async (operation) => operation({ members: membersRepo, grants: grantsRepo, emailOutbox }) },
      dispatchEmail: () => undefined,
      devMagicLinks,
      prices: {
        listByProduct: async () => [],
        listActiveByProducts: async () => [],
        findById: async () => null,
        create: async () => undefined,
        setActive: async () => null,
      },
      orders: {
        create: async (_t, order) => {
          orders.push(order);
        },
        list: async () => ({ orders: [], total: 0 }),
        revenueSince: async () => [],
        countSince: async () => 0,
        listPaidWithoutGrant: async () => [],
      },
      ids: { nextId: () => `grant-${(seq += 1)}` },
      clock: { nowIso: () => NOW },
      appBaseUrl: 'https://tenant.example',
      baseDomain: 'example',
      exposeMagicLinks: options.exposeMagicLinks ?? false,
    },
  };
};

const activeGrant = (): ProductGrant => ({
  id: 'grant-existing',
  tenantId: 't1',
  memberId: 'm1',
  productId: 'p1',
  source: 'manual',
  startsAt: PAST,
  expiresAt: FUTURE,
  legacyId: null,
  createdAt: PAST,
});

const seedMember = async (deps: M2mEnrollDeps): Promise<void> => {
  await deps.members.create('t1', {
    id: 'm1',
    tenantId: 't1',
    userId: 'u-1',
    email: 'buyer@together.dev',
    displayName: null,
    tags: [],
    marketingConsents: {},
    externalCustomerIds: {},
    createdAt: PAST,
    deletedAt: null,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
  });
};

describe('m2mEnroll', () => {
  it('creates a grant starting now when none exists', async () => {
    const h = harness({ products: [product('p1', true)] });
    const result = await m2mEnroll(TENANT, { email: 'fresh@together.dev', productId: 'p1', expiresAt: NEW_EXPIRY }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { renewed: false } });
    expect(h.grants).toHaveLength(1);
    expect(h.grants[0]?.startsAt).toBe(NOW);
    expect(h.grants[0]?.expiresAt).toBe(NEW_EXPIRY);
    expect(h.grants[0]?.source).toBe('manual');
    expect(h.orders).toHaveLength(1);
    expect(h.orders[0]).toMatchObject({
      kind: 'one_time',
      status: 'paid',
      amountCents: 0,
      priceId: null,
      provider: 'simulated',
      providerObjectIds: { m2m: 'enroll' },
    });
  });

  it('renews an active grant by extending its expiry, keeping startsAt', async () => {
    const h = harness({ products: [product('p1', true)], grants: [activeGrant()] });
    await seedMember(h.deps);
    const result = await m2mEnroll(TENANT, { email: 'buyer@together.dev', productId: 'p1', expiresAt: NEW_EXPIRY }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { renewed: true, grantId: 'grant-existing' } });
    expect(h.grants).toHaveLength(1);
    expect(h.grants[0]?.startsAt).toBe(PAST);
    expect(h.grants[0]?.expiresAt).toBe(NEW_EXPIRY);
  });

  it('resets the window to now when the existing grant is expired', async () => {
    const expired = { ...activeGrant(), expiresAt: PAST };
    const h = harness({ products: [product('p1', true)], grants: [expired] });
    await seedMember(h.deps);
    const result = await m2mEnroll(TENANT, { email: 'buyer@together.dev', productId: 'p1', expiresAt: NEW_EXPIRY }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { renewed: false, grantId: 'grant-existing' } });
    expect(h.grants).toHaveLength(1);
    expect(h.grants[0]?.startsAt).toBe(NOW);
    expect(h.grants[0]?.expiresAt).toBe(NEW_EXPIRY);
  });

  it('sends the welcome enrollment email by default', async () => {
    const h = harness({ products: [product('p1', true)] });
    await m2mEnroll(TENANT, { email: 'fresh@together.dev', productId: 'p1' }, h.deps);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.to).toBe('fresh@together.dev');
    expect(h.sent[0]?.payload).toMatchObject({ actionUrl: 'https://tenant.example/magic?token=abc' });
    expect(h.captured).toEqual([
      expect.objectContaining({ email: 'fresh@together.dev' }),
    ]);
  });

  it('does not send an email when doNotSendEmail is set', async () => {
    const h = harness({ products: [product('p1', true)] });
    const result = await m2mEnroll(
      TENANT,
      { email: 'fresh@together.dev', productId: 'p1', doNotSendEmail: true },
      h.deps,
    );
    expect(result).toMatchObject({ ok: true, value: { magicLink: null } });
    expect(h.sent).toHaveLength(0);
    expect(h.captured).toHaveLength(0);
  });

  it('exposes the magic link only when the dev flag is on', async () => {
    const exposed = harness({ products: [product('p1', true)], exposeMagicLinks: true });
    const withLink = await m2mEnroll(TENANT, { email: 'fresh@together.dev', productId: 'p1' }, exposed.deps);
    expect(withLink.ok && withLink.value.magicLink?.token).toBe('abc');

    const hidden = harness({ products: [product('p1', true)], exposeMagicLinks: false });
    const withoutLink = await m2mEnroll(TENANT, { email: 'fresh@together.dev', productId: 'p1' }, hidden.deps);
    expect(withoutLink.ok && withoutLink.value.magicLink).toBeNull();
  });

  it('requests the enrollment magic link on the tenant host', async () => {
    const h = harness({ products: [product('p1', true)] });

    await m2mEnroll(TENANT, { email: 'fresh@together.dev', productId: 'p1' }, h.deps);

    expect(h.captured[0]).toMatchObject({
      callbackURL: 'https://tenant-one.example/',
      baseUrl: 'https://tenant-one.example/',
    });
    expect(new URL(h.captured[0]?.baseUrl ?? '').host).not.toBe('tenant.example');
  });

  it('is not found for an unpublished product', async () => {
    const h = harness({ products: [product('p1', false)] });
    const result = await m2mEnroll(TENANT, { email: 'fresh@together.dev', productId: 'p1' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.sent).toHaveLength(0);
  });
});

const apiKeyRow = (overrides: Partial<TenantApiKey>): TenantApiKey => ({
  id: 'key-1',
  tenantId: 't1',
  name: 'CI key',
  keyHash: 'hash:secret',
  createdAt: NOW,
  revokedAt: null,
  ...overrides,
});

const apiKeyDeps = (rows: TenantApiKey[]): { tenantApiKeys: TenantApiKeyRepository; apiKeyCrypto: ApiKeyCrypto } => ({
  tenantApiKeys: {
    listByTenant: async (tenantId) => rows.filter((r) => r.tenantId === tenantId),
    create: async () => undefined,
    findActiveByHash: async (tenantId, keyHash) =>
      rows.find((r) => r.tenantId === tenantId && r.keyHash === keyHash && r.revokedAt === null) ?? null,
    revoke: async () => null,
  },
  apiKeyCrypto: {
    generateSecret: () => 'secret',
    hash: (secret) => `hash:${secret}`,
  },
});

describe('authenticateApiKey', () => {
  it('accepts a valid active key', async () => {
    const result = await authenticateApiKey('t1', 'secret', apiKeyDeps([apiKeyRow({})]));
    expect(result).toMatchObject({ ok: true, value: { id: 'key-1' } });
  });

  it('rejects a missing key', async () => {
    const result = await authenticateApiKey('t1', '   ', apiKeyDeps([apiKeyRow({})]));
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('rejects a wrong key', async () => {
    const result = await authenticateApiKey('t1', 'nope', apiKeyDeps([apiKeyRow({})]));
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('rejects a revoked key', async () => {
    const result = await authenticateApiKey('t1', 'secret', apiKeyDeps([apiKeyRow({ revokedAt: NOW })]));
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('rejects a key that belongs to another tenant', async () => {
    const result = await authenticateApiKey('t2', 'secret', apiKeyDeps([apiKeyRow({})]));
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });
});
