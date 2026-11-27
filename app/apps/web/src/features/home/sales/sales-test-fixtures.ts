import type { Invoice } from '#core/domain/index.js';

export const heldInvoice = (orderId: string): Invoice => ({
  id: `invoice-${orderId}`, tenantId: 't1', orderId, status: 'requested', provider: 'ksef',
  providerInvoiceId: null, invoiceNumber: null, pdfUrl: null, error: null, issuedAt: null,
  createdAt: '2026-07-28T09:00:00.000Z',
  ksef: {
    environment: 'test', credentialMode: 'test', schemaSystemCode: 'FA (3)', schemaVersion: '1-0E',
    contextNip: '5555555555', sellerName: 'Acme', sellerAddress: 'Main Street 1',
    p2: null, invoiceType: 'VAT', issueDate: null, xmlArtifactKey: null, xmlByteSize: null,
    xmlSha256: null, state: 'held', authConfigVersion: 1, sessionReference: null,
    invoiceReference: null, ksefNumber: null, lastStatusCode: null, lastStatusDescription: null,
    lastStatusDetails: [], lastStatusExtensions: {}, lastPolledAt: null, acquisitionAt: null,
    invoicingAt: null, permanentStorageAt: null, upoArtifactKey: null, upoSha256: null,
    upoRetrievedAt: null, originalSessionReference: null, originalKsefNumber: null,
    lastTransportError: null, retryAt: null, attempt: 0, correlationChecks: 0, version: 0,
  },
});
