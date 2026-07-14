import { describe, expect, it } from 'vitest';

import {
  ok,
  type Member,
  type ProcessedPaymentEvent,
  type Product,
  type ProductGrant,
} from '@core/domain/index.js';

import type { PaymentWebhookEvent } from '../ports.js';
import { m2mEnroll } from './m2m-enroll.js';
import { fulfillStripeWebhook, type StripeWebhookDeps } from './stripe-webhook.js';

const now = '2026-07-14T10:00:00.000Z';
const tenantA = { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 };

const product = (tenantId: string): Product => ({
  id: 'product-1',
  tenantId,
  title: 'Course One',
  description: 'Learn.',
  priceCents: 4900,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: now,
});

const completedEvent = (overrides?: {
  id?: string;
  objectId?: string;
  tenantId?: string;
  productId?: string;
  email?: string;
}): PaymentWebhookEvent => ({
  id: overrides?.id ?? 'evt-1',
  type: 'checkout.session.completed',
  objectId: overrides?.objectId ?? 'cs-1',
  checkoutSession: {
    email: overrides?.email ?? 'buyer@example.com',
    metadata: {
      tenantId: overrides?.tenantId ?? 'tenant-a',
      productId: overrides?.productId ?? 'product-1',
      memberEmail: null,
      language: 'pl',
    },
  },
});

const harness = () => {
  const members = new Map<string, Member>();
  const grants = new Map<string, ProductGrant>();
  const events = new Map<string, ProcessedPaymentEvent>();
  const sent: string[] = [];
  let sequence = 0;

  const deps: StripeWebhookDeps = {
    authPort: {
      getAuthenticatedUser: async () => null,
      ensureUser: async (email) => ({ userId: `user-${email}`, created: true }),
      requestMagicLink: async () => undefined,
      createEnrollmentMagicLink: async (input) => ({ url: `https://alpha.example.com/magic/${input.email}` }),
    },
    members: {
      findById: async (tenantId, memberId) => {
        const member = members.get(`${tenantId}:${memberId}`);
        return member ?? null;
      },
      findByEmail: async (tenantId, email) =>
        Array.from(members.values()).find((member) => member.tenantId === tenantId && member.email === email) ?? null,
      listWithProductIds: async () => [],
      create: async (tenantId, member) => {
        members.set(`${tenantId}:${member.id}`, member);
      },
      updateEmail: async () => null,
      delete: async () => false,
    },
    products: {
      listByTenant: async () => [],
      listPublishedByTenant: async () => [],
      findById: async (tenantId, productId) => (productId === 'product-1' ? product(tenantId) : null),
      create: async () => undefined,
      updateAccessItems: async () => null,
      setPublished: async () => undefined,
      bumpContentVersion: async () => undefined,
    },
    grants: {
      findById: async (tenantId, grantId) => grants.get(`${tenantId}:${grantId}`) ?? null,
      findGrant: async (tenantId, memberId, productId) =>
        Array.from(grants.values()).find(
          (grant) => grant.tenantId === tenantId && grant.memberId === memberId && grant.productId === productId,
        ) ?? null,
      createGrant: async (tenantId, grant) => {
        grants.set(`${tenantId}:${grant.id}`, grant);
        return true;
      },
      setGrantWindow: async (tenantId, grantId, window) => {
        const existing = grants.get(`${tenantId}:${grantId}`);
        if (!existing) return null;
        const updated = { ...existing, ...window };
        grants.set(`${tenantId}:${grantId}`, updated);
        return updated;
      },
      revokeGrant: async () => null,
      listForMemberWithProductNames: async () => [],
      listActiveForMember: async () => [],
      listGrantedProducts: async () => [],
    },
    processedPaymentEvents: {
      findByEventId: async (tenantId, eventId) => {
        const event = events.get(eventId);
        return event?.tenantId === tenantId ? event : null;
      },
      findByObjectAndType: async (tenantId, objectId, type) =>
        Array.from(events.values()).find(
          (event) => event.tenantId === tenantId && event.objectId === objectId && event.type === type,
        ) ?? null,
      create: async (tenantId, event) => {
        if (events.has(event.id)) return false;
        events.set(event.id, { ...event, tenantId });
        return true;
      },
    },
    email: {
      send: async (message) => {
        sent.push(message.to);
        return ok({ messageId: `message-${sent.length}` });
      },
    },
    devMagicLinks: { findByEmail: async () => null },
    ids: { nextId: () => `id-${++sequence}` },
    clock: { nowIso: () => now },
    appBaseUrl: 'https://alpha.example.com',
    exposeMagicLinks: false,
  };

  return { deps, members, grants, events, sent };
};

describe('fulfillStripeWebhook', () => {
  it('fulfills once when Stripe retries the same event', async () => {
    const h = harness();
    const first = await fulfillStripeWebhook(tenantA, completedEvent(), h.deps);
    const second = await fulfillStripeWebhook(tenantA, completedEvent(), h.deps);

    expect(first).toEqual({ ok: true, value: { processed: true } });
    expect(second).toEqual({ ok: true, value: { processed: false } });
    expect(h.members.size).toBe(1);
    expect(h.grants.size).toBe(1);
    expect(h.events.size).toBe(1);
    expect(h.sent).toEqual(['buyer@example.com']);
    expect(Array.from(h.grants.values())[0]?.source).toBe('stripe');
  });

  it('rejects tenant metadata mismatch before creating a member or grant', async () => {
    const h = harness();
    const result = await fulfillStripeWebhook(tenantA, completedEvent({ tenantId: 'tenant-b' }), h.deps);

    expect(result.ok).toBe(false);
    expect(h.members.size).toBe(0);
    expect(h.grants.size).toBe(0);
    expect(h.sent).toEqual([]);
  });

  it('uses the same member, grant, magic-link, and welcome-email fulfillment path as m2m enrollment', async () => {
    const stripe = harness();
    const m2m = harness();
    const stripeResult = await fulfillStripeWebhook(tenantA, completedEvent(), stripe.deps);
    const m2mResult = await m2mEnroll(
      tenantA,
      { email: 'buyer@example.com', productId: 'product-1', language: 'pl' },
      m2m.deps,
    );

    expect(stripeResult.ok).toBe(true);
    expect(m2mResult.ok).toBe(true);
    expect(stripe.members.size).toBe(m2m.members.size);
    expect(stripe.grants.size).toBe(m2m.grants.size);
    expect(stripe.sent).toEqual(m2m.sent);
  });
});
