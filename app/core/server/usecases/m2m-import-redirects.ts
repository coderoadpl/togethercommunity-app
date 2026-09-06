import {
  appError,
  canonicalImportPayload,
  coursePath,
  err,
  importRecordSchemaFor,
  importRedirectRecordSchema,
  importWriteRequestSchema,
  lessonPath,
  normalizeRedirectPath,
  ok,
  validation,
  type AppError,
  type ImportBatchResponse,
  type ImportBatchResult,
  type ImportRecord,
  type ImportRedirectRecord,
  type ImportRedirectTarget,
  type ImportWriteRequest,
  type Result,
  type TenantApiKey,
  type TenantRedirect,
} from '#core/domain/index.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock,
  ContentHash,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  ImportAuditEventRepository,
  ImportRedirectRepository,
  TenantRedirectReader,
} from '../ports.js';
import { emptyImportReferenceMaps, type ImportReferenceMaps } from './m2m-import-users.js';

export type M2mImportRedirectReaders = {
  courses: Pick<CourseRepository, 'findById'>;
  modules: Pick<CourseModuleRepository, 'findById'>;
  lessons: Pick<CourseLessonRepository, 'findById'>;
  importAuditEvents: Pick<ImportAuditEventRepository, 'findLatestByImportKey'>;
  redirects: TenantRedirectReader;
  hash: ContentHash;
};

export type M2mImportRedirectDeps = M2mImportRedirectReaders & {
  redirects: ImportRedirectRepository;
  ids: IdGenerator;
  clock: Clock;
};

type ResolvedTarget = {
  kind: TenantRedirect['targetKind'];
  id: string | null;
  path: string;
};

type PreparedRedirect = {
  importKey: string;
  payloadHash: string;
  action: 'created' | 'updated' | 'unchanged';
  resource: TenantRedirect;
};

type ReferenceKind = 'course' | 'module' | 'lesson';

const findReferenced = async (
  tenantId: string,
  kind: ReferenceKind,
  id: string,
  deps: M2mImportRedirectReaders,
): Promise<{ id: string } | null> => {
  if (kind === 'course') return deps.courses.findById(tenantId, id);
  if (kind === 'module') return deps.modules.findById(tenantId, id);
  return deps.lessons.findById(tenantId, id);
};

const resolveReference = async (
  tenantId: string,
  kind: ReferenceKind,
  key: string,
  references: ImportReferenceMaps,
  deps: M2mImportRedirectReaders,
): Promise<Result<string, AppError>> => {
  const inCall = references[kind].get(key);
  if (inCall !== undefined) return ok(inCall);
  const audit = await deps.importAuditEvents.findLatestByImportKey(tenantId, kind, key);
  if (audit !== null) {
    const referenced = await findReferenced(tenantId, kind, audit.resourceId, deps);
    if (referenced !== null) return ok(referenced.id);
  }
  return err(appError('conflict', `Referenced ${kind} "${key}" was not created by import`));
};

const courseOfModule = async (
  tenantId: string,
  moduleKey: string,
  moduleId: string,
  references: ImportReferenceMaps,
  deps: M2mImportRedirectReaders,
  inCallRecords: ReadonlyMap<string, ImportRecord> | undefined,
): Promise<Result<string, AppError>> => {
  const stored = await deps.modules.findById(tenantId, moduleId);
  const storedCourseId = stored?.courseIds[0];
  if (storedCourseId !== undefined) return ok(storedCourseId);
  const inCall = inCallRecords?.get(`module:${moduleKey}`);
  const inCallCourseKey = inCall?.kind === 'module' ? inCall.courseKeys[0] : undefined;
  if (inCallCourseKey !== undefined) {
    return resolveReference(tenantId, 'course', inCallCourseKey, references, deps);
  }
  return err(appError('conflict', `Module "${moduleKey}" belongs to no course`));
};

const resolveTarget = async (
  tenantId: string,
  target: ImportRedirectTarget,
  references: ImportReferenceMaps,
  deps: M2mImportRedirectReaders,
  inCallRecords: ReadonlyMap<string, ImportRecord> | undefined,
): Promise<Result<ResolvedTarget, AppError>> => {
  if (target.kind === 'path') {
    return ok({ kind: 'path', id: null, path: target.path });
  }
  if (target.kind === 'course') {
    const courseId = await resolveReference(tenantId, 'course', target.importKey, references, deps);
    return courseId.ok
      ? ok({ kind: 'course', id: courseId.value, path: coursePath(encodeURIComponent(courseId.value)) })
      : courseId;
  }
  if (target.kind === 'module-as-course') {
    const moduleId = await resolveReference(tenantId, 'module', target.importKey, references, deps);
    if (!moduleId.ok) return moduleId;
    const courseId = await courseOfModule(
      tenantId,
      target.importKey,
      moduleId.value,
      references,
      deps,
      inCallRecords,
    );
    return courseId.ok
      ? ok({
          kind: 'module-as-course',
          id: moduleId.value,
          path: coursePath(encodeURIComponent(courseId.value)),
        })
      : courseId;
  }
  const courseId = await resolveReference(tenantId, 'course', target.courseKey, references, deps);
  if (!courseId.ok) return courseId;
  const lessonId = await resolveReference(tenantId, 'lesson', target.importKey, references, deps);
  return lessonId.ok
    ? ok({
        kind: 'lesson',
        id: lessonId.value,
        path: lessonPath(encodeURIComponent(courseId.value), encodeURIComponent(lessonId.value)),
      })
    : lessonId;
};

const prepareRedirect = async (
  tenantId: string,
  record: ImportRedirectRecord,
  payloadHash: string,
  references: ImportReferenceMaps,
  deps: M2mImportRedirectReaders,
  now: string,
  inCallRecords?: ReadonlyMap<string, ImportRecord>,
): Promise<Result<PreparedRedirect, AppError>> => {
  const target = await resolveTarget(tenantId, record.target, references, deps, inCallRecords);
  if (!target.ok) return target;
  const fromPath = normalizeRedirectPath(record.fromPath);
  const audit = await deps.importAuditEvents.findLatestByImportKey(
    tenantId,
    'redirect',
    record.importKey,
  );
  let action: PreparedRedirect['action'];
  let id: string;
  let createdAt: string;
  if (audit === null) {
    if (await deps.redirects.findById(tenantId, record.importKey) !== null) {
      return err(appError(
        'conflict',
        `The redirect id "${record.importKey}" already belongs to a non-imported resource`,
      ));
    }
    action = 'created';
    id = record.importKey;
    createdAt = record.createdAt ?? now;
  } else {
    const stored = await deps.redirects.findById(tenantId, audit.resourceId);
    if (stored === null) {
      return err(appError('conflict', `Imported redirect "${record.importKey}" no longer exists`));
    }
    action = audit.payloadHash === payloadHash ? 'unchanged' : 'updated';
    id = stored.id;
    createdAt = record.createdAt ?? stored.createdAt;
  }
  const owner = await deps.redirects.findByFromPath(tenantId, fromPath);
  if (owner !== null && owner.id !== id) {
    return err(appError('conflict', `Another redirect already answers "${fromPath}"`));
  }
  return ok({
    importKey: record.importKey,
    payloadHash,
    action,
    resource: {
      id,
      tenantId,
      fromPath,
      targetKind: target.value.kind,
      targetId: target.value.id,
      targetPath: target.value.path,
      permanent: record.permanent,
      createdAt,
    },
  });
};

const summarize = (results: ImportBatchResult[]): ImportBatchResponse['summary'] => ({
  created: results.filter((result) => result.action === 'created').length,
  updated: results.filter((result) => result.action === 'updated').length,
  unchanged: results.filter((result) => result.action === 'unchanged').length,
  failed: results.filter((result) => result.action === 'error').length,
});

const recordImportKey = (value: unknown, index: number): string => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return `record-${index}`;
  const record = Object.fromEntries(Object.entries(value));
  return typeof record['importKey'] === 'string' ? record['importKey'] : `record-${index}`;
};

export const importM2mRedirects = async (
  ctx: Ctx,
  apiKey: TenantApiKey,
  input: ImportWriteRequest,
  deps: M2mImportRedirectDeps,
): Promise<Result<ImportBatchResponse, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'import:content-write');
  if (!tenantId.ok) return tenantId;
  const references = emptyImportReferenceMaps();
  const envelope = importWriteRequestSchema.safeParse(input);
  if (!envelope.success) return err(validation('Invalid import batch', envelope.error.flatten()));
  const results: ImportBatchResult[] = [];
  const seen = new Map<string, string>();
  for (let index = 0; index < envelope.data.records.length; index += 1) {
    const raw = envelope.data.records[index];
    const importKey = recordImportKey(raw, index);
    const parsed = importRecordSchemaFor('redirect').safeParse(raw);
    if (!parsed.success) {
      results.push({
        importKey,
        action: 'error',
        error: validation('Invalid redirect import record', parsed.error.flatten()),
      });
      continue;
    }
    const record = importRedirectRecordSchema.parse(parsed.data);
    const payloadHash = deps.hash.sha256(canonicalImportPayload(record));
    const previousHash = seen.get(record.importKey);
    if (previousHash !== undefined && previousHash !== payloadHash) {
      results.push({
        importKey: record.importKey,
        action: 'error',
        error: appError(
          'conflict',
          `Import key "${record.importKey}" has different payloads in this batch`,
        ),
      });
      continue;
    }
    seen.set(record.importKey, payloadHash);
    const prepared = await prepareRedirect(
      tenantId.value,
      record,
      payloadHash,
      references,
      deps,
      deps.clock.nowIso(),
    );
    if (!prepared.ok) {
      results.push({ importKey: record.importKey, action: 'error', error: prepared.error });
      continue;
    }
    const committed = await deps.redirects.commit(tenantId.value, {
      action: prepared.value.action,
      resource: prepared.value.resource,
      event: {
        id: deps.ids.nextId(),
        tenantId: tenantId.value,
        apiKeyId: apiKey.id,
        kind: 'redirect',
        importKey: prepared.value.importKey,
        resourceId: prepared.value.resource.id,
        action: prepared.value.action,
        payloadHash: prepared.value.payloadHash,
        at: deps.clock.nowIso(),
      },
    });
    if (committed !== 'saved') {
      results.push({
        importKey: record.importKey,
        action: 'error',
        error: appError(
          'conflict',
          committed === 'path_taken'
            ? `Another redirect already answers "${prepared.value.resource.fromPath}"`
            : `Imported redirect "${record.importKey}" changed concurrently`,
        ),
      });
      continue;
    }
    results.push({
      importKey: record.importKey,
      action: prepared.value.action,
      id: prepared.value.resource.id,
    });
  }
  return ok({ results, summary: summarize(results) });
};

export const prepareM2mRedirectValidationRecord = async (
  tenantId: string,
  record: ImportRecord,
  references: ImportReferenceMaps,
  deps: M2mImportRedirectReaders,
  now: string,
  validationRecords: ReadonlyMap<string, ImportRecord>,
  claimedPaths: Map<string, string>,
): Promise<Result<{ action: 'created' | 'updated' | 'unchanged'; id: string }, AppError>> => {
  if (record.kind !== 'redirect') return err(validation('Expected a redirect import record'));
  const payload = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'kind'));
  const prepared = await prepareRedirect(
    tenantId,
    importRedirectRecordSchema.parse(payload),
    deps.hash.sha256(canonicalImportPayload(payload)),
    references,
    deps,
    now,
    validationRecords,
  );
  if (!prepared.ok) return prepared;
  const { fromPath, id } = prepared.value.resource;
  const claimant = claimedPaths.get(fromPath);
  if (claimant !== undefined && claimant !== id) {
    return err(appError('conflict', `Another redirect already answers "${fromPath}"`));
  }
  claimedPaths.set(fromPath, id);
  return ok({ action: prepared.value.action, id });
};
