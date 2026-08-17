import { describe, expect, it } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type Invoice,
  type InvoiceEvent,
  type OrderListItem,
} from '#core/domain/index.js';

import type { InvoiceDeps } from './invoices.js';
import {
  autoIssueOnPayment,
  downloadInvoiceUpo,
  downloadMemberInvoice,
  refreshInvoiceStatus,
  requestInvoice,
  testIfirmaConnection,
  testKsefConnection,
} from './invoices.js';
import { dispatchAutoInvoiceJobs } from './dispatch-auto-invoice-jobs.js';

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
  nowIso?: string;
} = {}) => {
  const invoices: Invoice[] = [];
  const events: InvoiceEvent[] = [];
  let calls = 0;
  let allocatedYear: number | null = null;
  let frozenXml: string | null = null;
  let testedConfig: { invoiceApiKey: string; username: string } | null = null;
  let testedKsefCredentials: { tenantId: string; token: string; contextNip: string } | null = null;
  let ids = 0;
  const deps: InvoiceDeps = {
    invoices: {
      findById: async (_tenantId, id) => invoices.find((invoice) => invoice.id === id) ?? null,
      findCurrentByOrder: async (_tenantId, orderId) =>
        invoices.find((invoice) => invoice.orderId === orderId) ?? null,
      findLatestRequestedEvent: async (_tenantId, invoiceId) =>
        [...events].reverse().find((event) =>
          event.invoiceId === invoiceId && event.type === 'requested') ?? null,
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
      createFrozenKsef: async (_tenantId, invoice, event, artifact) => {
        invoices.push(invoice);
        events.push(event);
        frozenXml = artifact.content;
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
      findSole: async () => null,
      hasAny: async () => false,
      findSettings: async () => ({
        name: 'Acme',
        socialLinks: [],
        billingPortalUrl: null,
        bunnyStreamLibraryId: null,
        bunnyStreamCdnHostname: null,
        logoUrl: null,
        accentColor: null,
        faviconUrl: null,
        ogTitle: null,
        ogDescription: null,
        ogImageUrl: null,
        supportEmail: null,
        supportUrl: null,
        termsUrl: null,
        privacyUrl: null,
        defaultHomeSpaceId: null,
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
    clock: { nowIso: () => options.nowIso ?? now },
    ksef: {
      environment: 'test',
      credentials: {
        resolve: async () => ok({
          tenantId: 'tenant-1',
          token: 'ksef-token',
          contextNip: '5555555555',
        }),
      },
      numbers: {
        allocate: async (_tenantId, input) => {
          allocatedYear = input.year;
          return { p2: `FV/${String(input.year)}/000001`, sequence: 1 };
        },
      },
      artifacts: {
        findByKey: async () => null,
        store: async () => true,
      },
      hash: {
        sha256: () => 'a'.repeat(64),
      },
      validator: {
        validate: async () => ok(undefined),
      },
      client: {
        validateCredentials: async ({ credentials }) => {
          testedKsefCredentials = credentials;
          return ok({ diagnostic: 'KSeF accepted the token for this NIP context.' });
        },
        openSession: async () => ok({ sessionReference: 'session-1' }),
        submitInvoice: async () => ok({ invoiceReference: 'invoice-reference-1' }),
        listSessionInvoices: async () => ok([]),
        getInvoiceStatus: async () => ok({
          code: 150,
          description: 'Processing',
          details: [],
          extensions: {},
          ksefNumber: null,
          acquisitionAt: null,
          invoicingAt: null,
          permanentStorageAt: null,
        }),
        downloadUpo: async () => ok('<upo/>'),
        verifyDuplicateOriginal: async () => ok(false),
        closeSession: async () => ok(undefined),
      },
    },
  };
  return {
    deps,
    invoices,
    events,
    calls: () => calls,
    allocatedYear: () => allocatedYear,
    frozenXml: () => frozenXml,
    testedConfig: () => testedConfig,
    testedKsefCredentials: () => testedKsefCredentials,
  };
};

const ctx = {
  identity: {
    userId: 'user-1',
    email: 'owner@example.com',
    name: 'Owner',
    emailVerified: true,
    tenantId: 'tenant-1',
    tenantSlug: 'acme',
    tenantName: 'Acme',
    staffRole: 'owner' as const,
    memberId: null,
    memberBannedAt: null,
  },
};

describe('requestInvoice', () => {
  it('requires the declared invoice write capability', async () => {
    const h = harness();
    expect(await requestInvoice(
      { ...ctx, capabilities: ['invoice:read'] },
      'order-1',
      h.deps,
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

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

  it.each(['ifirma', 'ksef'] as const)('refuses incomplete exemption settings for %s', async (provider) => {
    const h = harness({ provider });
    const findSettings = h.deps.tenants.findSettings;
    h.deps.tenants.findSettings = async (tenantId) => {
      const settings = await findSettings(tenantId);
      return settings === null ? null : {
        ...settings,
        invoiceVatMode: 'exempt',
        invoiceVatRatePercent: null,
        invoiceExemptionBasisKind: null,
        invoiceExemptionBasis: null,
      };
    };
    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: false,
      error: { code: 'invoice_exemption_basis_missing' },
    });
    expect(h.calls()).toBe(0);
  });

  it('records the applied treatment and blocks a changed-treatment retry', async () => {
    const h = harness({ fail: true });
    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(false);
    expect(h.events.find((event) => event.type === 'requested')).toMatchObject({
      meta: { vat: { kind: 'rate', percent: 23 } },
    });
    const findSettings = h.deps.tenants.findSettings;
    h.deps.tenants.findSettings = async (tenantId) => {
      const settings = await findSettings(tenantId);
      return settings === null ? null : {
        ...settings,
        invoiceVatMode: 'exempt',
        invoiceVatRatePercent: null,
        invoiceExemptionBasisKind: 'art_113_1',
        invoiceExemptionBasis: 'art. 113 ust. 1',
      };
    };
    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(h.calls()).toBe(1);
  });

  it('retries an unchanged exempt treatment after object keys are reordered', async () => {
    const h = harness({ fail: true });
    const findSettings = h.deps.tenants.findSettings;
    h.deps.tenants.findSettings = async (tenantId) => {
      const current = await findSettings(tenantId);
      return current === null ? null : {
        ...current,
        invoiceVatMode: 'exempt',
        invoiceVatRatePercent: null,
        invoiceExemptionBasisKind: 'art_113_1',
        invoiceExemptionBasis: 'art. 113 ust. 1',
      };
    };
    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(false);
    const requested = h.events.find((event) => event.type === 'requested');
    if (requested !== undefined) {
      requested.meta.vat = {
        kind: 'exempt',
        basis: 'art. 113 ust. 1',
        basisKind: 'art_113_1',
      };
    }

    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable' },
    });
    expect(h.calls()).toBe(2);
  });

  it('blocks a retry when the previous request has no frozen VAT treatment', async () => {
    const h = harness({ fail: true });
    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(false);
    const requested = h.events.find((event) => event.type === 'requested');
    if (requested !== undefined) requested.meta = {};

    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(h.calls()).toBe(1);
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

  it('freezes an exempt KSeF basis into the hashed XML', async () => {
    const h = harness({ provider: 'ksef' });
    const findSettings = h.deps.tenants.findSettings;
    h.deps.tenants.findSettings = async (tenantId) => {
      const settings = await findSettings(tenantId);
      return settings === null ? null : {
        ...settings,
        invoiceVatMode: 'exempt',
        invoiceVatRatePercent: null,
        invoiceExemptionBasisKind: 'art_113_1',
        invoiceExemptionBasis: 'art. 113 ust. 1 ustawy',
      };
    };
    expect((await requestInvoice(ctx, 'order-1', h.deps)).ok).toBe(true);
    expect(h.frozenXml()).toContain('<P_19A>art. 113 ust. 1 ustawy</P_19A>');
    expect(h.events.filter((event) => event.type === 'frozen')).toHaveLength(1);
  });

  it('preserves a frozen KSeF row after the tenant switches to iFirma', async () => {
    const h = harness({ provider: 'ksef' });
    await requestInvoice(ctx, 'order-1', h.deps);
    const frozen = h.invoices[0];
    if (frozen === undefined) throw new Error('Expected a frozen invoice');
    frozen.status = 'failed';
    frozen.error = 'ksef_430';
    const findSettings = h.deps.tenants.findSettings;
    h.deps.tenants.findSettings = async (tenantId) => {
      const settings = await findSettings(tenantId);
      return settings === null ? null : { ...settings, invoicingProvider: 'ifirma' };
    };

    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: true,
      value: {
        id: frozen.id,
        provider: 'ksef',
        invoiceNumber: 'FV/2026/000001',
        status: 'failed',
      },
    });
    expect(h.calls()).toBe(0);
  });

  it('preserves a failed iFirma row after the tenant switches to KSeF', async () => {
    const h = harness({ fail: true });
    await requestInvoice(ctx, 'order-1', h.deps);
    const findSettings = h.deps.tenants.findSettings;
    h.deps.tenants.findSettings = async (tenantId) => {
      const settings = await findSettings(tenantId);
      return settings === null ? null : { ...settings, invoicingProvider: 'ksef' };
    };

    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: true,
      value: { provider: 'ifirma', status: 'failed' },
    });
    expect(h.calls()).toBe(1);
  });

  it('keeps the captured B2C identity in the frozen FA(3)', async () => {
    const h = harness({ provider: 'ksef' });
    h.deps.orderDetails.findById = async () => order({ ...billing, nip: null });

    await requestInvoice(ctx, 'order-1', h.deps);

    expect(h.frozenXml()).toContain('<BrakID>1</BrakID>');
    expect(h.frozenXml()).toContain('<Nazwa>Acme sp. z o.o.</Nazwa>');
    expect(h.frozenXml()).toContain('<AdresL1>Prosta 1, 00-001 Warszawa</AdresL1>');
  });

  it('uses the Warsaw calendar date for P_1 and the numbering year', async () => {
    const h = harness({
      provider: 'ksef',
      nowIso: '2025-12-31T23:30:00.000Z',
    });

    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({
      ok: true,
      value: {
        invoiceNumber: 'FV/2026/000001',
        ksef: { issueDate: '2026-01-01' },
      },
    });
    expect(h.allocatedYear()).toBe(2026);
    expect(h.frozenXml()).toContain('<P_1>2026-01-01</P_1>');
  });
});

describe('refreshInvoiceStatus', () => {
  it('persists forward transitions and ignores provider status regressions', async () => {
    const h = harness();
    expect(await requestInvoice(ctx, 'order-1', h.deps)).toMatchObject({ ok: true });
    let providerStatus: 'issued' | 'delivered' | 'failed' | 'conflict' = 'delivered';
    let statusCalls = 0;
    h.deps.invoicing.getInvoiceStatus = async () => {
      statusCalls += 1;
      return ok(providerStatus);
    };

    expect(await refreshInvoiceStatus(ctx, h.invoices[0]?.id ?? '', h.deps)).toMatchObject({
      ok: true,
      value: { status: 'delivered' },
    });
    expect(h.invoices[0]).toMatchObject({ status: 'delivered' });
    expect(h.events.at(-1)).toMatchObject({
      type: 'refreshed',
      meta: { status: 'delivered' },
    });

    providerStatus = 'issued';
    expect(await refreshInvoiceStatus(ctx, h.invoices[0]?.id ?? '', h.deps)).toMatchObject({
      ok: true,
      value: { status: 'delivered' },
    });
    expect(h.invoices[0]).toMatchObject({ status: 'delivered' });
    expect(statusCalls).toBe(2);

    providerStatus = 'failed';
    expect(await refreshInvoiceStatus(ctx, h.invoices[0]?.id ?? '', h.deps)).toMatchObject({
      ok: true,
      value: { status: 'failed', error: 'provider_failed' },
    });
    expect(h.invoices[0]).toMatchObject({ status: 'failed', error: 'provider_failed' });

    providerStatus = 'conflict';
    expect(await refreshInvoiceStatus(ctx, h.invoices[0]?.id ?? '', h.deps)).toMatchObject({
      ok: true,
      value: { status: 'conflict', error: null },
    });
    expect(h.invoices[0]).toMatchObject({ status: 'conflict', error: null });
    expect(statusCalls).toBe(4);
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

describe('dispatchAutoInvoiceJobs', () => {
  it('issues a persisted webhook job on a later scheduler tick', async () => {
    const h = harness({ auto: true, scope: 'all' });
    let claimed = false;
    const completed: string[] = [];
    const result = await dispatchAutoInvoiceJobs({
      ...h.deps,
      jobs: {
        enqueue: async () => true,
        claimDue: async () => {
          if (claimed) return null;
          claimed = true;
          return {
            id: 'job-1',
            tenantId: 'tenant-1',
            webhookEventId: 'event-1',
            orderId: 'order-1',
            status: 'running',
            attempts: 1,
            nextAttemptAt: now,
            lockedAt: now,
            lastError: null,
            createdAt: now,
          };
        },
        reschedule: async () => undefined,
        complete: async (_tenantId, jobId) => {
          completed.push(jobId);
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      value: { processed: true, processedCount: 1, orderId: 'order-1' },
    });
    expect(h.calls()).toBe(1);
    expect(h.invoices).toHaveLength(1);
    expect(completed).toEqual(['job-1']);
  });

  it('reschedules a job after an unexpected infrastructure rejection', async () => {
    const h = harness({ auto: true, scope: 'all' });
    h.deps.orderDetails.findById = async () => {
      throw new Error('database unavailable');
    };
    let claimed = false;
    const rescheduled: Array<{ nextAttemptAt: string; error: string }> = [];
    const result = await dispatchAutoInvoiceJobs({
      ...h.deps,
      jobs: {
        enqueue: async () => true,
        claimDue: async () => {
          if (claimed) return null;
          claimed = true;
          return {
            id: 'job-1',
            tenantId: 'tenant-1',
            webhookEventId: 'event-1',
            orderId: 'order-1',
            status: 'running',
            attempts: 1,
            nextAttemptAt: now,
            lockedAt: now,
            lastError: null,
            createdAt: now,
          };
        },
        reschedule: async (_tenantId, _jobId, input) => {
          rescheduled.push(input);
        },
        complete: async () => undefined,
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(rescheduled).toEqual([{
      nextAttemptAt: '2026-07-27T10:01:00.000Z',
      error: 'Error: database unavailable',
    }]);
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

describe('testKsefConnection', () => {
  it('runs the real token authentication bootstrap with resolved tenant credentials', async () => {
    const h = harness();
    expect(await testKsefConnection(ctx, h.deps)).toEqual({
      ok: true,
      value: { ok: true, diagnostic: 'KSeF accepted the token for this NIP context.' },
    });
    expect(h.testedKsefCredentials()).toEqual({
      tenantId: 'tenant-1',
      token: 'ksef-token',
      contextNip: '5555555555',
    });
  });

  it('allows only the tenant owner to test KSeF', async () => {
    const h = harness();
    expect(await testKsefConnection({
      identity: { ...ctx.identity, staffRole: 'admin' },
    }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(h.testedKsefCredentials()).toBeNull();
  });
});

describe('KSeF artifact downloads', () => {
  it('allows only the owning member to render an issued frozen invoice', async () => {
    const h = harness({ provider: 'ksef' });
    await requestInvoice(ctx, 'order-1', h.deps);
    const frozen = h.invoices[0];
    if (frozen?.ksef === null || frozen?.ksef === undefined || h.deps.ksef === undefined) {
      throw new Error('Expected a frozen KSeF invoice');
    }
    frozen.status = 'issued';
    frozen.ksef = {
      ...frozen.ksef,
      state: 'succeeded',
      ksefNumber: '5555555555-20260727-ABC-01',
    };
    h.deps.invoices.findByIdForMember = async (_tenantId, memberId) =>
      memberId === 'member-1' ? frozen : null;
    h.deps.ksef.artifacts.findByKey = async () => ({
      key: frozen.ksef?.xmlArtifactKey ?? '',
      tenantId: 'tenant-1',
      invoiceId: frozen.id,
      kind: 'fa3',
      content: '<Faktura/>',
      sha256: 'a'.repeat(64),
      byteSize: 11,
      createdAt: now,
    });
    h.deps.ksef.pdf = {
      render: () => new TextEncoder().encode('%PDF-1.4 own invoice'),
    };

    const memberCtx = {
      identity: { ...ctx.identity, staffRole: null, memberId: 'member-1' },
    };
    expect(await downloadMemberInvoice(memberCtx, frozen.id, h.deps)).toMatchObject({
      ok: true,
      value: { contentType: 'application/pdf', filename: 'FV_2026_000001.pdf' },
    });
    expect(await downloadMemberInvoice({
      identity: { ...memberCtx.identity, memberId: 'member-2' },
    }, frozen.id, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('downloads a hash-verified UPO for tenant staff', async () => {
    const h = harness({ provider: 'ksef' });
    await requestInvoice(ctx, 'order-1', h.deps);
    const frozen = h.invoices[0];
    if (frozen?.ksef === null || frozen?.ksef === undefined || h.deps.ksef === undefined) {
      throw new Error('Expected a frozen KSeF invoice');
    }
    frozen.ksef = {
      ...frozen.ksef,
      upoArtifactKey: `invoice/${frozen.id}/upo.xml`,
      upoSha256: 'a'.repeat(64),
    };
    h.deps.ksef.artifacts.findByKey = async () => ({
      key: frozen.ksef?.upoArtifactKey ?? '',
      tenantId: 'tenant-1',
      invoiceId: frozen.id,
      kind: 'upo',
      content: '<UPO>signed</UPO>',
      sha256: 'a'.repeat(64),
      byteSize: 17,
      createdAt: now,
    });

    expect(await downloadInvoiceUpo(ctx, frozen.id, h.deps)).toMatchObject({
      ok: true,
      value: { contentType: 'application/xml', filename: 'FV_2026_000001-UPO.xml' },
    });
  });
});
