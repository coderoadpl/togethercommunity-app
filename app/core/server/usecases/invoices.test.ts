import { describe, expect, it } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type Invoice,
  type InvoiceEvent,
  type OrderListItem,
} from '@core/domain/index.js';

import type { InvoiceDeps } from './invoices.js';
import { autoIssueOnPayment, requestInvoice } from './invoices.js';

const now = '2026-07-27T10:00:00.000Z';
const billing = {
  nip: '5555555555',
  companyName: 'Acme sp. z o.o.',
  address: 'Prosta 1',
  postalCode: '00-001',
  city: 'Warszawa',
  country: 'PL',
};

const order = (billingSnapshot: OrderListItem['billing'] = billing): OrderListItem => ({
  id: 'order-1',
  tenantId: 'tenant-1',
  memberId: 'member-1',
  productId: 'product-1',
  priceId: null,
  kind: 'one_time',
  status: 'paid',
  amountCents: 7900,
  currency: 'PLN',
  provider: 'stripe',
  providerObjectIds: {},
  couponId: null,
  discountCents: 0,
  billing: billingSnapshot,
  createdAt: now,
  memberEmail: 'buyer@example.com',
  memberName: 'Buyer',
  productTitle: 'Course',
  couponCode: null,
});

const harness = (options: {
  auto?: boolean;
  scope?: 'b2b_only' | 'all';
  fail?: boolean;
} = {}) => {
  const invoices: Invoice[] = [];
  const events: InvoiceEvent[] = [];
  let calls = 0;
  let ids = 0;
  const deps: InvoiceDeps = {
    invoices: {
      findById: async (_tenantId, id) => invoices.find((invoice) => invoice.id === id) ?? null,
      findCurrentByOrder: async (_tenantId, orderId) =>
        invoices.find((invoice) => invoice.orderId === orderId && invoice.status !== 'failed') ?? null,
      create: async (_tenantId, invoice, event) => {
        if (invoices.some((item) => item.orderId === invoice.orderId && item.status !== 'failed')) {
          return false;
        }
        invoices.push(invoice);
        events.push(event);
        return true;
      },
      update: async (_tenantId, invoice, event) => {
        const index = invoices.findIndex((item) => item.id === invoice.id);
        if (index < 0) return null;
        invoices[index] = invoice;
        events.push(event);
        return invoice;
      },
      appendEvent: async (_tenantId, event) => {
        events.push(event);
      },
    },
    invoicing: {
      issueInvoice: async () => {
        calls += 1;
        return options.fail
          ? err(integrationUnavailable('offline'))
          : ok({
              providerInvoiceId: 'provider-1',
              invoiceNumber: 'FV/1',
              pdfUrl: 'https://example.com/FV-1.pdf',
              status: 'issued',
            });
      },
      getInvoiceStatus: async () => ok('issued'),
      invoiceDownloadUrl: async () => ok('https://example.com/FV-1.pdf'),
    },
    orderDetails: { findById: async () => order() },
    tenants: {
      findById: async () => null,
      findBySlug: async () => null,
      findSettings: async () => ({
        billingPortalUrl: null,
        bunnyStreamLibraryId: null,
        logoUrl: null,
        accentColor: null,
        faviconUrl: null,
        termsUrl: null,
        privacyUrl: null,
        autoIssueInvoices: options.auto ?? false,
        autoIssueInvoiceScope: options.scope ?? 'b2b_only',
      }),
      updateSettings: async (_tenantId, settings) => settings,
      createTenantWithOwnerGrant: async () => {
        throw new Error('unused');
      },
    },
    tenantSecrets: {
      listByTenant: async () => [],
      findByKey: async (_tenantId, key) => ({
        id: key,
        tenantId: 'tenant-1',
        key,
        ciphertext: key.endsWith('apiKey') ? 'key' : 'acme',
        iv: 'iv',
        authTag: 'tag',
        maskedPreview: '••••',
        updatedAt: now,
      }),
      upsert: async (_tenantId, secret) => secret,
      delete: async () => false,
    },
    secretCrypto: {
      encrypt: (plaintext) => ({ ciphertext: plaintext, iv: 'iv', authTag: 'tag' }),
      decrypt: (secret) => ok(secret.ciphertext),
    },
    ids: { nextId: () => `id-${++ids}` },
    clock: { nowIso: () => now },
  };
  return { deps, invoices, events, calls: () => calls };
};

const ctx = {
  identity: {
    userId: 'user-1',
    email: 'owner@example.com',
    name: 'Owner',
    tenantId: 'tenant-1',
    tenantSlug: 'acme',
    tenantName: 'Acme',
    staffRole: 'owner' as const,
    memberId: null,
  },
};

describe('requestInvoice', () => {
  it('is idempotent per order', async () => {
    const h = harness();
    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(true);
    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(true);
    expect(h.calls()).toBe(1);
    expect(h.invoices).toHaveLength(1);
  });

  it('requires a billing snapshot', async () => {
    const h = harness();
    h.deps.orderDetails.findById = async () => order(null);
    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('records missing provider configuration as a failed lifecycle', async () => {
    const h = harness();
    h.deps.tenantSecrets.findByKey = async () => null;
    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: false,
      error: { code: 'integration_not_configured' },
    });
    expect(h.invoices).toMatchObject([{ status: 'failed', error: 'integration_not_configured' }]);
    expect(h.events.some((event) => event.type === 'failed')).toBe(true);
  });
});

describe('autoIssueOnPayment', () => {
  it.each([
    { scope: 'b2b_only' as const, billingSnapshot: null, issued: 0, skipped: 1 },
    { scope: 'b2b_only' as const, billingSnapshot: { ...billing, nip: null }, issued: 0, skipped: 1 },
    { scope: 'b2b_only' as const, billingSnapshot: billing, issued: 1, skipped: 0 },
    { scope: 'all' as const, billingSnapshot: null, issued: 1, skipped: 0 },
  ])('applies the $scope scope', async ({ scope, billingSnapshot, issued, skipped }) => {
    const h = harness({ auto: true, scope });
    const paidOrder = order(billingSnapshot);
    h.deps.orderDetails.findById = async () => paidOrder;
    await autoIssueOnPayment('tenant-1', paidOrder, h.deps);
    expect(h.calls()).toBe(issued);
    expect(h.events.filter((event) => event.type === 'skipped')).toHaveLength(skipped);
  });

  it('records a failed projection without throwing', async () => {
    const h = harness({ auto: true, scope: 'all', fail: true });
    await expect(autoIssueOnPayment('tenant-1', order(), h.deps)).resolves.toBeUndefined();
    expect(h.invoices).toMatchObject([{ status: 'failed', error: 'integration_unavailable' }]);
    expect(h.events.some((event) => event.type === 'failed')).toBe(true);
  });
});
