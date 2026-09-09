import {
  parseMarketingImportCsv, mapMarketingImportCsv, marketingImportUploadSchema, marketingImportRemapSchema,
  err, ok, appError, notFound, validation, deriveConsentState,
  marketingImportCreateSchema, marketingImportAppendSchema, marketingImportCommitSchema, marketingImportRowSchema,
  marketingImportCountsSchema, marketingCanonicalJson, MARKETING_IMPORT_LIMITS, MARKETING_IMPORT_ATTESTATION_TEXT, MARKETING_DIRECTORY_ATTESTATION_TEXT,
  type AppError, type Result, type MarketingContactImport, type MarketingImportValidation, type MarketingImportRowReceipt,
  type MarketingImportRow, type MarketingImportCounts, type ImportActor, type Capability,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type { MarketingImportDeps, MarketingImportTransactionRepos } from '../marketing-contact-ports.js';

const conflict = (message: string) => err(appError('conflict', message));
const authorizeImport = (ctx: Ctx, batch: Pick<MarketingContactImport, 'kind' | 'consentDefinitionId'>, hasLists: boolean, read = false): Result<string, AppError> => {
  const capabilities: Capability[] = ['marketing:import:write', batch.kind === 'contacts' ? read ? 'marketing:contact:read' : 'marketing:contact:write' : read ? 'marketing:suppression:read' : 'marketing:suppression:write'];
  if (hasLists) capabilities.push(read ? 'marketing:list:read' : 'marketing:list:write');
  if (batch.consentDefinitionId !== null) capabilities.push(read ? 'marketing:consent:read' : 'marketing:consent:write');
  for (const capability of capabilities) { const result = authorizeRequiredTenant(ctx, capability); if (!result.ok) return result; }
  return authorizeRequiredTenant(ctx, 'marketing:import:write');
};
const importEvent = async (tenantId: string, batch: MarketingContactImport, type: 'import_validated' | 'import_attested' | 'import_started' | 'import_completed' | 'import_failed' | 'import_cancelled' | 'import_retried', repos: MarketingImportTransactionRepos, deps: MarketingImportDeps, actor = 'import_worker') => {
  await repos.directoryEvents.append(tenantId, { id: deps.ids.nextId(), tenantId, subjectKind: 'import', subjectId: batch.id, type, actor, importId: batch.id, payload: { status: batch.status, contentHash: batch.contentHash }, occurredAt: deps.clock.nowIso(), createdAt: deps.clock.nowIso() });
};
const definitionSnapshot = async (tenantId: string, batch: MarketingContactImport, repos: MarketingImportTransactionRepos, deps: MarketingImportDeps) => {
  if (batch.consentDefinitionId === null) return ok(null);
  const definition = await repos.definitions.findById(tenantId, batch.consentDefinitionId);
  if (definition === null || definition.status !== 'active' || definition.kind !== 'optional_marketing') return err(validation('Select an active optional marketing consent definition'));
  if (definition.doubleOptIn) return err(validation('Consent import requires single opt-in; use contacts-only import for double opt-in definitions'));
  const version = (await repos.definitions.listVersions(tenantId, definition.id)).at(-1);
  if (version === undefined) return err(validation('Consent definition has no published wording version'));
  return ok({ definition, version, hash: deps.contentHash.sha256(marketingCanonicalJson({ definition, version })) });
};
export const createMarketingContactImport = async (ctx: Ctx, input: unknown, deps: MarketingImportDeps): Promise<Result<{ import: MarketingContactImport }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingImportCreateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid import metadata', parsed.error.flatten()));
  const allowed = authorizeImport(ctx, parsed.data, false);
  if (!allowed.ok) return allowed;
  return deps.transaction.run(tenant.value, async (repos) => {
    await repos.imports.lock(tenant.value, `key:${parsed.data.idempotencyKey}`);
    const requestHash = deps.contentHash.sha256(marketingCanonicalJson(parsed.data));
    const existing = await repos.imports.findByKey(tenant.value, parsed.data.idempotencyKey);
    if (existing !== null) return existing.requestHash === requestHash ? ok({ import: existing }) : conflict('Idempotency key was used with different metadata');
    const now = deps.clock.nowIso();
    const batch: MarketingContactImport = {
      ...parsed.data, id: deps.ids.nextId(), tenantId: tenant.value, requestHash, contentHash: requestHash,
      definitionVersion: null, definitionHash: null, validationHash: null, attestationVersion: null, attestationText: null, attestationLocale: null,
      attestationNote: null, attestedBy: null, attestedAt: null, invalidRows: 'reject_batch', status: 'draft', resultCounts: marketingImportCountsSchema.parse({}),
      lockedBy: null, lockedUntil: null, attempts: 0, nextAttemptAt: now, lastError: null, createdAt: now, startedAt: null, finishedAt: null, stagedDataPurgedAt: null,
    };
    const definition = await definitionSnapshot(tenant.value, batch, repos, deps);
    if (!definition.ok) return definition;
    await repos.imports.save(tenant.value, batch);
    return ok({ import: batch });
  });
};
export const appendMarketingContactImportRows = async (ctx: Ctx, input: unknown, deps: MarketingImportDeps): Promise<Result<{ import: MarketingContactImport }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingImportAppendSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid import chunk', parsed.error.flatten()));
  if (new TextEncoder().encode(marketingCanonicalJson(parsed.data)).length > MARKETING_IMPORT_LIMITS.chunkBytes) return err(validation('JSON chunk exceeds 1 MiB'));
  return deps.transaction.run(tenant.value, async (repos) => {
    await repos.imports.lock(tenant.value, parsed.data.importId);
    const batch = await repos.imports.findById(tenant.value, parsed.data.importId);
    if (batch === null) return err(notFound('Import was not found'));
    const allowed = authorizeImport(ctx, batch, parsed.data.rows.some((row) => Array.isArray(row['lists']) && row['lists'].length > 0));
    if (!allowed.ok) return allowed;
    if (parsed.data.offset + parsed.data.rows.length > batch.rowCount) return err(validation('Chunk exceeds declared row count'));
    const existing = await repos.imports.rows(tenant.value, batch.id);
    let changed = false;
    for (const [index, payload] of parsed.data.rows.entries()) {
      const canonical = marketingCanonicalJson(payload);
      if (new TextEncoder().encode(canonical).length > MARKETING_IMPORT_LIMITS.rowBytes) return err(validation('Staged row exceeds 16 KiB'));
      const rowNumber = parsed.data.offset + index + 1;
      const rowHash = deps.contentHash.sha256(canonical);
      const previous = existing.find((row) => row.rowNumber === rowNumber);
      if (previous !== undefined) { if (previous.rowHash !== rowHash) return conflict('Row number already contains different content'); continue; }
      if (batch.status !== 'draft' && batch.status !== 'ready') return conflict('Import no longer accepts new rows');
      await repos.imports.saveRow(tenant.value, {
        tenantId: tenant.value, importId: batch.id, rowNumber, rowHash, normalizedEmailHmac: null, stagedPayload: payload, normalizedPayload: null,
        status: 'staged', duplicateOf: null, contactId: null, consentRowId: null, suppressionId: null, outcome: null, errors: [], warnings: [], counts: marketingImportCountsSchema.parse({}), processedAt: null,
      });
      changed = true;
    }
    if (changed) { batch.status = 'draft'; batch.validationHash = null; await repos.imports.save(tenant.value, batch); }
    return ok({ import: batch });
  });
};
const normalizeRow = (payload: Record<string, unknown>, batch: MarketingContactImport, now: string): Result<MarketingImportRow, AppError> => {
  const nonempty = Object.fromEntries(Object.entries(payload).filter(([key, value]) => key === 'email' || (value !== '' && value !== null)));
  const parsed = marketingImportRowSchema.safeParse({ ...batch.defaults, ...nonempty });
  if (!parsed.success) return err(validation('Invalid row: ' + parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')));
  if ((parsed.data.consentAt !== undefined && parsed.data.consentAt > now) || (parsed.data.at !== undefined && parsed.data.at > now)) return err(validation('Future evidence timestamps are not allowed'));
  if (batch.kind === 'suppressions' && (parsed.data.reason === undefined || parsed.data.at === undefined)) return err(validation('Suppression reason and at are required'));
  if (batch.kind === 'contacts' && (parsed.data.reason !== undefined || parsed.data.at !== undefined)) return err(validation('Suppression fields cannot appear in a contact row'));
  if (batch.kind === 'suppressions' && Object.keys(nonempty).some((key) => !['email', 'reason', 'at'].includes(key))) return err(validation('Suppression rows only accept email, reason and at'));
  return ok(parsed.data);
};
const mergeDuplicate = (first: MarketingImportRowReceipt, next: MarketingImportRowReceipt, consent: boolean) => {
  if (first.normalizedPayload === null || next.normalizedPayload === null) return;
  const a = first.normalizedPayload;
  const b = next.normalizedPayload;
  for (const field of ['name', 'firstName', 'lastName', 'source', 'consentAt', 'consentSource', 'reason', 'at'] as const) {
    const previous = a[field];
    const incoming = b[field];
    if (previous && incoming && previous !== incoming) {
      next.warnings.push(`Conflicting ${field}; last non-empty value is used`);
      if (consent && (field === 'consentAt' || field === 'consentSource')) next.errors.push(`Conflicting ${field} requires correction before consent import`);
    }
  }
  first.normalizedPayload = { ...a, ...Object.fromEntries(Object.entries(b).filter(([, value]) => value !== '')), tags: [...new Set([...(a.tags ?? []), ...(b.tags ?? [])])], lists: [...new Set([...(a.lists ?? []), ...(b.lists ?? [])])] };
  next.duplicateOf = first.rowNumber;
  next.status = 'duplicate';
};
export const validateMarketingContactImport = async (ctx: Ctx, input: { importId: string }, deps: MarketingImportDeps): Promise<Result<MarketingImportValidation, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  return deps.transaction.run(tenant.value, async (repos) => {
    await repos.imports.lock(tenant.value, input.importId);
    const batch = await repos.imports.findById(tenant.value, input.importId);
    if (batch === null) return err(notFound('Import was not found'));
    const allowed = authorizeImport(ctx, batch, true, true);
    if (!allowed.ok) return allowed;
    if (batch.status !== 'draft' && batch.status !== 'ready') return conflict('Only uncommitted imports can be validated');
    const rows = await repos.imports.rows(tenant.value, batch.id);
    if (rows.length !== batch.rowCount) return err(validation('Upload all declared rows before validation'));
    const definition = await definitionSnapshot(tenant.value, batch, repos, deps);
    if (!definition.ok) return definition;
    const primary = new Map<string, MarketingImportRowReceipt>();
    const listsToCreate = new Set<string>();
    for (const row of rows) {
      row.errors = []; row.warnings = []; row.duplicateOf = null; row.normalizedPayload = null;
      const parsed = normalizeRow(row.stagedPayload ?? {}, batch, deps.clock.nowIso());
      if (!parsed.ok) { row.status = 'invalid'; row.errors.push(parsed.error.message); continue; }
      row.normalizedPayload = parsed.value;
      row.normalizedEmailHmac = deps.hmac.compute(tenant.value, parsed.value.email);
      row.status = 'valid';
      const previous = primary.get(parsed.value.email);
      if (previous === undefined) primary.set(parsed.value.email, row);
      else if (batch.kind === 'contacts') mergeDuplicate(previous, row, batch.consentDefinitionId !== null);
    }
    for (const row of primary.values()) {
      const payload = row.normalizedPayload;
      if (payload === null) continue;
      const existing = await repos.contacts.findByEmail(tenant.value, payload.email);
      if (existing !== null && existing.email !== payload.email) row.errors.push('Address was erased');
      if (new Set([...(existing?.tags ?? []), ...(payload.tags ?? [])]).size > 50 || (payload.lists?.length ?? 0) > 50) row.errors.push('Merged row exceeds tag or list limits');
      for (const key of payload.lists ?? []) {
        const list = await repos.lists.findByKey(tenant.value, key);
        if (list === null) listsToCreate.add(key);
        else if (list.kind !== 'static' || list.archivedAt !== null) row.errors.push(`List ${key} must be active and static`);
      }
      if (row.errors.length > 0) { row.status = 'invalid'; row.normalizedPayload = null; }
    }
    for (const row of rows) await repos.imports.saveRow(tenant.value, row);
    batch.definitionVersion = definition.value?.version.version ?? null;
    batch.definitionHash = definition.value?.hash ?? null;
    batch.contentHash = deps.contentHash.sha256(marketingCanonicalJson({ rows: rows.map((row) => ({ rowNumber: row.rowNumber, payload: row.normalizedPayload, errors: row.errors, duplicateOf: row.duplicateOf })), mapping: batch.mapping, defaults: batch.defaults, definitionHash: batch.definitionHash, delimiter: batch.delimiter }));
    batch.validationHash = batch.contentHash; batch.status = 'ready';
    await repos.imports.save(tenant.value, batch);
    await importEvent(tenant.value, batch, 'import_validated', repos, deps, ctx.identity.userId);
    const errors = rows.flatMap((row) => row.errors.map((message) => ({ rowNumber: row.rowNumber, message })));
    const warnings = rows.flatMap((row) => row.warnings.map((message) => ({ rowNumber: row.rowNumber, message })));
    const rawCsv = await repos.imports.readCsv(tenant.value, batch.id);
    const csv = rawCsv === null ? null : parseMarketingImportCsv(rawCsv, batch.delimiter ?? undefined);
    const headers = csv?.ok ? csv.value.headers : Object.keys(batch.mapping);
    const canCommitWithSkippedRows = rows.some((row) => row.status === 'valid') && !rows.some((row) => row.status === 'duplicate' && row.errors.length > 0);
    return ok({ headers, canCommitWithSkippedRows, import: batch, validationHash: batch.contentHash, preview: rows.slice(0, 20), counts: { validRows: rows.filter((row) => row.status === 'valid').length, rejectedRows: rows.filter((row) => row.status === 'invalid').length, duplicateRows: rows.filter((row) => row.status === 'duplicate').length, listsToCreate: [...listsToCreate].sort() }, errors, warnings, canCommit: errors.length === 0 });
  });
};
export const commitMarketingContactImport = async (ctx: Ctx, input: unknown, deps: MarketingImportDeps & { actor: ImportActor }): Promise<Result<{ import: MarketingContactImport }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingImportCommitSchema.safeParse(input);
  if (!parsed.success) return err(validation('Attestation and a validated dataset hash are required', parsed.error.flatten()));
  return deps.transaction.run(tenant.value, async (repos) => {
    await repos.imports.lock(tenant.value, parsed.data.importId);
    const batch = await repos.imports.findById(tenant.value, parsed.data.importId);
    if (batch === null) return err(notFound('Import was not found'));
    const rows = await repos.imports.rows(tenant.value, batch.id);
    const allowed = authorizeImport(ctx, batch, rows.some((row) => (row.normalizedPayload?.lists?.length ?? 0) > 0));
    if (!allowed.ok) return allowed;
    if (batch.validationHash !== parsed.data.validationHash) return conflict('Preview changed; validate and attest again');
    if (batch.status !== 'ready') return batch.attestedAt !== null && batch.status !== 'cancelled' ? ok({ import: batch }) : conflict('Validate this import before committing');
    const definition = await definitionSnapshot(tenant.value, batch, repos, deps);
    if (!definition.ok) return definition;
    if ((definition.value?.hash ?? null) !== batch.definitionHash) return conflict('Consent definition changed; validate and attest again');
    if (rows.some((row) => row.status === 'duplicate' && row.errors.length > 0)) return err(validation('Resolve conflicting consent evidence before commit'));
    if (parsed.data.invalidRows === 'reject_batch' && rows.some((row) => row.errors.length > 0)) return err(validation('Correct invalid rows or explicitly select skip_invalid'));
    batch.attestationVersion = parsed.data.attestation.version;
    batch.attestationText = batch.consentDefinitionId === null ? MARKETING_DIRECTORY_ATTESTATION_TEXT : MARKETING_IMPORT_ATTESTATION_TEXT;
    batch.attestationLocale = parsed.data.attestation.locale; batch.attestationNote = parsed.data.attestation.note;
    batch.attestedBy = deps.actor; batch.attestedAt = deps.clock.nowIso(); batch.invalidRows = parsed.data.invalidRows; batch.status = 'queued';
    await repos.imports.save(tenant.value, batch);
    await importEvent(tenant.value, batch, 'import_attested', repos, deps, deps.actor.kind === 'api_key' ? `api_key:${deps.actor.apiKeyId}` : `user:${deps.actor.userId}`);
    return ok({ import: batch });
  });
};
export const getMarketingContactImport = async (ctx: Ctx, input: { importId: string }, deps: MarketingImportDeps): Promise<Result<{ import: MarketingContactImport }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  const batch = await deps.imports.findById(tenant.value, input.importId);
  return batch === null ? err(notFound('Import was not found')) : ok({ import: batch });
};
export const getMarketingContactImportRows = async (ctx: Ctx, input: { importId: string; offset?: number | undefined; limit?: number | undefined }, deps: MarketingImportDeps): Promise<Result<{ rows: MarketingImportRowReceipt[]; nextOffset: number | null }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  const batch = await deps.imports.findById(tenant.value, input.importId);
  if (batch === null) return err(notFound('Import was not found'));
  const allowed = authorizeImport(ctx, batch, false, true);
  if (!allowed.ok) return allowed;
  const offset = input.offset ?? 0; const limit = input.limit ?? 100;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) return err(validation('Invalid row page'));
  const rows = await deps.imports.rowsPage(tenant.value, batch.id, offset, limit + 1);
  return ok({ rows: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null });
};
const applyRow = async (tenantId: string, batch: MarketingContactImport, receipt: MarketingImportRowReceipt, repos: MarketingImportTransactionRepos, deps: MarketingImportDeps): Promise<Result<MarketingImportRowReceipt, AppError>> => {
  const counts = marketingImportCountsSchema.parse({});
  receipt.counts = counts;
  if (receipt.status === 'invalid') { receipt.outcome = 'rejected'; counts.rejectedRows = 1; return ok(receipt); }
  if (receipt.status === 'duplicate') { receipt.outcome = 'duplicate'; counts.duplicateRows = 1; return ok(receipt); }
  const row = receipt.normalizedPayload;
  if (row === null || batch.attestedAt === null) return conflict('Validated row or attestation is unavailable');
  const hmac = deps.hmac.compute(tenantId, row.email);
  await repos.imports.lock(tenantId, `consent:${row.email}`);
  if (batch.kind === 'suppressions') {
    if (row.reason === undefined || row.at === undefined) return err(validation('Suppression evidence is incomplete'));
    const reason = { unsubscribe: 'unsubscribe_global', bounce: 'hard_bounce', complaint: 'complaint', manual: 'manual' } as const;
    const id = (await repos.suppressions.findActive(tenantId, hmac))?.id ?? deps.ids.nextId();
    const changed = await repos.suppressions.record(tenantId, {
      id, tenantId, email: row.email, emailHmac: hmac, reason: reason[row.reason], sourceRef: `marketing-import:${batch.id}:row:${receipt.rowNumber}`,
      meta: { importId: batch.id, rowNumber: receipt.rowNumber, defaults: batch.defaults, receivedAt: deps.clock.nowIso() }, createdAt: row.at, liftedAt: null, liftedBy: null,
    }, { id: deps.ids.nextId(), tenantId, mailKind: 'marketing', refId: id, type: 'suppressed_written', meta: { importId: batch.id, reason: reason[row.reason] }, occurredAt: row.at, createdAt: deps.clock.nowIso() });
    receipt.suppressionId = (await repos.suppressions.findActive(tenantId, hmac))?.id ?? null;
    receipt.outcome = changed ? 'suppression_created' : 'suppression_existing';
    counts.suppressionsCreated = changed ? 1 : 0; counts.suppressionsExisting = changed ? 0 : 1;
    return ok(receipt);
  }
  await repos.contacts.lockAddress(tenantId, row.email);
  const existing = await repos.contacts.findByEmail(tenantId, row.email);
  if (existing !== null && existing.email !== row.email) { receipt.outcome = 'rejected'; receipt.errors.push('Address was erased'); counts.rejectedRows = 1; return ok(receipt); }
  if (new Set([...(existing?.tags ?? []), ...(row.tags ?? [])]).size > 50) { receipt.outcome = 'rejected'; receipt.errors.push('Merged contact exceeds 50 tags'); counts.rejectedRows = 1; return ok(receipt); }
  const upserted = await repos.contacts.upsertByEmail(tenantId, {
    email: row.email, ...(row.name ? { displayName: row.name } : {}), ...(row.firstName ? { firstName: row.firstName } : {}), ...(row.lastName ? { lastName: row.lastName } : {}),
    ...(row.source ? { source: row.source } : {}), ...(row.tags === undefined ? {} : { tags: row.tags }),
  });
  receipt.contactId = upserted.contact.id; receipt.outcome = upserted.outcome; counts[upserted.outcome] = 1;
  counts.linkedMembers = upserted.contact.memberId !== null && existing?.memberId !== upserted.contact.memberId ? 1 : 0;
  for (const key of [...(row.lists ?? [])].sort()) {
    await repos.imports.lock(tenantId, `list-key:${key}`);
    let list = await repos.lists.findByKey(tenantId, key);
    if (list === null) {
      const saved = await repos.lists.save(tenantId, { expectedRevision: null, list: { id: deps.ids.nextId(), tenantId, key, name: key, kind: 'static', rule: null, revision: 1, createdAt: deps.clock.nowIso(), updatedAt: deps.clock.nowIso(), archivedAt: null } });
      if (!saved.ok) return saved;
      list = saved.value; counts.listsCreated += 1;
    }
    if (list.kind !== 'static' || list.archivedAt !== null) return conflict('A selected list is no longer active and static');
    counts.membershipsAdded += (await repos.lists.addMembers(tenantId, { listId: list.id, contactIds: [upserted.contact.id], importId: batch.id })).changed;
  }
  const definition = await definitionSnapshot(tenantId, batch, repos, deps);
  if (!definition.ok) return definition;
  if (definition.value === null) return ok(receipt);
  if (definition.value.hash !== batch.definitionHash) return conflict('Consent definition changed after attestation');
  const history = await repos.consents.listByEmail(tenantId, row.email, definition.value.definition.id);
  const current = deriveConsentState(history, definition.value.definition);
  if (await repos.suppressions.isSuppressed(tenantId, hmac)) { counts.consentBlockedBySuppression = 1; return ok(receipt); }
  if (current.active) { counts.consentsPreserved = 1; receipt.consentRowId = current.row?.id ?? null; return ok(receipt); }
  if (history.some((consent) => consent.status === 'withdrawn')) { counts.consentBlockedByWithdrawal = 1; return ok(receipt); }
  const consentId = deps.ids.nextId();
  await repos.consents.record(tenantId, {
    id: consentId, tenantId, email: row.email, memberId: upserted.contact.memberId, definitionId: definition.value.definition.id,
    definitionVersion: definition.value.version.version, wordingSnapshot: definition.value.version.label, documentRefSnapshot: definition.value.version.documentVersionRef,
    status: 'granted', previousId: current.row?.id ?? null, source: 'import', occurredAt: deps.clock.nowIso(),
    evidence: { collectedAt: row.consentAt ?? batch.attestedAt, proofRef: `marketing-import:${batch.id}:row:${receipt.rowNumber}`, importId: batch.id, consentSource: row.consentSource ?? null, originalCollectedAt: row.consentAt ?? null, collectedAtBasis: row.consentAt ? 'source_timestamp' : 'administrator_attestation' },
  });
  receipt.consentRowId = consentId; counts.consentsRecorded = 1;
  return ok(receipt);
};
const addCounts = (total: MarketingImportCounts, counts: MarketingImportCounts): void => {
  for (const key of marketingImportCountsSchema.keyof().options) total[key] += counts[key];
};
export const processMarketingContactImport = async (ctx: Ctx, input: { importId: string; workerId: string; deadlineAt: string; maxRows: number }, deps: MarketingImportDeps): Promise<Result<{ import: MarketingContactImport; processed: number }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'scheduler:dispatch');
  if (!tenant.ok) return tenant;
  const claim = await deps.transaction.run(tenant.value, async (repos) => {
    await repos.imports.lock(tenant.value, input.importId);
    const batch = await repos.imports.findById(tenant.value, input.importId);
    if (batch === null) return err(notFound('Import was not found'));
    const now = deps.clock.nowIso();
    if (['completed', 'completed_with_errors', 'cancelled'].includes(batch.status)) return ok(batch);
    if (!['queued', 'processing', 'failed'].includes(batch.status) || batch.nextAttemptAt > now || (batch.lockedUntil !== null && batch.lockedUntil > now && batch.lockedBy !== input.workerId)) return conflict('Import is not runnable or has an active worker');
    batch.status = 'processing'; batch.lockedBy = input.workerId; batch.lockedUntil = new Date(Date.parse(now) + 30_000).toISOString(); batch.attempts += 1; batch.startedAt ??= now; batch.finishedAt = null; batch.lastError = null;
    await repos.imports.save(tenant.value, batch); await importEvent(tenant.value, batch, 'import_started', repos, deps);
    return ok(batch);
  });
  if (!claim.ok) return claim;
  let batch = claim.value; let processed = 0;
  if (batch.status !== 'processing') return ok({ import: batch, processed });
  while (processed < input.maxRows && deps.clock.nowIso() < input.deadlineAt) {
    const result = await deps.transaction.run(tenant.value, async (repos) => {
      await repos.imports.lock(tenant.value, batch.id);
      const current = await repos.imports.findById(tenant.value, batch.id);
      if (current === null || current.status !== 'processing' || current.lockedBy !== input.workerId || current.attempts !== claim.value.attempts) return conflict('Import worker lease changed');
      const next = await repos.imports.nextRow(tenant.value, batch.id);
      if (next === null) {
        current.status = current.resultCounts.rejectedRows > 0 ? 'completed_with_errors' : 'completed'; current.finishedAt = deps.clock.nowIso(); current.lockedBy = null; current.lockedUntil = null;
        await repos.imports.save(tenant.value, current); await importEvent(tenant.value, current, 'import_completed', repos, deps);
        return ok({ batch: current, processed: false });
      }
      const applied = await applyRow(tenant.value, current, next, repos, deps);
      if (!applied.ok) return applied;
      applied.value.processedAt = deps.clock.nowIso(); applied.value.status = 'processed';
      await repos.imports.saveRow(tenant.value, applied.value);
      addCounts(current.resultCounts, applied.value.counts);
      current.lockedUntil = new Date(Date.parse(deps.clock.nowIso()) + 30_000).toISOString();
      await repos.imports.save(tenant.value, current);
      return ok({ batch: current, processed: true });
    });
    if (!result.ok) {
      await deps.transaction.run(tenant.value, async (repos) => {
        await repos.imports.lock(tenant.value, batch.id);
        const current = await repos.imports.findById(tenant.value, batch.id);
        if (current !== null && current.lockedBy === input.workerId && current.attempts === claim.value.attempts) {
          current.status = 'failed'; current.lockedBy = null; current.lockedUntil = null; current.lastError = result.error.message; current.nextAttemptAt = new Date(Date.parse(deps.clock.nowIso()) + 60_000).toISOString();
          await repos.imports.save(tenant.value, current); await importEvent(tenant.value, current, 'import_failed', repos, deps);
        }
        return ok(true);
      });
      return result;
    }
    batch = result.value.batch;
    if (!result.value.processed) break;
    processed += 1;
  }
  if (batch.status === 'processing') {
    await deps.transaction.run(tenant.value, async (repos) => {
      await repos.imports.lock(tenant.value, batch.id);
      const current = await repos.imports.findById(tenant.value, batch.id);
      if (current !== null && current.lockedBy === input.workerId && current.attempts === claim.value.attempts) { current.lockedBy = null; current.lockedUntil = null; await repos.imports.save(tenant.value, current); batch = current; }
      return ok(true);
    });
  }
  return ok({ import: batch, processed });
};
export const retryMarketingContactImport = async (ctx: Ctx, input: { importId: string }, deps: MarketingImportDeps): Promise<Result<{ import: MarketingContactImport }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  return deps.transaction.run(tenant.value, async (repos) => {
    await repos.imports.lock(tenant.value, input.importId);
    const batch = await repos.imports.findById(tenant.value, input.importId);
    if (batch === null) return err(notFound('Import was not found'));
    const allowed = authorizeImport(ctx, batch, await repos.imports.hasLists(tenant.value, batch.id));
    if (!allowed.ok) return allowed;
    if (batch.status !== 'failed') return conflict('Only failed imports can be retried');
    batch.status = 'queued'; batch.nextAttemptAt = deps.clock.nowIso(); batch.lastError = null;
    await repos.imports.save(tenant.value, batch); await importEvent(tenant.value, batch, 'import_retried', repos, deps, ctx.identity.userId);
    return ok({ import: batch });
  });
};
export const cancelMarketingContactImport = async (ctx: Ctx, input: { importId: string }, deps: MarketingImportDeps): Promise<Result<{ import: MarketingContactImport }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  return deps.transaction.run(tenant.value, async (repos) => {
    await repos.imports.lock(tenant.value, input.importId);
    const batch = await repos.imports.findById(tenant.value, input.importId);
    if (batch === null) return err(notFound('Import was not found'));
    if (batch.status === 'completed' || batch.status === 'completed_with_errors') return conflict('Completed imports cannot be cancelled');
    batch.status = 'cancelled'; batch.finishedAt = deps.clock.nowIso(); batch.lockedBy = null; batch.lockedUntil = null;
    await repos.imports.save(tenant.value, batch); await importEvent(tenant.value, batch, 'import_cancelled', repos, deps, ctx.identity.userId);
    return ok({ import: batch });
  });
};
export const importMarketingSuppressions = async (ctx: Ctx, input: unknown, deps: MarketingImportDeps): Promise<Result<{ import: MarketingContactImport }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingImportCreateSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== 'suppressions') return err(validation('Suppression import metadata is required'));
  return createMarketingContactImport(ctx, parsed.data, deps);
};

export const uploadMarketingContactImport = async (ctx: Ctx, input: unknown, deps: MarketingImportDeps): Promise<Result<MarketingImportValidation, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingImportUploadSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid CSV upload metadata', parsed.error.flatten()));
  const csv = parseMarketingImportCsv(parsed.data.csv, parsed.data.metadata.delimiter);
  if (!csv.ok) return csv;
  const mapped = mapMarketingImportCsv(csv.value, parsed.data.metadata);
  if (!mapped.ok) return mapped;
  const created = await createMarketingContactImport(ctx, { ...parsed.data.metadata, rowCount: mapped.value.rows.length, fileSha256: deps.contentHash.sha256(parsed.data.csv), mapping: mapped.value.mapping, delimiter: csv.value.delimiter }, deps);
  if (!created.ok) return created;
  for (let offset = 0; offset < mapped.value.rows.length; offset += 200) {
    const appended = await appendMarketingContactImportRows(ctx, { importId: created.value.import.id, offset, rows: mapped.value.rows.slice(offset, offset + 200) }, deps);
    if (!appended.ok) return appended;
  }
  await deps.imports.saveCsv(tenant.value, created.value.import.id, parsed.data.csv);
  const validated = await validateMarketingContactImport(ctx, { importId: created.value.import.id }, deps);
  if (validated.ok) validated.value.warnings.push(...mapped.value.warnings, ...mapped.value.unknownColumns.map((header) => ({ rowNumber: 0, message: `Unmapped column: ${header}` })));
  return validated;
};
export const previewMarketingContactImport = async (ctx: Ctx, input: unknown, deps: MarketingImportDeps): Promise<Result<MarketingImportValidation, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:import:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingImportRemapSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid mapping preview', parsed.error.flatten()));
  const changed = await deps.transaction.run(tenant.value, async (repos) => {
    await repos.imports.lock(tenant.value, parsed.data.importId);
    const batch = await repos.imports.findById(tenant.value, parsed.data.importId);
    if (batch === null) return err(notFound('Import was not found'));
    const allowed = authorizeImport(ctx, batch, true, true);
    if (!allowed.ok) return allowed;
    if (batch.status !== 'draft' && batch.status !== 'ready') return conflict('Committed imports cannot be remapped');
    const raw = await repos.imports.readCsv(tenant.value, batch.id);
    if (raw === null) return err(validation('No staged CSV is available'));
    const csv = parseMarketingImportCsv(raw, parsed.data.delimiter ?? batch.delimiter ?? undefined);
    if (!csv.ok) return csv;
    const mapped = mapMarketingImportCsv(csv.value, { kind: batch.kind, mapping: parsed.data.mapping ?? batch.mapping, defaults: parsed.data.defaults ?? batch.defaults });
    if (!mapped.ok) return mapped;
    batch.mapping = mapped.value.mapping; batch.delimiter = csv.value.delimiter; batch.defaults = parsed.data.defaults ?? batch.defaults;
    if (parsed.data.consentDefinitionId !== undefined) batch.consentDefinitionId = parsed.data.consentDefinitionId;
    batch.status = 'draft'; batch.validationHash = null; batch.rowCount = mapped.value.rows.length;
    await repos.imports.clearStagedRows(tenant.value, batch.id);
    await repos.imports.save(tenant.value, batch);
    return ok({ importId: batch.id, rows: mapped.value.rows, warnings: mapped.value.warnings });
  });
  if (!changed.ok) return changed;
  for (let offset = 0; offset < changed.value.rows.length; offset += 200) {
    const appended = await appendMarketingContactImportRows(ctx, { importId: changed.value.importId, offset, rows: changed.value.rows.slice(offset, offset + 200) }, deps);
    if (!appended.ok) return appended;
  }
  const validated = await validateMarketingContactImport(ctx, { importId: changed.value.importId }, deps);
  if (validated.ok) validated.value.warnings.push(...changed.value.warnings);
  return validated;
};
