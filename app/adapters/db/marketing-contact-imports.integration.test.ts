import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MARKETING_IMPORT_ATTESTATION_VERSION, marketingImportCountsSchema, type MarketingImportRow } from '#core/domain/index.js';
import { appendMarketingContactImportRows, commitMarketingContactImport, createMarketingContactImport, processMarketingContactImport, getMarketingContactImportRows, retryMarketingContactImport, uploadMarketingContactImport, validateMarketingContactImport } from '#core/server/index.js';

import { createDirectoryFixture, directoryCtx, directoryWorkerCtx, directoryValue, DIRECTORY_NOW } from './marketing-contact-test-fixture.js';
import { members, user } from './schema.js';

let fixture: Awaited<ReturnType<typeof createDirectoryFixture>>;
beforeAll(async () => { fixture = await createDirectoryFixture(); }, 60_000);
afterAll(async () => { await fixture?.close(); });
const attest = (importId: string, validationHash: string) => ({ importId, validationHash, attestation: { accepted: true, version: MARKETING_IMPORT_ATTESTATION_VERSION, locale: 'en', note: 'Synthetic newsletter export; permission evidence retained in test records.' } });
const stage = async (key: string, rows: MarketingImportRow[], consentDefinitionId: string | null = 'newsletter', kind = 'contacts') => {
  const metadata = { datasetVersion: 'together-marketing-contacts/v1', kind, fileName: 'contacts.csv', rowCount: rows.length, consentDefinitionId, idempotencyKey: key };
  const batch = directoryValue(await createMarketingContactImport(directoryCtx(), metadata, fixture.deps)).import;
  directoryValue(await appendMarketingContactImportRows(directoryCtx(), { importId: batch.id, offset: 0, rows }, fixture.deps));
  const preview = directoryValue(await validateMarketingContactImport(directoryCtx(), { importId: batch.id }, fixture.deps));
  return { batch, preview, metadata };
};
const commit = async (importId: string, hash: string) => directoryValue(await commitMarketingContactImport(directoryCtx(), attest(importId, hash), { ...fixture.deps, actor: { kind: 'api_key', apiKeyId: 'actual-marketing-key' } }));
const processBatch = async (importId: string, maxRows = 200) => directoryValue(await processMarketingContactImport(directoryWorkerCtx(), { importId, workerId: crypto.randomUUID(), maxRows, deadlineAt: '2026-09-08T10:01:00.000Z' }, fixture.deps));

describe('durable contact imports', () => {
  it('stages without side effects, merges duplicates, resumes receipts and reuses consent', async () => {
    const rows = [{ email: ' Anna@Example.Test ', firstName: 'Anna', lastName: 'Example', tags: ['news'], lists: ['news'], consentAt: '2024-05-06T14:00:00+02:00' }, { email: 'anna@example.test', name: 'Anna Updated', tags: ['launch'], lists: ['launch'] }];
    const staged = await stage('first', rows);
    expect(staged.preview.counts).toMatchObject({ validRows: 1, duplicateRows: 1 });
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'anna@example.test')).toBeNull();
    expect(directoryValue(await createMarketingContactImport(directoryCtx(), staged.metadata, fixture.deps)).import.id).toBe(staged.batch.id);
    expect(await createMarketingContactImport(directoryCtx(), { ...staged.metadata, rowCount: 3 }, fixture.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await appendMarketingContactImportRows(directoryCtx(), { importId: staged.batch.id, offset: 0, rows: [{ email: 'changed@example.test' }] }, fixture.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    await commit(staged.batch.id, staged.preview.validationHash);
    expect((await processBatch(staged.batch.id, 1)).processed).toBe(1);
    const done = await processBatch(staged.batch.id);
    expect(done.import.status).toBe('completed');
    expect(done.import.resultCounts).toMatchObject({ created: 1, duplicateRows: 1, membershipsAdded: 2, listsCreated: 2, consentsRecorded: 1 });
    expect(done.import.attestedBy).toEqual({ kind: 'api_key', apiKeyId: 'actual-marketing-key' });
    expect((await fixture.deps.contacts.findByEmail('directory-a', 'anna@example.test'))).toMatchObject({ firstName: 'Anna', lastName: 'Example', displayName: 'Anna Updated', tags: ['news', 'launch'], memberId: null });
    expect(await fixture.db.select().from(members)).toHaveLength(0);
    expect(await fixture.db.select().from(user)).toHaveLength(0);
    expect((await fixture.deps.consents.listByEmail('directory-a', 'anna@example.test', 'newsletter'))[0]?.evidence).toMatchObject({ originalCollectedAt: '2024-05-06T12:00:00.000Z', collectedAtBasis: 'source_timestamp' });
    const replay = await stage('different-batch', rows);
    await commit(replay.batch.id, replay.preview.validationHash);
    expect((await processBatch(replay.batch.id)).import.resultCounts).toMatchObject({ unchanged: 1, duplicateRows: 1, consentsRecorded: 0, consentsPreserved: 1, membershipsAdded: 0 });
    expect((await processBatch(staged.batch.id)).processed).toBe(0);
    expect(await fixture.deps.imports.findById('directory-b', staged.batch.id)).toBeNull();
  });
  it('preserves suppression timestamps, escalation and withdrawals', async () => {
    for (const reason of ['bounce', 'complaint'] as const) {
      const staged = await stage(reason, [{ email: 'blocked@example.test', reason, at: '2025-02-03T10:00:00Z' }], null, 'suppressions');
      await commit(staged.batch.id, staged.preview.validationHash);
      await processBatch(staged.batch.id);
    }
    const blocked = await fixture.deps.suppressions.findActive('directory-a', fixture.deps.hmac.compute('directory-a', 'blocked@example.test'));
    expect(blocked).toMatchObject({ reason: 'complaint', createdAt: '2025-02-03T10:00:00.000Z' });
    const consent = (await fixture.deps.consents.listByEmail('directory-a', 'anna@example.test', 'newsletter'))[0];
    if (consent === undefined) throw new Error('Expected previous consent');
    await fixture.deps.consents.record('directory-a', { ...consent, id: crypto.randomUUID(), status: 'withdrawn', previousId: consent.id, occurredAt: '2026-09-08T10:00:01.000Z' });
    const staged = await stage('blocked-consent', [{ email: 'blocked@example.test' }, { email: 'anna@example.test' }]);
    await commit(staged.batch.id, staged.preview.validationHash);
    const done = await processBatch(staged.batch.id);
    expect(done.import.resultCounts).toMatchObject({ consentBlockedBySuppression: 1, consentBlockedByWithdrawal: 1, consentsRecorded: 0 });
  });
  it('requires current validation, attestation and consistent historical evidence', async () => {
    const staged = await stage('conflicting-evidence', [{ email: 'conflict@example.test', consentSource: 'form-one' }, { email: 'conflict@example.test', consentSource: 'form-two' }]);
    expect(staged.preview.canCommit).toBe(false);
    expect(await commitMarketingContactImport(directoryCtx(), { ...attest(staged.batch.id, staged.preview.validationHash), invalidRows: 'skip_invalid' }, { ...fixture.deps, actor: { kind: 'user', userId: 'owner' } })).toMatchObject({ ok: false, error: { code: 'validation' } });
    const valid = await stage('definition-change', [{ email: 'new@example.test' }]);
    expect(await commitMarketingContactImport(directoryCtx(), attest(valid.batch.id, 'stale'), { ...fixture.deps, actor: { kind: 'user', userId: 'owner' } })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const definition = await fixture.deps.definitions.findById('directory-a', 'newsletter');
    if (definition === null) throw new Error('Expected definition');
    await fixture.deps.definitions.update('directory-a', { ...definition, updatedAt: '2026-09-08T10:00:01.000Z' });
    expect(await commitMarketingContactImport(directoryCtx(), attest(valid.batch.id, valid.preview.validationHash), { ...fixture.deps, actor: { kind: 'user', userId: 'owner' } })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    await fixture.deps.definitions.update('directory-a', { ...definition, doubleOptIn: true });
    expect(await createMarketingContactImport(directoryCtx(), { ...valid.metadata, idempotencyKey: 'doi' }, fixture.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    await fixture.deps.definitions.update('directory-a', definition);
  });
  it('preserves every suppression signal for repeated addresses within a batch', async () => {
    const staged = await stage('suppression-signals', [
      { email: 'complaint-first@example.test', reason: 'complaint', at: '2025-02-03T10:00:00Z' },
      { email: 'complaint-first@example.test', reason: 'bounce', at: '2025-02-04T10:00:00Z' },
      { email: 'complaint-last@example.test', reason: 'bounce', at: '2025-02-03T10:00:00Z' },
      { email: 'complaint-last@example.test', reason: 'complaint', at: '2025-02-04T10:00:00Z' },
      { email: 'complaint-last@example.test', reason: 'manual', at: '2025-02-05T10:00:00Z' },
    ], null, 'suppressions');
    expect(staged.preview.counts).toMatchObject({ validRows: 5, duplicateRows: 0 });
    await commit(staged.batch.id, staged.preview.validationHash);
    expect((await processBatch(staged.batch.id)).import.status).toBe('completed');
    for (const email of ['complaint-first@example.test', 'complaint-last@example.test']) {
      expect(await fixture.deps.suppressions.findActive('directory-a', fixture.deps.hmac.compute('directory-a', email))).toMatchObject({ reason: 'complaint' });
    }
    expect((await fixture.deps.imports.rows('directory-a', staged.batch.id)).every((row) => row.processedAt !== null && row.suppressionId !== null)).toBe(true);
  });
  it('retains explicit legacy suppression defaults and rejects future dates', async () => {
    const result = directoryValue(await uploadMarketingContactImport(directoryCtx(), { csv: 'email\nlegacy@example.test\n', metadata: { datasetVersion: 'together-marketing-contacts/v1', kind: 'suppressions', fileName: 'legacy.csv', defaults: { reason: 'manual', at: '2025-02-03T10:00:00Z' }, idempotencyKey: 'legacy' } }, fixture.deps));
    expect(result.import.defaults).toEqual({ reason: 'manual', at: '2025-02-03T10:00:00.000Z' });
    const invalid = await stage('future', [{ email: 'future@example.test', consentAt: '2099-01-01T00:00:00Z' }]);
    expect(invalid.preview.canCommit).toBe(false);
  });
  it('rolls back row effects on receipt failure and resumes after lease expiry', async () => {
    const staged = await stage('receipt-failure', [{ email: 'atomic@example.test', lists: ['atomic-list'] }]);
    await commit(staged.batch.id, staged.preview.validationHash);
    const failing = { ...fixture.deps, transaction: {
      run: <T>(tenantId: string, operation: Parameters<typeof fixture.deps.transaction.run<T>>[1]) => fixture.deps.transaction.run(tenantId, async (repos) => {
        repos.imports.saveRow = async () => { throw new Error('Injected receipt failure'); };
        return operation(repos);
      }),
    } };
    await expect(processMarketingContactImport(directoryWorkerCtx(), { importId: staged.batch.id, workerId: 'interrupted', maxRows: 1, deadlineAt: '2026-09-08T10:01:00.000Z' }, failing)).rejects.toThrow('Injected receipt failure');
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'atomic@example.test')).toBeNull();
    expect(await fixture.deps.lists.findByKey('directory-a', 'atomic-list')).toBeNull();
    expect(await fixture.deps.consents.listByEmail('directory-a', 'atomic@example.test')).toHaveLength(0);
    fixture.setNow('2026-09-08T10:00:31.000Z');
    expect((await processBatch(staged.batch.id)).import.resultCounts).toMatchObject({ created: 1, consentsRecorded: 1 });
    fixture.setNow(DIRECTORY_NOW);
  });
  it('skips explicitly rejected rows while preserving the row-count equation', async () => {
    const staged = await stage('skip-invalid', [{ email: 'bad-address' }, { email: 'valid-skip@example.test' }], null);
    directoryValue(await commitMarketingContactImport(directoryCtx(), { ...attest(staged.batch.id, staged.preview.validationHash), invalidRows: 'skip_invalid' }, { ...fixture.deps, actor: { kind: 'user', userId: 'owner' } }));
    const done = await processBatch(staged.batch.id);
    expect(done.import.status).toBe('completed_with_errors');
    expect(done.import.resultCounts).toMatchObject({ created: 1, rejectedRows: 1 });
  });
  it('processes bounded receipts and keeps incremental counts through interruption and replay', async () => {
    const staged = await stage('bounded-worker', Array.from({ length: 24 }, (_, index) => ({ email: `bounded-${index}@example.test`, lists: ['bounded-list'] })), null);
    await commit(staged.batch.id, staged.preview.validationHash);
    const fetched: number[] = [];
    const bounded = { ...fixture.deps, transaction: {
      run: <T>(tenantId: string, operation: Parameters<typeof fixture.deps.transaction.run<T>>[1]) => fixture.deps.transaction.run(tenantId, async (repos) => {
        const nextRow = repos.imports.nextRow;
        repos.imports.rows = async () => { throw new Error('Worker must not load the entire batch'); };
        repos.imports.nextRow = async (scope, importId) => {
          const row = await nextRow(scope, importId);
          if (row !== null) fetched.push(row.rowNumber);
          return row;
        };
        return operation(repos);
      }),
    } };
    const run = async (maxRows: number) => directoryValue(await processMarketingContactImport(directoryWorkerCtx(), { importId: staged.batch.id, workerId: 'bounded', maxRows, deadlineAt: '2026-09-08T10:01:00.000Z' }, bounded));
    expect((await run(7)).import.resultCounts).toMatchObject({ created: 7, membershipsAdded: 7, listsCreated: 1 });
    const done = await run(30);
    expect(done.import).toMatchObject({ status: 'completed', resultCounts: { created: 24, membershipsAdded: 24, listsCreated: 1 } });
    expect(fetched).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(await run(30)).toMatchObject({ processed: 0, import: { resultCounts: done.import.resultCounts } });
    const receipts = await fixture.deps.imports.rows('directory-a', staged.batch.id);
    for (const key of marketingImportCountsSchema.keyof().options) {
      expect(receipts.reduce((sum, row) => sum + row.counts[key], 0)).toBe(done.import.resultCounts[key]);
    }
  });
  it('pages receipts and checks list authorization on retry without loading every payload', async () => {
    const staged = await stage('bounded-requests', [{ email: 'page-one@example.test' }, { email: 'page-two@example.test', lists: ['paged-list'] }, { email: 'page-three@example.test' }], null);
    const noFullRead = async (): Promise<never> => { throw new Error('Request must not load the entire batch'); };
    const bounded = { ...fixture.deps, imports: { ...fixture.deps.imports, rows: noFullRead }, transaction: {
      run: <T>(tenantId: string, operation: Parameters<typeof fixture.deps.transaction.run<T>>[1]) => fixture.deps.transaction.run(tenantId, async (repos) => {
        repos.imports.rows = noFullRead;
        return operation(repos);
      }),
    } };
    expect(directoryValue(await getMarketingContactImportRows(directoryCtx(), { importId: staged.batch.id, offset: 0, limit: 2 }, bounded))).toMatchObject({ rows: [{ rowNumber: 1 }, { rowNumber: 2 }], nextOffset: 2 });
    expect(directoryValue(await getMarketingContactImportRows(directoryCtx(), { importId: staged.batch.id, offset: 2, limit: 2 }, bounded))).toMatchObject({ rows: [{ rowNumber: 3 }], nextOffset: null });
    expect(directoryValue(await getMarketingContactImportRows(directoryCtx(), { importId: staged.batch.id, offset: 3, limit: 2 }, bounded))).toEqual({ rows: [], nextOffset: null });
    expect(await fixture.deps.imports.nextRow('directory-b', staged.batch.id)).toBeNull();
    expect(await fixture.deps.imports.rowsPage('directory-b', staged.batch.id, 0, 2)).toEqual([]);
    expect(await fixture.deps.imports.hasLists('directory-b', staged.batch.id)).toBe(false);
    await commit(staged.batch.id, staged.preview.validationHash);
    const batch = await fixture.deps.imports.findById('directory-a', staged.batch.id);
    if (batch === null) throw new Error('Expected import');
    await fixture.deps.imports.save('directory-a', { ...batch, status: 'failed' });
    expect(await retryMarketingContactImport({ ...directoryCtx(), capabilities: ['marketing:import:write', 'marketing:contact:write'] }, { importId: staged.batch.id }, bounded)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(directoryValue(await retryMarketingContactImport(directoryCtx(), { importId: staged.batch.id }, bounded)).import.status).toBe('queued');
  });
  it('expires uncommitted staging and retains durable receipts after payload purge', async () => {
    fixture.setNow('2026-10-10T10:00:00.000Z');
    expect(await fixture.deps.imports.purgeStaging('directory-a', fixture.deps.clock.nowIso())).toBeGreaterThan(0);
    const batch = await fixture.deps.imports.findByKey('directory-a', 'first');
    expect(batch?.attestedAt).toBe(DIRECTORY_NOW);
    const rows = await fixture.deps.imports.rows('directory-a', batch?.id ?? '');
    expect(rows[0]).toMatchObject({ stagedPayload: null, normalizedPayload: null, outcome: 'created' });
    expect(rows[0]?.normalizedEmailHmac).toBeTruthy();
  });
});
