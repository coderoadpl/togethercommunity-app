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
import { autoIssueOnPayment, requestInvoice, testIfirmaConnection } from './invoices.js';

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
  failAfterCreate?: boolean;
  uncertainFailure?: boolean;
  provider?: 'ifirma' | 'ksef';
} = {}) => {
  const invoices: Invoice[] = [];
  const events: InvoiceEvent[] = [];
  let calls = 0;
  let testedConfig: { invoiceApiKey: string; username: string } | null = null;
  let ids = 0;
  const deps: InvoiceDeps = {
    invoices: {
      findById: async (_tenantId, id) => invoices.find((invoice) => invoice.id === id) ?? null,
      findCurrentByOrder: async (_tenantId, orderId) =>
        invoices.find((invoice) => invoice.orderId === orderId) ?? null,
      create: async (_tenantId, invoice, event) => {
        if (invoices.some((item) => item.orderId === invoice.orderId && item.status !== 'failed')) {
          return false;
        }
        invoices.push(invoice);
        events.push(event);
        return true;
      },
      claimRetry: async (_tenantId, invoice, event) => {
        const index = invoices.findIndex((item) => item.id === invoice.id && item.status === 'failed');
        if (index < 0) return false;
        invoices[index] = invoice;
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
      createFrozenKsef: async (_tenantId, invoice, event) => {
        invoices.push(invoice);
        events.push(event);
        return true;
      },
      checkpointKsef: async (_tenantId, invoice) => invoice,
    },
    invoicing: {
      issueInvoice: async ({
        providerInvoiceId,
        onProviderInvoiceCreateUncertain,
        onProviderInvoiceCreated,
      }) => {
        calls += 1;
        if (options.uncertainFailure === true) {
          await onProviderInvoiceCreateUncertain();
          return err(integrationUnavailable('connection lost'));
        }
        if (providerInvoiceId === null && options.failAfterCreate === true) {
          await onProviderInvoiceCreated('provider-1');
          return err(integrationUnavailable('read-back offline'));
        }
        return options.fail
          ? err(integrationUnavailable('offline'))
          : ok({
              providerInvoiceId: providerInvoiceId ?? 'provider-1',
              invoiceNumber: 'FV/1',
              status: 'issued',
            });
      },
      getInvoiceStatus: async () => ok('issued'),
      downloadInvoice: async () => ok({
        content: new TextEncoder().encode('%PDF-1.7'),
        contentType: 'application/pdf',
      }),
      testConnection: async ({ config }) => {
        testedConfig = config;
        return ok({ diagnostic: 'iFirma accepted the credentials.' });
      },
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
        invoiceVatRatePercent: 23,
        invoicingProvider: options.provider ?? 'ifirma',
        invoiceSellerName: 'Together sp. z o.o.',
        invoiceSellerAddress: 'Prosta 1, 00-001 Warszawa',
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
        ciphertext: key.endsWith('invoiceApiKey') ? 'key' : 'owner@example.com',
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
    ksef: {
      environment: 'test',
      credentials: {
        resolve: async () => ok({ token: 'ksef-token', contextNip: '5555555555' }),
      },
      numbers: {
        allocate: async () => ({ p2: 'FV/2026/000001', sequence: 1 }),
      },
      artifacts: {
        findByKey: async () => null,
        store: async () => true,
      },
      hash: {
        sha256: () => 'a'.repeat(64),
      },
    },
  };
  return { deps, invoices, events, calls: () => calls, testedConfig: () => testedConfig };
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

  it('supports a B2C order without a billing snapshot', async () => {
    const h = harness();
    h.deps.orderDetails.findById = async () => order(null);
    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({ ok: true });
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

  it('persists a provider checkpoint and resumes a failed read-back without creating again', async () => {
    const h = harness({ failAfterCreate: true });
    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable' },
    });
    expect(h.invoices[0]).toMatchObject({
      status: 'failed',
      providerInvoiceId: 'provider-1',
    });
    expect(h.events.some((event) => event.type === 'provider_created')).toBe(true);

    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(true);
    expect(h.calls()).toBe(2);
    expect(h.invoices).toHaveLength(1);
    expect(h.invoices[0]).toMatchObject({ status: 'issued', providerInvoiceId: 'provider-1' });
  });

  it('fails before contacting iFirma when the VAT rate is not configured', async () => {
    const h = harness();
    const findSettings = h.deps.tenants.findSettings;
    h.deps.tenants.findSettings = async (tenantId) => {
      const settings = await findSettings(tenantId);
      return settings === null ? null : { ...settings, invoiceVatRatePercent: null };
    };
    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(h.calls()).toBe(0);
  });

  it('blocks an automatic retry when the create outcome is unknown', async () => {
    const h = harness({ uncertainFailure: true });
    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(false);
    expect(h.invoices[0]).toMatchObject({
      status: 'failed',
      providerInvoiceId: null,
      error: 'provider_create_uncertain',
    });
    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(false);
    expect(h.calls()).toBe(1);
  });

  it('freezes and queues KSeF issuance without making a provider HTTP call', async () => {
    const h = harness({ provider: 'ksef' });

    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: true,
      value: {
        status: 'queued',
        provider: 'ksef',
        invoiceNumber: 'FV/2026/000001',
        ksef: {
          state: 'queued',
          xmlSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });
    expect(h.calls()).toBe(0);
    expect(h.events.at(-1)).toMatchObject({ type: 'frozen' });
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

describe('testIfirmaConnection', () => {
  it('decrypts both iFirma secrets and exercises the invoicing authentication path', async () => {
    const h = harness();
    expect(await testIfirmaConnection(ctx, h.deps)).toEqual({
      ok: true,
      value: { ok: true, diagnostic: 'iFirma accepted the credentials.' },
    });
    expect(h.testedConfig()).toEqual({
      invoiceApiKey: 'key',
      username: 'owner@example.com',
    });
  });

  it('allows only the tenant owner to test iFirma', async () => {
    const h = harness();
    expect(await testIfirmaConnection({
      identity: { ...ctx.identity, staffRole: 'admin' },
    }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(h.testedConfig()).toBeNull();
  });
});
