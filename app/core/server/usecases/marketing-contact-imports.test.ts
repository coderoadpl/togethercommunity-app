import { describe, expect, it } from 'vitest';

import { marketingContactCtx, marketingContactDeps } from '../testing/marketing-contact-fakes.js';
import { createMarketingContactImport, appendMarketingContactImportRows, commitMarketingContactImport } from './marketing-contact-imports.js';

describe('import use-case boundaries', () => {
  it('requires import and contact write as a conjunction', async () => {
    expect(await createMarketingContactImport({ ...marketingContactCtx(), capabilities: ['marketing:import:write'] }, { datasetVersion: 'together-marketing-contacts/v1', kind: 'contacts', fileName: 'contacts.csv', rowCount: 1, idempotencyKey: 'key' }, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
  it('rejects oversized JSON chunks and client-supplied attestation actors', async () => {
    expect(await appendMarketingContactImportRows(marketingContactCtx(), { importId: 'id', offset: 0, rows: Array.from({ length: 201 }, () => ({ email: 'test@example.test' })) }, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await commitMarketingContactImport(marketingContactCtx(), { importId: 'id', validationHash: 'hash', attestedBy: 'forged' }, { ...marketingContactDeps(), actor: { kind: 'user', userId: 'real' } })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
