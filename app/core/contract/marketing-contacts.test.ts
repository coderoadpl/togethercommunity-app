import { describe, expect, it } from 'vitest';

import { marketingDirectoryContracts, MARKETING_CONTACT_ROUTES } from './marketing-contacts.js';

describe('marketing directory contracts', () => {
  it('rejects client authority metadata and enforces attestation bounds', () => {
    const input = { importId: 'batch', validationHash: 'hash', attestation: { accepted: true, version: 'marketing-import-attestation/v1', locale: 'en', note: 'Permission evidence retained privately.' } };
    expect(marketingDirectoryContracts.commitMarketingContactImport.input.safeParse(input).success).toBe(true);
    expect(marketingDirectoryContracts.commitMarketingContactImport.input.safeParse({ ...input, attestedBy: { kind: 'user', userId: 'forged' } }).success).toBe(false);
    expect(marketingDirectoryContracts.commitMarketingContactImport.input.safeParse({ ...input, attestation: { ...input.attestation, accepted: false } }).success).toBe(false);
    expect(marketingDirectoryContracts.commitMarketingContactImport.input.safeParse({ ...input, attestation: { ...input.attestation, note: 'short' } }).success).toBe(false);
  });
  it('keeps immutable identifiers out of edits and publishes paired routes', () => {
    expect(marketingDirectoryContracts.updateMarketingList.input.safeParse({ listId: 'id', key: 'new-key', expectedRevision: 1, name: 'New name' }).success).toBe(false);
    expect(MARKETING_CONTACT_ROUTES.m2mCommitMarketingContactImport.path).toBe('/api/m2m/marketing/contact-imports/:id/commit');
    expect(marketingDirectoryContracts.appendMarketingContactImportRows.input.safeParse({ importId: 'id', offset: -1, rows: [{ email: 'test@example.test' }] }).success).toBe(false);
  });
});
