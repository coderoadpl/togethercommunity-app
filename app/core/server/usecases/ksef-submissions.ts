import {
  integrationUnavailable,
  type AppError,
  type Invoice,
  type KsefInvoiceData,
  type Result,
} from '@core/domain/index.js';

import type {
  Clock,
  ContentHash,
  FiscalArtifactRepository,
  IdGenerator,
  KsefClientPort,
  KsefCredentialResolver,
  KsefCredentials,
  KsefStatusResult,
  KsefSubmissionRepository,
} from '../ports.js';

export interface KsefSubmissionDeps {
  invoices: KsefSubmissionRepository;
  artifacts: FiscalArtifactRepository;
  credentials: KsefCredentialResolver;
  ksef: KsefClientPort;
  hash: ContentHash;
  ids: IdGenerator;
  clock: Clock;
  retry: {
    baseMs: number;
    capMs: number;
    jitter(): number;
  };
}

const correlationMissLimit = 3;

const nextRetryAt = (
  now: string,
  attempt: number,
  deps: KsefSubmissionDeps,
  error?: AppError,
): string => {
  const exponential = deps.retry.baseMs * 2 ** Math.min(attempt, 10);
  const bounded = Math.min(deps.retry.capMs, exponential) + deps.retry.jitter();
  const retryAfterMs = typeof error?.details === 'object' && error.details !== null
    ? Reflect.get(error.details, 'retryAfterMs')
    : null;
  const delay = typeof retryAfterMs === 'number' && retryAfterMs >= 0
    ? Math.max(bounded, retryAfterMs)
    : bounded;
  return new Date(Date.parse(now) + Math.max(0, delay)).toISOString();
};

const checkpoint = async (
  tenantId: string,
  invoice: Invoice,
  ksef: KsefInvoiceData,
  deps: KsefSubmissionDeps,
): Promise<Invoice> => {
  const next = { ...invoice, ksef: { ...ksef, version: ksef.version + 1 } };
  const eventType = ksef.state === 'session_opened'
    ? 'session_opened'
    : ksef.state === 'submitting'
      ? 'send_started'
      : ksef.state === 'succeeded'
        ? 'upo_stored'
        : ksef.state === 'numbering_conflict'
          ? 'numbering_conflict'
          : ksef.state === 'rejected'
            ? 'failed'
            : invoice.ksef?.state === 'submitting' && ksef.correlationChecks > invoice.ksef.correlationChecks
              ? 'correlated'
              : invoice.ksef?.state === 'submitting'
                ? 'submitted'
                : 'processing';
  const persisted = await deps.invoices.checkpointKsef(tenantId, next, {
    id: deps.ids.nextId(),
    tenantId,
    invoiceId: invoice.id,
    orderId: invoice.orderId,
    type: eventType,
    error: next.error,
    meta: {
      state: ksef.state,
      attempt: ksef.attempt,
      statusCode: ksef.lastStatusCode,
    },
    occurredAt: deps.clock.nowIso(),
  });
  if (persisted !== null) return persisted;
  return (await deps.invoices.findById(tenantId, invoice.id)) ?? invoice;
};

const retryTransport = async (
  tenantId: string,
  invoice: Invoice,
  ksef: KsefInvoiceData,
  error: AppError,
  deps: KsefSubmissionDeps,
): Promise<Invoice> =>
  checkpoint(tenantId, invoice, {
    ...ksef,
    lastTransportError: error.message,
    retryAt: nextRetryAt(deps.clock.nowIso(), ksef.attempt, deps, error),
  }, deps);

const originalReferences = (
  status: KsefStatusResult,
): { sessionReference: string; ksefNumber: string } | null => {
  const sessionReference = status.extensions.originalSessionReferenceNumber;
  const ksefNumber = status.extensions.originalKsefNumber;
  return typeof sessionReference === 'string' && typeof ksefNumber === 'string'
    ? { sessionReference, ksefNumber }
    : null;
};

const storeUpo = async (
  tenantId: string,
  invoice: Invoice,
  ksef: KsefInvoiceData,
  credentials: KsefCredentials,
  sessionReference: string,
  invoiceReference: string | null,
  ksefNumber: string,
  deps: KsefSubmissionDeps,
): Promise<Invoice> => {
  const downloaded = await deps.ksef.downloadUpo({
    environment: ksef.environment,
    credentials,
    sessionReference,
    invoiceReference,
    ksefNumber,
  });
  if (!downloaded.ok) return retryTransport(tenantId, invoice, ksef, downloaded.error, deps);
  const upoArtifactKey = `invoice/${invoice.id}/upo.xml`;
  const upoSha256 = deps.hash.sha256(downloaded.value);
  const stored = await deps.artifacts.store(tenantId, {
    key: upoArtifactKey,
    tenantId,
    invoiceId: invoice.id,
    kind: 'upo',
    content: downloaded.value,
    sha256: upoSha256,
    byteSize: new TextEncoder().encode(downloaded.value).byteLength,
    createdAt: deps.clock.nowIso(),
  });
  if (!stored) {
    const existing = await deps.artifacts.findByKey(tenantId, upoArtifactKey);
    if (existing === null || existing.sha256 !== upoSha256
      || deps.hash.sha256(existing.content) !== upoSha256) {
      return retryTransport(
        tenantId,
        invoice,
        ksef,
        integrationUnavailable('Stored KSeF UPO failed its integrity check'),
        deps,
      );
    }
  }
  return checkpoint(tenantId, {
    ...invoice,
    status: 'issued',
    providerInvoiceId: invoiceReference,
    invoiceNumber: ksef.p2,
    error: null,
    issuedAt: deps.clock.nowIso(),
  }, {
    ...ksef,
    state: 'succeeded',
    ksefNumber,
    upoArtifactKey,
    upoSha256,
    upoRetrievedAt: deps.clock.nowIso(),
    retryAt: null,
    lastTransportError: null,
  }, deps);
};

const handleDuplicate = async (
  tenantId: string,
  invoice: Invoice,
  ksef: KsefInvoiceData,
  credentials: KsefCredentials,
  status: KsefStatusResult,
  deps: KsefSubmissionDeps,
): Promise<Invoice> => {
  const original = originalReferences(status);
  if (original === null) {
    return checkpoint(tenantId, { ...invoice, status: 'conflict', error: 'ksef_numbering_conflict' }, {
      ...ksef,
      state: 'numbering_conflict',
    }, deps);
  }
  const verified = await deps.ksef.verifyDuplicateOriginal({
    environment: ksef.environment,
    credentials,
    originalSessionReference: original.sessionReference,
    originalKsefNumber: original.ksefNumber,
    expected: {
      contextNip: ksef.contextNip,
      invoiceType: ksef.invoiceType,
      invoiceNumber: ksef.p2,
      invoiceHashHex: ksef.xmlSha256,
    },
  });
  if (!verified.ok) return retryTransport(tenantId, invoice, ksef, verified.error, deps);
  const duplicateData = {
    ...ksef,
    originalSessionReference: original.sessionReference,
    originalKsefNumber: original.ksefNumber,
  };
  if (!verified.value) {
    return checkpoint(tenantId, { ...invoice, status: 'conflict', error: 'ksef_numbering_conflict' }, {
      ...duplicateData,
      state: 'numbering_conflict',
    }, deps);
  }
  const accepted = await checkpoint(tenantId, { ...invoice, status: 'processing' }, {
    ...duplicateData,
    state: 'awaiting_upo',
    ksefNumber: original.ksefNumber,
    retryAt: null,
    lastTransportError: null,
  }, deps);
  if (accepted.ksef?.state !== 'awaiting_upo') return accepted;
  return storeUpo(
    tenantId,
    accepted,
    accepted.ksef,
    credentials,
    original.sessionReference,
    null,
    original.ksefNumber,
    deps,
  );
};

const poll = async (
  tenantId: string,
  invoice: Invoice,
  ksef: KsefInvoiceData,
  credentials: KsefCredentials,
  deps: KsefSubmissionDeps,
): Promise<Invoice> => {
  if (ksef.sessionReference === null || ksef.invoiceReference === null) return invoice;
  const polled = await deps.ksef.getInvoiceStatus({
    environment: ksef.environment,
    credentials,
    sessionReference: ksef.sessionReference,
    invoiceReference: ksef.invoiceReference,
  });
  if (!polled.ok) return retryTransport(tenantId, invoice, ksef, polled.error, deps);
  const now = deps.clock.nowIso();
  const statusData: KsefInvoiceData = {
    ...ksef,
    lastStatusCode: polled.value.code,
    lastStatusDescription: polled.value.description,
    lastStatusDetails: polled.value.details,
    lastStatusExtensions: polled.value.extensions,
    lastPolledAt: now,
    acquisitionAt: polled.value.acquisitionAt,
    invoicingAt: polled.value.invoicingAt,
    permanentStorageAt: polled.value.permanentStorageAt,
  };
  if (polled.value.code === 200 && polled.value.ksefNumber !== null) {
    const accepted = await checkpoint(tenantId, { ...invoice, status: 'processing' }, {
      ...statusData,
      state: 'awaiting_upo',
      ksefNumber: polled.value.ksefNumber,
      retryAt: null,
      lastTransportError: null,
    }, deps);
    if (accepted.ksef?.state !== 'awaiting_upo') return accepted;
    return storeUpo(
      tenantId,
      accepted,
      accepted.ksef,
      credentials,
      ksef.sessionReference,
      ksef.invoiceReference,
      polled.value.ksefNumber,
      deps,
    );
  }
  if (polled.value.code === 440) {
    return handleDuplicate(tenantId, invoice, statusData, credentials, polled.value, deps);
  }
  if (polled.value.code >= 400) {
    return checkpoint(tenantId, { ...invoice, status: 'failed', error: `ksef_${String(polled.value.code)}` }, {
      ...statusData,
      state: 'rejected',
      retryAt: null,
    }, deps);
  }
  return checkpoint(tenantId, { ...invoice, status: 'processing' }, {
    ...statusData,
    state: 'processing',
    retryAt: nextRetryAt(now, ksef.attempt, deps),
  }, deps);
};

const correlate = async (
  tenantId: string,
  invoice: Invoice,
  ksef: KsefInvoiceData,
  credentials: KsefCredentials,
  deps: KsefSubmissionDeps,
): Promise<Invoice> => {
  if (ksef.sessionReference === null) return invoice;
  const listed = await deps.ksef.listSessionInvoices({
    environment: ksef.environment,
    credentials,
    sessionReference: ksef.sessionReference,
  });
  if (!listed.ok) return retryTransport(tenantId, invoice, ksef, listed.error, deps);
  const expectedHash = Buffer.from(ksef.xmlSha256, 'hex').toString('base64');
  const correlated = listed.value.find((candidate) => candidate.invoiceHash === expectedHash);
  if (correlated === undefined) {
    const ambiguous = {
      ...ksef,
      correlationChecks: ksef.correlationChecks + 1,
    };
    if (ambiguous.correlationChecks < correlationMissLimit) {
      return checkpoint(tenantId, invoice, {
        ...ambiguous,
        retryAt: nextRetryAt(deps.clock.nowIso(), ksef.correlationChecks, deps),
      }, deps);
    }
    const closed = await deps.ksef.closeSession({
      environment: ksef.environment,
      credentials,
      sessionReference: ksef.sessionReference,
    });
    if (!closed.ok) return retryTransport(tenantId, invoice, ambiguous, closed.error, deps);
    return checkpoint(tenantId, {
      ...invoice,
      status: 'queued',
      providerInvoiceId: null,
    }, {
      ...ambiguous,
      state: 'queued',
      sessionReference: null,
      retryAt: nextRetryAt(deps.clock.nowIso(), ksef.correlationChecks, deps),
    }, deps);
  }
  return checkpoint(tenantId, { ...invoice, status: 'processing', providerInvoiceId: correlated.invoiceReference }, {
    ...ksef,
    state: 'processing',
    invoiceReference: correlated.invoiceReference,
    correlationChecks: ksef.correlationChecks + 1,
    retryAt: null,
  }, deps);
};

export const runKsefSubmission = async (
  tenantId: string,
  invoiceId: string,
  deps: KsefSubmissionDeps,
): Promise<Result<Invoice, AppError>> => {
  let invoice = await deps.invoices.findById(tenantId, invoiceId);
  if (invoice?.ksef === null || invoice?.ksef === undefined) {
    return { ok: false, error: integrationUnavailable('KSeF invoice state is unavailable') };
  }
  if (invoice.ksef.state === 'succeeded' || invoice.ksef.state === 'rejected'
    || invoice.ksef.state === 'numbering_conflict') {
    return { ok: true, value: invoice };
  }
  const artifact = await deps.artifacts.findByKey(tenantId, invoice.ksef.xmlArtifactKey);
  if (artifact === null || artifact.sha256 !== invoice.ksef.xmlSha256
    || deps.hash.sha256(artifact.content) !== invoice.ksef.xmlSha256
    || artifact.byteSize !== invoice.ksef.xmlByteSize
    || new TextEncoder().encode(artifact.content).byteLength !== invoice.ksef.xmlByteSize) {
    return { ok: false, error: integrationUnavailable('Frozen FA(3) artifact integrity check failed') };
  }
  const resolved = await deps.credentials.resolve(tenantId);
  if (!resolved.ok) return resolved;
  const credentials = resolved.value;
  if (credentials.contextNip !== invoice.ksef.contextNip) {
    return {
      ok: false,
      error: integrationUnavailable('KSeF context NIP changed after the invoice was frozen'),
    };
  }
  let ksef = invoice.ksef;
  if (ksef.state === 'queued') {
    const opened = await deps.ksef.openSession({ environment: ksef.environment, credentials });
    if (!opened.ok) {
      invoice = await retryTransport(tenantId, invoice, ksef, opened.error, deps);
      return { ok: true, value: invoice };
    }
    ksef = { ...ksef, state: 'session_opened', sessionReference: opened.value.sessionReference };
    invoice = await checkpoint(tenantId, invoice, ksef, deps);
    ksef = invoice.ksef ?? ksef;
  }
  if (ksef.state === 'submitting') {
    invoice = await correlate(tenantId, invoice, ksef, credentials, deps);
    ksef = invoice.ksef ?? ksef;
    if (ksef.invoiceReference === null) return { ok: true, value: invoice };
  }
  if (ksef.state === 'session_opened') {
    if (ksef.sessionReference === null) {
      return { ok: false, error: integrationUnavailable('KSeF session checkpoint is unavailable') };
    }
    const sessionReference = ksef.sessionReference;
    ksef = {
      ...ksef,
      state: 'submitting',
      attempt: ksef.attempt + 1,
      retryAt: null,
      lastTransportError: null,
    };
    invoice = await checkpoint(tenantId, { ...invoice, status: 'submitting' }, ksef, deps);
    if (invoice.ksef?.state !== 'submitting' || invoice.ksef.version !== ksef.version + 1) {
      return { ok: true, value: invoice };
    }
    const submitted = await deps.ksef.submitInvoice({
      environment: ksef.environment,
      credentials,
      sessionReference,
      xml: artifact.content,
      invoiceHashHex: ksef.xmlSha256,
    });
    if (!submitted.ok) {
      invoice = await retryTransport(tenantId, invoice, ksef, submitted.error, deps);
      return { ok: true, value: invoice };
    }
    ksef = {
      ...ksef,
      state: 'processing',
      invoiceReference: submitted.value.invoiceReference,
      retryAt: null,
    };
    invoice = await checkpoint(tenantId, {
      ...invoice,
      status: 'processing',
      providerInvoiceId: submitted.value.invoiceReference,
    }, ksef, deps);
  }
  if (invoice.ksef?.state === 'processing') {
    invoice = await poll(tenantId, invoice, invoice.ksef, credentials, deps);
  } else if (invoice.ksef?.state === 'awaiting_upo' && invoice.ksef.sessionReference !== null
    && invoice.ksef.ksefNumber !== null) {
    invoice = await storeUpo(
      tenantId,
      invoice,
      invoice.ksef,
      credentials,
      invoice.ksef.originalSessionReference ?? invoice.ksef.sessionReference,
      invoice.ksef.originalSessionReference === null ? invoice.ksef.invoiceReference : null,
      invoice.ksef.ksefNumber,
      deps,
    );
  }
  return { ok: true, value: invoice };
};
