import { writeFile, unlink } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '#core/client/index.js';
import { marketingImportCountsSchema, ok, type MarketingContactImport } from '#core/domain/index.js';

import { runMarketingCsvImport } from './marketing-commands.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); process.exitCode = 0; });
const sha256 = async (content: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), (byte) => byte.toString(16).padStart(2, '0')).join('');
const batch = (status: MarketingContactImport['status'], fileSha256: string): MarketingContactImport => ({
  id: 'import-resume-preview', tenantId: 'tenant-cli', kind: 'contacts', fileName: 'contacts.csv', fileSha256, datasetVersion: 'together-marketing-contacts/v1',
  mapping: { email: 'email' }, delimiter: ',', defaults: {}, contentHash: 'content', requestHash: 'request', idempotencyKey: 'idempotency',
  rowCount: 1, consentDefinitionId: null, definitionVersion: null, definitionHash: null, validationHash: status === 'ready' ? 'validation' : null,
  attestationVersion: null, attestationText: null, attestationLocale: null, attestationNote: null, attestedBy: null, attestedAt: null,
  invalidRows: 'reject_batch', status, resultCounts: marketingImportCountsSchema.parse({}), lockedBy: null, lockedUntil: null, attempts: 0,
  nextAttemptAt: '2026-09-08T10:00:00.000Z', lastError: null, createdAt: '2026-09-08T10:00:00.000Z', startedAt: null, finishedAt: null, stagedDataPurgedAt: null,
});
describe('marketing CLI', () => {
  it('validates UTF-8 CSV and attestation before making network calls', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const api = createApiClient({ baseUrl: 'https://courses.example.org', fetchImpl });
    const file = `.contacts-cli-${crypto.randomUUID()}.csv`;
    const options = { delimiter: 'comma' as const, attest: false, dryRun: false, skipInvalid: false, wait: false };
    expect(await runMarketingCsvImport({ api, json: true }, file, options, 'contacts')).toMatchObject({ ok: false, error: { code: 'validation' } });
    await writeFile(file, new Uint8Array([0xff, 0xff]));
    try {
      expect(await runMarketingCsvImport({ api, json: true }, file, { ...options, dryRun: true }, 'contacts')).toMatchObject({ ok: false, error: { code: 'validation' } });
    } finally { await unlink(file); }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('waits for a resumed queued preview and continues through validation and commit', async () => {
    vi.useFakeTimers();
    const content = 'email\nperson@example.org\n';
    const file = `.contacts-cli-${crypto.randomUUID()}.csv`;
    const fileSha256 = await sha256(content);
    const getMarketingContactImport = vi.fn()
      .mockResolvedValueOnce(ok({ import: batch('preview_queued', fileSha256) }))
      .mockResolvedValueOnce(ok({ import: batch('previewing', fileSha256) }))
      .mockResolvedValueOnce(ok({ import: batch('ready', fileSha256) }));
    const appendMarketingContactImportRows = vi.fn().mockResolvedValue(ok({ import: batch('ready', fileSha256) }));
    const validateMarketingContactImport = vi.fn().mockResolvedValue(ok({ import: batch('ready', fileSha256), validationHash: 'validation' }));
    const commitMarketingContactImport = vi.fn().mockResolvedValue(ok({ import: batch('completed', fileSha256) }));
    const api = { ...createApiClient({ baseUrl: 'https://courses.example.org', fetchImpl: vi.fn<typeof fetch>() }), getMarketingContactImport, appendMarketingContactImportRows, validateMarketingContactImport, commitMarketingContactImport };
    await writeFile(file, content);
    try {
      const result = runMarketingCsvImport({ api, json: true }, file, { delimiter: 'comma', attest: true, attestationNote: 'Synthetic newsletter export; permission evidence retained in test records.', dryRun: false, skipInvalid: false, wait: true, resume: 'import-resume-preview' }, 'contacts');
      await vi.waitFor(() => expect(getMarketingContactImport).toHaveBeenCalledTimes(1));
      await vi.runOnlyPendingTimersAsync();
      await vi.waitFor(() => expect(getMarketingContactImport).toHaveBeenCalledTimes(2));
      await vi.runOnlyPendingTimersAsync();
      await expect(result).resolves.toMatchObject({ ok: true, value: { import: { status: 'completed' } } });
    } finally {
      await unlink(file);
    }
    expect(appendMarketingContactImportRows).toHaveBeenCalledTimes(1);
    expect(validateMarketingContactImport).toHaveBeenCalledWith({ importId: 'import-resume-preview' }, {});
    expect(commitMarketingContactImport).toHaveBeenCalledTimes(1);
  });

  it('returns a resumed queued preview immediately with no wait', async () => {
    const content = 'email\nperson@example.org\n';
    const file = `.contacts-cli-${crypto.randomUUID()}.csv`;
    const fileSha256 = await sha256(content);
    const getMarketingContactImport = vi.fn().mockResolvedValue(ok({ import: batch('preview_queued', fileSha256) }));
    const appendMarketingContactImportRows = vi.fn();
    const validateMarketingContactImport = vi.fn();
    const commitMarketingContactImport = vi.fn();
    const api = { ...createApiClient({ baseUrl: 'https://courses.example.org', fetchImpl: vi.fn<typeof fetch>() }), getMarketingContactImport, appendMarketingContactImportRows, validateMarketingContactImport, commitMarketingContactImport };
    await writeFile(file, content);
    try {
      await expect(runMarketingCsvImport({ api, json: true }, file, { delimiter: 'comma', attest: false, dryRun: true, skipInvalid: false, wait: false, resume: 'import-resume-preview' }, 'contacts')).resolves.toMatchObject({ ok: true, value: { import: { status: 'preview_queued' } } });
    } finally {
      await unlink(file);
    }
    expect(getMarketingContactImport).toHaveBeenCalledTimes(1);
    expect(appendMarketingContactImportRows).not.toHaveBeenCalled();
    expect(validateMarketingContactImport).not.toHaveBeenCalled();
    expect(commitMarketingContactImport).not.toHaveBeenCalled();
  });
});
