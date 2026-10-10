import { describe, expect, it } from 'vitest';

import { ok, type Invoice, type KsefInvoiceData } from '#core/domain/index.js';

import type { DispatchKsefJobDeps } from './dispatch-ksef-job.js';
import { dispatchKsefJob } from './dispatch-ksef-job.js';

const now = '2026-07-27T10:00:00.000Z';

const succeededKsef = (invoiceId: string): KsefInvoiceData => ({
  environment: 'test',
  schemaSystemCode: 'FA (3)',
  schemaVersion: '1-0E',
  contextNip: '5555555555',
  sellerName: 'Together',
  sellerAddress: 'Prosta 1',
  p2: `FV/2026/${invoiceId}`,
  invoiceType: 'VAT',
  issueDate: '2026-07-27',
  xmlArtifactKey: `invoice/${invoiceId}/fa3.xml`,
  xmlByteSize: 1,
  xmlSha256: 'a'.repeat(64),
  state: 'succeeded',
  authConfigVersion: 1,
  sessionReference: 'session-1',
  invoiceReference: `reference-${invoiceId}`,
  ksefNumber: `ksef-${invoiceId}`,
  lastStatusCode: 200,
  lastStatusDescription: 'Sukces',
  lastStatusDetails: [],
  lastStatusExtensions: {},
  lastPolledAt: now,
  acquisitionAt: now,
  invoicingAt: now,
  permanentStorageAt: now,
  upoArtifactKey: `invoice/${invoiceId}/upo.xml`,
  upoSha256: 'b'.repeat(64),
  upoRetrievedAt: now,
  originalSessionReference: null,
  originalKsefNumber: null,
  lastTransportError: null,
  retryAt: null,
  attempt: 1,
  correlationChecks: 0,
  version: 1,
});

const succeededInvoice = (invoiceId: string): Invoice => ({
  id: invoiceId,
  tenantId: 'tenant-1',
  orderId: `order-${invoiceId}`,
  status: 'issued',
  provider: 'ksef',
  providerInvoiceId: `reference-${invoiceId}`,
  invoiceNumber: `FV/2026/${invoiceId}`,
  pdfUrl: null,
  error: null,
  issuedAt: now,
  createdAt: now,
  ksef: succeededKsef(invoiceId),
});

describe('dispatchKsefJob', () => {
  it.each(['succeeded', 'held'] as const)('drains %s jobs without submitting them', async (state) => {
    const due = ['invoice-1', 'invoice-2', 'invoice-3'];
    const completed: string[] = [];
    let claims = 0;
    const deps: DispatchKsefJobDeps = {
      jobs: {
        claimDue: async () => {
          claims += 1;
          const invoiceId = due.shift();
          return invoiceId === undefined
            ? null
            : {
                id: `job-${invoiceId}`,
                tenantId: 'tenant-1',
                invoiceId,
                status: 'running',
                attempts: 1,
                nextAttemptAt: now,
                lockedAt: now,
                lastError: null,
                createdAt: now,
              };
        },
        complete: async (_tenantId, jobId) => {
          completed.push(jobId);
        },
        reschedule: async () => undefined,
      },
      invoices: {
        findById: async (_tenantId, invoiceId) => state === 'succeeded' ? succeededInvoice(invoiceId) : {
          ...succeededInvoice(invoiceId), status: 'requested', invoiceNumber: null,
          ksef: { ...succeededKsef(invoiceId), state: 'held', p2: null, issueDate: null,
            xmlArtifactKey: null, xmlByteSize: null, xmlSha256: null },
        },
        checkpointKsef: async () => null,
      },
      artifacts: {
        findByKey: async () => null,
        store: async () => true,
      },
      credentials: {
        resolve: async (_tenantId, mode = 'live') => ok({
          tenantId: 'tenant-1',
          credentialSlot: mode,
          token: 'token',
          contextNip: '5555555555',
        }),
      },
      ksef: {
        validateCredentials: async () => ok({ diagnostic: 'ok' }),
        openSession: async () => { throw new Error('Terminal and held invoices must not open a session'); },
        submitInvoice: async () => ok({ invoiceReference: 'invoice-1' }),
        listSessionInvoices: async () => ok([]),
        getInvoiceStatus: async () => ok({
          code: 200,
          description: 'Sukces',
          details: [],
          extensions: {},
          ksefNumber: 'ksef-1',
          acquisitionAt: now,
          invoicingAt: now,
          permanentStorageAt: now,
        }),
        downloadUpo: async () => ok('<UPO/>'),
        verifyDuplicateOriginal: async () => ok(true),
        closeSession: async () => ok(undefined),
      },
      hash: { sha256: () => 'a'.repeat(64) },
      ids: { nextId: () => 'id-1' },
      clock: { nowIso: () => now },
      retry: { baseMs: 1000, capMs: 60_000, jitter: () => 0 },
    };

    expect(await dispatchKsefJob(deps)).toMatchObject({
      ok: true,
      value: { processed: true, invoiceId: 'invoice-3', processedCount: 3 },
    });
    expect(completed).toEqual(['job-invoice-1', 'job-invoice-2', 'job-invoice-3']);
    expect(claims).toBe(4);
  });
});
