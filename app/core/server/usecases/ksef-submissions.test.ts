import { describe, expect, it } from 'vitest';

import {
  appError,
  ok,
  type FiscalArtifact,
  type Invoice,
  type KsefInvoiceData,
} from '@core/domain/index.js';

import type { KsefSubmissionDeps } from './ksef-submissions.js';
import { runKsefSubmission } from './ksef-submissions.js';
import type { KsefStatusResult } from '../ports.js';

const now = '2026-07-27T10:00:00.000Z';
const xml = '<Faktura>frozen</Faktura>\n';
const hash = 'ac9c59d1ca542032ea81818d042399cb83f81e04bfd6672374d15d8419cb999f';

const ksefData = (overrides: Partial<KsefInvoiceData> = {}): KsefInvoiceData => ({
  environment: 'test',
  schemaSystemCode: 'FA (3)',
  schemaVersion: '1-0E',
  contextNip: '5555555555',
  sellerName: 'Together',
  sellerAddress: 'Prosta 1',
  p2: 'FV/2026/000001',
  invoiceType: 'VAT',
  issueDate: '2026-07-27',
  xmlArtifactKey: 'invoice/invoice-1/fa3.xml',
  xmlByteSize: Buffer.byteLength(xml),
  xmlSha256: hash,
  state: 'queued',
  authConfigVersion: 1,
  sessionReference: null,
  invoiceReference: null,
  ksefNumber: null,
  lastStatusCode: null,
  lastStatusDescription: null,
  lastStatusDetails: [],
  lastStatusExtensions: {},
  lastPolledAt: null,
  acquisitionAt: null,
  invoicingAt: null,
  permanentStorageAt: null,
  upoArtifactKey: null,
  upoSha256: null,
  upoRetrievedAt: null,
  originalSessionReference: null,
  originalKsefNumber: null,
  lastTransportError: null,
  retryAt: null,
  attempt: 0,
  correlationChecks: 0,
  version: 0,
  ...overrides,
});

const invoice = (ksef: KsefInvoiceData = ksefData()): Invoice => ({
  id: 'invoice-1',
  tenantId: 'tenant-1',
  orderId: 'order-1',
  status: 'queued',
  provider: 'ksef',
  providerInvoiceId: null,
  invoiceNumber: ksef.p2,
  pdfUrl: null,
  error: null,
  issuedAt: null,
  createdAt: now,
  ksef,
});

const harness = (initial = invoice()) => {
  let current = structuredClone(initial);
  const artifacts: FiscalArtifact[] = [{
    key: current.ksef?.xmlArtifactKey ?? '',
    tenantId: current.tenantId,
    invoiceId: current.id,
    kind: 'fa3',
    content: xml,
    sha256: hash,
    byteSize: Buffer.byteLength(xml),
    createdAt: now,
  }];
  const calls: string[] = [];
  let submitOutcome: Awaited<ReturnType<KsefSubmissionDeps['ksef']['submitInvoice']>> =
    ok({ invoiceReference: 'invoice-ref-1' });
  let listed: Array<{
    invoiceReference: string;
    invoiceHash: string;
    status: { code: number; description: string; details: string[]; extensions: Record<string, unknown> };
  }> = [];
  let statuses: KsefStatusResult[] = [{
    code: 200,
    description: 'Sukces',
    details: [],
    extensions: {},
    ksefNumber: '5555555555-20260727-ABC-01',
    acquisitionAt: now,
    invoicingAt: now,
    permanentStorageAt: now,
  }];
  let duplicateMatch = true;
  const deps: KsefSubmissionDeps = {
    invoices: {
      findById: async () => structuredClone(current),
      checkpointKsef: async (_tenantId, next) => {
        current = structuredClone(next);
        return structuredClone(current);
      },
    },
    artifacts: {
      findByKey: async () => artifacts[0] ?? null,
      store: async (_tenantId, artifact) => {
        artifacts.push(artifact);
        return true;
      },
    },
    credentials: {
      resolve: async () => ok({
        tenantId: 'tenant-1',
        token: 'secret-token',
        contextNip: '5555555555',
      }),
    },
    ksef: {
      openSession: async () => {
        calls.push('open');
        return ok({ sessionReference: 'session-ref-1' });
      },
      submitInvoice: async () => {
        calls.push('submit');
        return submitOutcome;
      },
      listSessionInvoices: async () => {
        calls.push('list');
        return ok(listed);
      },
      getInvoiceStatus: async () => {
        calls.push('status');
        return ok(statuses.shift() ?? {
          code: 150,
          description: 'processing',
          details: [],
          extensions: {},
          ksefNumber: null,
          acquisitionAt: null,
          invoicingAt: null,
          permanentStorageAt: null,
        });
      },
      downloadUpo: async () => {
        calls.push('upo');
        return ok('<UPO>signed</UPO>');
      },
      verifyDuplicateOriginal: async () => {
        calls.push('verify-duplicate');
        return ok(duplicateMatch);
      },
      closeSession: async () => {
        calls.push('close');
        return ok(undefined);
      },
      validateCredentials: async () => ok({ diagnostic: 'ok' }),
    },
    hash: {
      sha256: () => hash,
    },
    ids: { nextId: () => 'artifact-upo-1' },
    clock: { nowIso: () => now },
    retry: { baseMs: 1000, capMs: 60_000, jitter: () => 0 },
  };
  return {
    deps,
    current: () => current,
    artifacts,
    calls,
    setSubmitOutcome: (value: typeof submitOutcome) => { submitOutcome = value; },
    setListed: (value: typeof listed) => { listed = value; },
    setStatuses: (value: typeof statuses) => { statuses = value; },
    setDuplicateMatch: (value: boolean) => { duplicateMatch = value; },
  };
};

describe('KSeF durable submission state machine', () => {
  it('freezes before send, checkpoints references, polls, and stores the UPO', async () => {
    const h = harness();

    await runKsefSubmission('tenant-1', 'invoice-1', h.deps);

    expect(h.calls).toEqual(['open', 'submit', 'status', 'upo']);
    expect(h.current()).toMatchObject({
      status: 'issued',
      providerInvoiceId: 'invoice-ref-1',
      ksef: {
        state: 'succeeded',
        sessionReference: 'session-ref-1',
        invoiceReference: 'invoice-ref-1',
        ksefNumber: '5555555555-20260727-ABC-01',
        lastStatusCode: 200,
        upoArtifactKey: 'invoice/invoice-1/upo.xml',
      },
    });
    expect(h.artifacts).toHaveLength(2);
  });

  it('correlates a lost response by the frozen invoice hash and never blindly resends', async () => {
    const h = harness(invoice(ksefData({
      state: 'submitting',
      sessionReference: 'session-ref-1',
      attempt: 1,
    })));
    h.setListed([{
      invoiceReference: 'recovered-ref',
      invoiceHash: Buffer.from(hash, 'hex').toString('base64'),
      status: { code: 150, description: 'processing', details: [], extensions: {} },
    }]);
    h.setStatuses([{
      code: 150,
      description: 'processing',
      details: [],
      extensions: {},
      ksefNumber: null,
      acquisitionAt: null,
      invoicingAt: null,
      permanentStorageAt: null,
    }]);

    await runKsefSubmission('tenant-1', 'invoice-1', h.deps);

    expect(h.calls).toEqual(['list', 'status']);
    expect(h.current()).toMatchObject({
      status: 'processing',
      ksef: { invoiceReference: 'recovered-ref', correlationChecks: 1 },
    });
  });

  it('closes an exhausted ambiguous session and resumes through a fresh session', async () => {
    const h = harness(invoice(ksefData({
      state: 'submitting',
      sessionReference: 'lost-session',
      attempt: 1,
      correlationChecks: 2,
    })));

    await runKsefSubmission('tenant-1', 'invoice-1', h.deps);

    expect(h.calls).toEqual(['list', 'close']);
    expect(h.current()).toMatchObject({
      status: 'queued',
      providerInvoiceId: null,
      ksef: {
        state: 'queued',
        sessionReference: null,
        correlationChecks: 3,
      },
    });

    await runKsefSubmission('tenant-1', 'invoice-1', h.deps);

    expect(h.calls).toEqual(['list', 'close', 'open', 'submit', 'status', 'upo']);
    expect(h.current()).toMatchObject({
      status: 'issued',
      ksef: { state: 'succeeded' },
    });
  });

  it('honors Retry-After when a send is rate limited', async () => {
    const h = harness(invoice(ksefData({
      state: 'session_opened',
      sessionReference: 'session-ref-1',
    })));
    h.setSubmitOutcome({
      ok: false,
      error: appError('rate_limited', 'slow down', { retryAfterMs: 12_000 }),
    });

    await runKsefSubmission('tenant-1', 'invoice-1', h.deps);

    expect(h.current()).toMatchObject({
      status: 'submitting',
      ksef: {
        state: 'submitting',
        retryAt: '2026-07-27T10:00:12.000Z',
        lastTransportError: 'slow down',
      },
    });
  });

  it('stops on permanent invoice validation failure', async () => {
    const h = harness(invoice(ksefData({
      state: 'processing',
      sessionReference: 'session-ref-1',
      invoiceReference: 'invoice-ref-1',
    })));
    h.setStatuses([{
      code: 430,
      description: 'Błąd weryfikacji pliku faktury',
      details: ['schema'],
      extensions: {},
      ksefNumber: null,
      acquisitionAt: null,
      invoicingAt: null,
      permanentStorageAt: null,
    }]);

    await runKsefSubmission('tenant-1', 'invoice-1', h.deps);

    expect(h.current()).toMatchObject({
      status: 'failed',
      error: 'ksef_430',
      ksef: {
        state: 'rejected',
        lastStatusDetails: ['schema'],
        retryAt: null,
      },
    });
  });

  it('adopts a provably matching 440 original', async () => {
    const h = harness(invoice(ksefData({
      state: 'processing',
      sessionReference: 'session-ref-1',
      invoiceReference: 'invoice-ref-1',
    })));
    h.setStatuses([{
      code: 440,
      description: 'Duplikat faktury',
      details: [],
      extensions: {
        originalSessionReferenceNumber: 'original-session',
        originalKsefNumber: '5555555555-20260727-ORIGINAL-01',
      },
      ksefNumber: null,
      acquisitionAt: null,
      invoicingAt: null,
      permanentStorageAt: null,
    }]);

    await runKsefSubmission('tenant-1', 'invoice-1', h.deps);

    expect(h.calls).toEqual(['status', 'verify-duplicate', 'upo']);
    expect(h.current()).toMatchObject({
      status: 'issued',
      ksef: {
        state: 'succeeded',
        ksefNumber: '5555555555-20260727-ORIGINAL-01',
        originalSessionReference: 'original-session',
      },
    });
  });

  it('marks a 440 mismatch as a hard numbering conflict', async () => {
    const h = harness(invoice(ksefData({
      state: 'processing',
      sessionReference: 'session-ref-1',
      invoiceReference: 'invoice-ref-1',
    })));
    h.setDuplicateMatch(false);
    h.setStatuses([{
      code: 440,
      description: 'Duplikat faktury',
      details: [],
      extensions: {
        originalSessionReferenceNumber: 'foreign-session',
        originalKsefNumber: '5555555555-20260727-FOREIGN-01',
      },
      ksefNumber: null,
      acquisitionAt: null,
      invoicingAt: null,
      permanentStorageAt: null,
    }]);

    await runKsefSubmission('tenant-1', 'invoice-1', h.deps);

    expect(h.current()).toMatchObject({
      status: 'conflict',
      error: 'ksef_numbering_conflict',
      ksef: { state: 'numbering_conflict' },
    });
  });
});
