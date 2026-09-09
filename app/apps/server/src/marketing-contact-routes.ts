import type { Context, Hono } from 'hono';
import { z } from 'zod';

import { API_PATHS, HTTP_STATUS_BY_ERROR_CODE, toEnvelope, marketingDirectoryContracts } from '#core/contract/index.js';
import { marketingImportUploadSchema, marketingImportRemapSchema, err, validation, internal, ok, capabilitiesForPrincipal, type AppError, type Result, type ImportActor } from '#core/domain/index.js';
import {
  listMarketingContacts,
  exportMarketingContacts,
  upsertMarketingContact,
  getMarketingContact,
  updateMarketingContact,
  archiveMarketingContact,
  restoreMarketingContact,
  listMarketingLists,
  createMarketingList,
  getMarketingList,
  updateMarketingList,
  archiveMarketingList,
  addMarketingListContacts,
  removeMarketingListContacts,
  previewMarketingList,
  createMarketingContactImport,
  appendMarketingContactImportRows,
  validateMarketingContactImport,
  commitMarketingContactImport,
  getMarketingContactImport,
  getMarketingContactImportRows,
  retryMarketingContactImport,
  cancelMarketingContactImport,
  importMarketingSuppressions,
  processMarketingContactImport,
  syncMarketingMemberContacts,
  uploadMarketingContactImport, previewMarketingContactImport,
  type Ctx, type MarketingContactDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import type { AppDeps } from './composition.js';
import { authenticateMarketingApiKey } from './marketing-routes.js';
import { readJson } from './read-json.js';
import { secretEquals } from './secret-equals.js';

type DirectoryRouteDeps = Pick<AppDeps, 'marketingContacts' | 'tenantDomains' | 'tenants' | 'baseDomain' | 'platformHost' | 'singleTenantMode' | 'tenantApiKeys' | 'apiKeyCrypto' | 'clock' | 'ids' | 'marketingImportCronSecret' | 'marketingDirectoryJobs'>;
type Vars = AppVars;
const requestFields = (input: unknown): Record<string, unknown> => {
  const parsed = z.record(z.unknown()).safeParse(input);
  return parsed.success ? parsed.data : { invalidRequestBody: true };
};
const respond = <T>(result: Result<T, AppError>, status = 200): Response => new Response(JSON.stringify(toEnvelope(result)), { status: result.ok ? status : HTTP_STATUS_BY_ERROR_CODE[result.error.code], headers: { 'content-type': 'application/json' } });
const queryInput = (c: Context): Record<string, unknown> => Object.fromEntries(Object.entries(c.req.query()).map(([key, value]) => {
  if (['limit', 'offset'].includes(key)) return [key, Number(value)];
  if (['archived', 'suppressed', 'linkedMember'].includes(key)) return [key, value === 'true' ? true : value === 'false' ? false : value];
  if (key === 'tags') { try { const parsed: unknown = JSON.parse(value); return [key, parsed]; } catch { return [key, value.split('|')]; } }
  return [key, value];
}));
const handle = async <S extends z.ZodTypeAny>(c: Context<Vars>, deps: DirectoryRouteDeps, m2m: boolean, schema: S, input: unknown, action: (ctx: Ctx, input: z.output<S>, directory: MarketingContactDeps, actor: ImportActor) => Promise<Result<unknown, AppError>>, status = 200): Promise<Response> => {
  if (deps.marketingContacts === undefined) return respond(err(internal('Marketing directory is not configured')));
  const auth = m2m ? await authenticateMarketingApiKey(c.req.raw.headers, deps) : null;
  if (auth !== null && !auth.ok) return respond(auth);
  const ctx: Ctx = auth?.ok === true ? auth.value.ctx : ctxOf(c);
  const actor: ImportActor = auth?.ok === true ? { kind: 'api_key', apiKeyId: auth.value.apiKey.id } : { kind: 'user', userId: ctx.identity.userId };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return respond(err(validation('Invalid directory request', parsed.error.flatten())));
  return respond(await action(ctx, parsed.data, deps.marketingContacts, actor), status);
};

export const registerM2mMarketingContactRoutes = (app: Hono<Vars>, deps: DirectoryRouteDeps): void => {
  app.get(API_PATHS.m2mListMarketingContacts, async (c) => handle(c, deps, true, marketingDirectoryContracts.listMarketingContacts.input, queryInput(c), (ctx, input, directory) => listMarketingContacts(ctx, input, directory)));
  app.get(API_PATHS.m2mExportMarketingContacts, async (c) => handle(c, deps, true, marketingDirectoryContracts.exportMarketingContacts.input, queryInput(c), (ctx, input, directory) => exportMarketingContacts(ctx, input, directory)));
  app.post(API_PATHS.m2mUpsertMarketingContact, async (c) => handle(c, deps, true, marketingDirectoryContracts.upsertMarketingContact.input, await readJson(c.req.raw), (ctx, input, directory) => upsertMarketingContact(ctx, input, directory)));
  app.get(API_PATHS.m2mGetMarketingContact, async (c) => handle(c, deps, true, marketingDirectoryContracts.getMarketingContact.input, { ...z.record(z.unknown()).parse(queryInput(c)), contactId: c.req.param('id') }, (ctx, input, directory) => getMarketingContact(ctx, input, directory)));
  app.post(API_PATHS.m2mUpdateMarketingContact, async (c) => handle(c, deps, true, marketingDirectoryContracts.updateMarketingContact.input, { ...requestFields(await readJson(c.req.raw)), contactId: c.req.param('id') }, (ctx, input, directory) => updateMarketingContact(ctx, input, directory)));
  app.post(API_PATHS.m2mArchiveMarketingContact, async (c) => handle(c, deps, true, marketingDirectoryContracts.archiveMarketingContact.input, { ...requestFields(await readJson(c.req.raw)), contactId: c.req.param('id') }, (ctx, input, directory) => archiveMarketingContact(ctx, input, directory)));
  app.post(API_PATHS.m2mRestoreMarketingContact, async (c) => handle(c, deps, true, marketingDirectoryContracts.restoreMarketingContact.input, { ...requestFields(await readJson(c.req.raw)), contactId: c.req.param('id') }, (ctx, input, directory) => restoreMarketingContact(ctx, input, directory)));
  app.get(API_PATHS.m2mListMarketingLists, async (c) => handle(c, deps, true, marketingDirectoryContracts.listMarketingLists.input, queryInput(c), (ctx, input, directory) => listMarketingLists(ctx, input, directory)));
  app.post(API_PATHS.m2mCreateMarketingList, async (c) => handle(c, deps, true, marketingDirectoryContracts.createMarketingList.input, await readJson(c.req.raw), (ctx, input, directory) => createMarketingList(ctx, input, directory)));
  app.get(API_PATHS.m2mGetMarketingList, async (c) => handle(c, deps, true, marketingDirectoryContracts.getMarketingList.input, { ...z.record(z.unknown()).parse(queryInput(c)), listId: c.req.param('id') }, (ctx, input, directory) => getMarketingList(ctx, input, directory)));
  app.post(API_PATHS.m2mUpdateMarketingList, async (c) => handle(c, deps, true, marketingDirectoryContracts.updateMarketingList.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => updateMarketingList(ctx, input, directory)));
  app.post(API_PATHS.m2mArchiveMarketingList, async (c) => handle(c, deps, true, marketingDirectoryContracts.archiveMarketingList.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => archiveMarketingList(ctx, input, directory)));
  app.post(API_PATHS.m2mAddMarketingListContacts, async (c) => handle(c, deps, true, marketingDirectoryContracts.addMarketingListContacts.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => addMarketingListContacts(ctx, input, directory)));
  app.post(API_PATHS.m2mRemoveMarketingListContacts, async (c) => handle(c, deps, true, marketingDirectoryContracts.removeMarketingListContacts.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => removeMarketingListContacts(ctx, input, directory)));
  app.post(API_PATHS.m2mPreviewMarketingList, async (c) => handle(c, deps, true, marketingDirectoryContracts.previewMarketingList.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => previewMarketingList(ctx, input, directory)));
  app.get(API_PATHS.m2mGetMarketingListContacts, async (c) => handle(c, deps, true, marketingDirectoryContracts.getMarketingListContacts.input, { ...z.record(z.unknown()).parse(queryInput(c)), listId: c.req.param('id') }, (ctx, input, directory) => previewMarketingList(ctx, input, directory)));
  app.post(API_PATHS.m2mCreateMarketingContactImport, async (c) => handle(c, deps, true, marketingDirectoryContracts.createMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), ...(c.req.header('Idempotency-Key') === undefined ? {} : { idempotencyKey: c.req.header('Idempotency-Key') }) }, (ctx, input, directory) => createMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.m2mAppendMarketingContactImportRows, async (c) => handle(c, deps, true, marketingDirectoryContracts.appendMarketingContactImportRows.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => appendMarketingContactImportRows(ctx, input, directory)));
  app.post(API_PATHS.m2mValidateMarketingContactImport, async (c) => handle(c, deps, true, marketingDirectoryContracts.validateMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => validateMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.m2mCommitMarketingContactImport, async (c) => handle(c, deps, true, marketingDirectoryContracts.commitMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory, actor) => commitMarketingContactImport(ctx, input, { ...directory, actor }), 202));
  app.get(API_PATHS.m2mGetMarketingContactImport, async (c) => handle(c, deps, true, marketingDirectoryContracts.getMarketingContactImport.input, { ...z.record(z.unknown()).parse(queryInput(c)), importId: c.req.param('id') }, (ctx, input, directory) => getMarketingContactImport(ctx, input, directory)));
  app.get(API_PATHS.m2mGetMarketingContactImportRows, async (c) => handle(c, deps, true, marketingDirectoryContracts.getMarketingContactImportRows.input, { ...z.record(z.unknown()).parse(queryInput(c)), importId: c.req.param('id') }, (ctx, input, directory) => getMarketingContactImportRows(ctx, input, directory)));
  app.post(API_PATHS.m2mRetryMarketingContactImport, async (c) => handle(c, deps, true, marketingDirectoryContracts.retryMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => retryMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.m2mCancelMarketingContactImport, async (c) => handle(c, deps, true, marketingDirectoryContracts.cancelMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => cancelMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.m2mImportMarketingSuppressions, async (c) => handle(c, deps, true, marketingDirectoryContracts.importMarketingSuppressions.input, await readJson(c.req.raw), (ctx, input, directory) => importMarketingSuppressions(ctx, input, directory)));
  app.post(API_PATHS.m2mProcessMarketingContactImport, async (c) => handle(c, deps, true, marketingDirectoryContracts.processMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => processMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.m2mSyncMarketingMemberContacts, async (c) => handle(c, deps, true, marketingDirectoryContracts.syncMarketingMemberContacts.input, await readJson(c.req.raw), (ctx, input, directory) => syncMarketingMemberContacts(ctx, input, directory)));
};

export const registerSessionMarketingContactRoutes = (app: Hono<Vars>, deps: DirectoryRouteDeps): void => {
  app.post(API_PATHS.marketingContactImportUpload, async (c) => {
    const form = await c.req.formData();
    const file = form.get('file'); const metadata = form.get('metadata');
    if (!(file instanceof File) || typeof metadata !== 'string') return respond(err(validation('File and metadata parts are required')));
    if (file.size > 3 * 1024 * 1024) return respond(err(validation('CSV exceeds 3 MiB')));
    let decoded: unknown;
    try { decoded = JSON.parse(metadata); } catch { return respond(err(validation('Metadata must be JSON'))); }
    const fields = z.record(z.unknown()).safeParse(decoded);
    if (!fields.success) return respond(err(validation('Metadata must be an object')));
    let csv: string;
    try { csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); } catch { return respond(err(validation('CSV must be UTF-8'))); }
    return handle(c, deps, false, marketingImportUploadSchema, { csv, metadata: { ...fields.data, fileName: file.name } }, (ctx, input, directory) => uploadMarketingContactImport(ctx, input, directory));
  });
  app.post(API_PATHS.marketingContactImportPreview, async (c) => handle(c, deps, false, marketingImportRemapSchema, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => previewMarketingContactImport(ctx, input, directory)));
  app.get(API_PATHS.listMarketingContacts, async (c) => handle(c, deps, false, marketingDirectoryContracts.listMarketingContacts.input, queryInput(c), (ctx, input, directory) => listMarketingContacts(ctx, input, directory)));
  app.get(API_PATHS.exportMarketingContacts, async (c) => handle(c, deps, false, marketingDirectoryContracts.exportMarketingContacts.input, queryInput(c), (ctx, input, directory) => exportMarketingContacts(ctx, input, directory)));
  app.post(API_PATHS.upsertMarketingContact, async (c) => handle(c, deps, false, marketingDirectoryContracts.upsertMarketingContact.input, await readJson(c.req.raw), (ctx, input, directory) => upsertMarketingContact(ctx, input, directory)));
  app.get(API_PATHS.getMarketingContact, async (c) => handle(c, deps, false, marketingDirectoryContracts.getMarketingContact.input, { ...z.record(z.unknown()).parse(queryInput(c)), contactId: c.req.param('id') }, (ctx, input, directory) => getMarketingContact(ctx, input, directory)));
  app.post(API_PATHS.updateMarketingContact, async (c) => handle(c, deps, false, marketingDirectoryContracts.updateMarketingContact.input, { ...requestFields(await readJson(c.req.raw)), contactId: c.req.param('id') }, (ctx, input, directory) => updateMarketingContact(ctx, input, directory)));
  app.post(API_PATHS.archiveMarketingContact, async (c) => handle(c, deps, false, marketingDirectoryContracts.archiveMarketingContact.input, { ...requestFields(await readJson(c.req.raw)), contactId: c.req.param('id') }, (ctx, input, directory) => archiveMarketingContact(ctx, input, directory)));
  app.post(API_PATHS.restoreMarketingContact, async (c) => handle(c, deps, false, marketingDirectoryContracts.restoreMarketingContact.input, { ...requestFields(await readJson(c.req.raw)), contactId: c.req.param('id') }, (ctx, input, directory) => restoreMarketingContact(ctx, input, directory)));
  app.get(API_PATHS.listMarketingLists, async (c) => handle(c, deps, false, marketingDirectoryContracts.listMarketingLists.input, queryInput(c), (ctx, input, directory) => listMarketingLists(ctx, input, directory)));
  app.post(API_PATHS.createMarketingList, async (c) => handle(c, deps, false, marketingDirectoryContracts.createMarketingList.input, await readJson(c.req.raw), (ctx, input, directory) => createMarketingList(ctx, input, directory)));
  app.get(API_PATHS.getMarketingList, async (c) => handle(c, deps, false, marketingDirectoryContracts.getMarketingList.input, { ...z.record(z.unknown()).parse(queryInput(c)), listId: c.req.param('id') }, (ctx, input, directory) => getMarketingList(ctx, input, directory)));
  app.post(API_PATHS.updateMarketingList, async (c) => handle(c, deps, false, marketingDirectoryContracts.updateMarketingList.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => updateMarketingList(ctx, input, directory)));
  app.post(API_PATHS.archiveMarketingList, async (c) => handle(c, deps, false, marketingDirectoryContracts.archiveMarketingList.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => archiveMarketingList(ctx, input, directory)));
  app.post(API_PATHS.addMarketingListContacts, async (c) => handle(c, deps, false, marketingDirectoryContracts.addMarketingListContacts.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => addMarketingListContacts(ctx, input, directory)));
  app.post(API_PATHS.removeMarketingListContacts, async (c) => handle(c, deps, false, marketingDirectoryContracts.removeMarketingListContacts.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => removeMarketingListContacts(ctx, input, directory)));
  app.post(API_PATHS.previewMarketingList, async (c) => handle(c, deps, false, marketingDirectoryContracts.previewMarketingList.input, { ...requestFields(await readJson(c.req.raw)), listId: c.req.param('id') }, (ctx, input, directory) => previewMarketingList(ctx, input, directory)));
  app.get(API_PATHS.getMarketingListContacts, async (c) => handle(c, deps, false, marketingDirectoryContracts.getMarketingListContacts.input, { ...z.record(z.unknown()).parse(queryInput(c)), listId: c.req.param('id') }, (ctx, input, directory) => previewMarketingList(ctx, input, directory)));
  app.post(API_PATHS.createMarketingContactImport, async (c) => handle(c, deps, false, marketingDirectoryContracts.createMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), ...(c.req.header('Idempotency-Key') === undefined ? {} : { idempotencyKey: c.req.header('Idempotency-Key') }) }, (ctx, input, directory) => createMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.appendMarketingContactImportRows, async (c) => handle(c, deps, false, marketingDirectoryContracts.appendMarketingContactImportRows.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => appendMarketingContactImportRows(ctx, input, directory)));
  app.post(API_PATHS.validateMarketingContactImport, async (c) => handle(c, deps, false, marketingDirectoryContracts.validateMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => validateMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.commitMarketingContactImport, async (c) => handle(c, deps, false, marketingDirectoryContracts.commitMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory, actor) => commitMarketingContactImport(ctx, input, { ...directory, actor }), 202));
  app.get(API_PATHS.getMarketingContactImport, async (c) => handle(c, deps, false, marketingDirectoryContracts.getMarketingContactImport.input, { ...z.record(z.unknown()).parse(queryInput(c)), importId: c.req.param('id') }, (ctx, input, directory) => getMarketingContactImport(ctx, input, directory)));
  app.get(API_PATHS.getMarketingContactImportRows, async (c) => handle(c, deps, false, marketingDirectoryContracts.getMarketingContactImportRows.input, { ...z.record(z.unknown()).parse(queryInput(c)), importId: c.req.param('id') }, (ctx, input, directory) => getMarketingContactImportRows(ctx, input, directory)));
  app.post(API_PATHS.retryMarketingContactImport, async (c) => handle(c, deps, false, marketingDirectoryContracts.retryMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => retryMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.cancelMarketingContactImport, async (c) => handle(c, deps, false, marketingDirectoryContracts.cancelMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => cancelMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.importMarketingSuppressions, async (c) => handle(c, deps, false, marketingDirectoryContracts.importMarketingSuppressions.input, await readJson(c.req.raw), (ctx, input, directory) => importMarketingSuppressions(ctx, input, directory)));
  app.post(API_PATHS.processMarketingContactImport, async (c) => handle(c, deps, false, marketingDirectoryContracts.processMarketingContactImport.input, { ...requestFields(await readJson(c.req.raw)), importId: c.req.param('id') }, (ctx, input, directory) => processMarketingContactImport(ctx, input, directory)));
  app.post(API_PATHS.syncMarketingMemberContacts, async (c) => handle(c, deps, false, marketingDirectoryContracts.syncMarketingMemberContacts.input, await readJson(c.req.raw), (ctx, input, directory) => syncMarketingMemberContacts(ctx, input, directory)));
};

export const registerMarketingImportWorkerRoute = (app: Hono<Vars>, deps: Pick<DirectoryRouteDeps, 'clock' | 'ids' | 'marketingContacts' | 'marketingImportCronSecret' | 'marketingDirectoryJobs'>): void => {
  app.get(API_PATHS.marketingImportsTick, async (c) => {
    if (!deps.marketingImportCronSecret || !secretEquals(c.req.header('authorization'), `Bearer ${deps.marketingImportCronSecret}`)) return respond(err({ code: 'unauthorized', message: 'Invalid import worker secret' }));
    const directory = deps.marketingContacts;
    if (directory === undefined || deps.marketingDirectoryJobs === undefined) return respond(err(internal('Marketing directory is not configured')));
    const deadlineAt = new Date(Date.parse(deps.clock.nowIso()) + 20_000).toISOString();
    const workerId = deps.ids.nextId();
    let processed = 0;
    for (const tenantId of await deps.marketingDirectoryJobs.tenantIds()) {
      if (deps.clock.nowIso() >= deadlineAt) break;
      const ctx: Ctx = { identity: {
        userId: 'marketing-import-worker', email: 'worker@together.invalid', name: 'Marketing import worker', emailVerified: true, image: null,
        tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
      }, capabilities: capabilitiesForPrincipal('operator-secret') };
      const synced = await syncMarketingMemberContacts(ctx, { deadlineAt, maxJobs: 100 }, directory);
      if (!synced.ok) return respond(synced);
      for (const importId of await directory.imports.runnable(tenantId, deps.clock.nowIso())) {
        if (deps.clock.nowIso() >= deadlineAt) break;
        try {
          const result = await processMarketingContactImport(ctx, { importId, workerId, deadlineAt, maxRows: 200 }, directory);
          if (result.ok) processed += result.value.processed;
          else if (result.error.code !== 'conflict') return respond(result);
        } catch (error) {
          await directory.transaction.run(tenantId, async (repos) => {
            await repos.imports.lock(tenantId, importId);
            const batch = await repos.imports.findById(tenantId, importId);
            if (batch !== null && batch.lockedBy === workerId) {
              batch.status = 'failed'; batch.lastError = 'Infrastructure failure; unfinished rows will be retried'; batch.lockedBy = null; batch.lockedUntil = null;
              batch.nextAttemptAt = new Date(Date.parse(deps.clock.nowIso()) + 60_000).toISOString();
              await repos.imports.save(tenantId, batch);
              await repos.directoryEvents.append(tenantId, { id: deps.ids.nextId(), tenantId, subjectKind: 'import', subjectId: batch.id, type: 'import_failed', actor: workerId, importId, payload: {}, occurredAt: deps.clock.nowIso(), createdAt: deps.clock.nowIso() });
            }
            return ok(true);
          });
          throw error;
        }
      }
      if (deps.clock.nowIso() < deadlineAt) await directory.imports.purgeStaging(tenantId, deps.clock.nowIso());
    }
    return respond(ok({ processed }));
  });
};
