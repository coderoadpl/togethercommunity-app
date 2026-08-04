import {
  appError,
  canonicalImportPayload,
  computeCourseModuleName,
  err,
  importContentKindSchema,
  importKindSchema,
  importRecordSchema,
  importCourseRecordSchema,
  importLessonRecordSchema,
  importModuleRecordSchema,
  importProductRecordSchema,
  importRecordSchemaFor,
  importValidateRequestSchema,
  importWriteRequestSchema,
  ok,
  slugReserved,
  validation,
  type AccessItem,
  type AppError,
  type Chapter,
  type Course,
  type CourseLesson,
  type CourseModule,
  type ImportBatchResponse,
  type ImportBatchResult,
  type ImportContentKind,
  type ImportCourseRecord,
  type ImportLessonRecord,
  type ImportModuleRecord,
  type ImportProductRecord,
  type ImportValidationResponse,
  type ImportValidateRequest,
  type ImportWriteRequest,
  type ImportKind,
  type ImportRecord,
  type Product,
  type Result,
  type TenantApiKey,
} from '#core/domain/index.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  ApiKeyRateLimitRepository,
  Clock,
  ContentHash,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  ImportAuditEventRepository,
  ImportContentMutation,
  ImportContentRepository,
  ProductRepository,
} from '../ports.js';
import {
  emptyImportReferenceMaps,
  prepareM2mUsersValidationRecord,
  type M2mImportUsersReaders,
} from './m2m-import-users.js';

type ImportReaders = {
  courses: Pick<CourseRepository, 'findById'>;
  modules: Pick<CourseModuleRepository, 'findById'>;
  lessons: Pick<CourseLessonRepository, 'findById'>;
  products: Pick<ProductRepository, 'findById' | 'listByTenant'>;
  importAuditEvents: Pick<ImportAuditEventRepository, 'findLatestByImportKey'>;
  hash: ContentHash;
};

export type M2mImportValidationDeps = ImportReaders & M2mImportUsersReaders & { clock: Clock };

export type M2mImportContentDeps = ImportReaders & {
  importContent: ImportContentRepository;
  ids: IdGenerator;
  clock: Clock;
};

export type M2mImportRateLimitDeps = {
  rateLimits: ApiKeyRateLimitRepository;
  clock: Clock;
};

type ReferenceMaps = Record<ImportContentKind, Map<string, string>>;

type PredictedAction = {
  action: 'created' | 'updated' | 'unchanged';
  id: string;
  createdAt: string | null;
};

type PreparedContent =
  | { kind: 'course'; importKey: string; payloadHash: string; action: PredictedAction['action']; resource: Course }
  | { kind: 'module'; importKey: string; payloadHash: string; action: PredictedAction['action']; resource: CourseModule }
  | { kind: 'lesson'; importKey: string; payloadHash: string; action: PredictedAction['action']; resource: CourseLesson }
  | { kind: 'product'; importKey: string; payloadHash: string; action: PredictedAction['action']; resource: Product };

const emptyReferenceMaps = (): ReferenceMaps => ({
  course: new Map(),
  module: new Map(),
  lesson: new Map(),
  product: new Map(),
});

const findTarget = async (
  tenantId: string,
  kind: ImportContentKind,
  id: string,
  deps: ImportReaders,
): Promise<{ id: string; createdAt: string; published?: boolean } | null> => {
  if (kind === 'course') return deps.courses.findById(tenantId, id);
  if (kind === 'module') return deps.modules.findById(tenantId, id);
  if (kind === 'lesson') return deps.lessons.findById(tenantId, id);
  return deps.products.findById(tenantId, id);
};

const resolveReference = async (
  tenantId: string,
  kind: ImportContentKind,
  key: string,
  references: ReferenceMaps,
  deps: ImportReaders,
): Promise<Result<string, AppError>> => {
  const inCall = references[kind].get(key);
  if (inCall !== undefined) return ok(inCall);
  const audit = await deps.importAuditEvents.findLatestByImportKey(tenantId, kind, key);
  if (audit !== null) {
    const imported = await findTarget(tenantId, kind, audit.resourceId, deps);
    if (imported !== null) return ok(imported.id);
  }
  return err(appError('conflict', `Referenced ${kind} "${key}" was not created by import`));
};

const resolveKeys = async (
  tenantId: string,
  kind: ImportContentKind,
  keys: string[],
  references: ReferenceMaps,
  deps: ImportReaders,
): Promise<Result<string[], AppError>> => {
  const ids: string[] = [];
  for (const key of keys) {
    const resolved = await resolveReference(tenantId, kind, key, references, deps);
    if (!resolved.ok) return resolved;
    ids.push(resolved.value);
  }
  return ok(ids);
};

const predictAction = async (
  tenantId: string,
  kind: ImportContentKind,
  importKey: string,
  payloadHash: string,
  deps: ImportReaders,
): Promise<Result<PredictedAction, AppError>> => {
  const audit = await deps.importAuditEvents.findLatestByImportKey(tenantId, kind, importKey);
  if (audit === null) {
    const collision = await findTarget(tenantId, kind, importKey, deps);
    return collision === null
      ? ok({ action: 'created', id: importKey, createdAt: null })
      : err(appError('conflict', `The ${kind} id "${importKey}" already belongs to a non-imported resource`));
  }
  const target = await findTarget(tenantId, kind, audit.resourceId, deps);
  if (target === null) {
    return err(appError('conflict', `Imported ${kind} "${importKey}" no longer exists`));
  }
  if (audit.payloadHash === payloadHash) {
    return ok({ action: 'unchanged', id: target.id, createdAt: target.createdAt });
  }
  if (kind === 'product' && target.published === true) {
    return err(appError('conflict', `Imported product "${importKey}" is published and cannot be updated`));
  }
  return ok({ action: 'updated', id: target.id, createdAt: target.createdAt });
};

const prepareCourse = async (
  tenantId: string,
  record: ImportCourseRecord,
  payloadHash: string,
  references: ReferenceMaps,
  deps: ImportReaders,
  now: string,
): Promise<Result<PreparedContent, AppError>> => {
  const moduleOrder = await resolveKeys(tenantId, 'module', record.moduleOrder, references, deps);
  if (!moduleOrder.ok) return moduleOrder;
  const predicted = await predictAction(tenantId, 'course', record.importKey, payloadHash, deps);
  if (!predicted.ok) return predicted;
  return ok({
    kind: 'course',
    importKey: record.importKey,
    payloadHash,
    action: predicted.value.action,
    resource: {
      id: predicted.value.id,
      tenantId,
      name: record.name,
      description: record.description,
      imageUrl: record.imageUrl,
      moduleOrder: moduleOrder.value,
      legacyId: record.legacyId ?? null,
      createdAt: record.createdAt ?? predicted.value.createdAt ?? now,
    },
  });
};

const prepareModule = async (
  tenantId: string,
  record: ImportModuleRecord,
  payloadHash: string,
  references: ReferenceMaps,
  deps: ImportReaders,
  now: string,
): Promise<Result<PreparedContent, AppError>> => {
  const courseIds = await resolveKeys(tenantId, 'course', record.courseKeys, references, deps);
  if (!courseIds.ok) return courseIds;
  const chapters: Chapter[] = [];
  for (const chapter of record.chapters) {
    const contents: Chapter['contents'] = [];
    for (const content of chapter.contents) {
      const lessonId = await resolveReference(tenantId, 'lesson', content.lessonKey, references, deps);
      if (!lessonId.ok) return lessonId;
      contents.push({ id: content.id, name: content.name, lessonId: lessonId.value });
    }
    chapters.push({ id: chapter.id, name: chapter.name, contents });
  }
  const predicted = await predictAction(tenantId, 'module', record.importKey, payloadHash, deps);
  if (!predicted.ok) return predicted;
  return ok({
    kind: 'module',
    importKey: record.importKey,
    payloadHash,
    action: predicted.value.action,
    resource: {
      id: predicted.value.id,
      tenantId,
      courseIds: courseIds.value,
      title: record.title,
      prefix: record.prefix,
      name: computeCourseModuleName(record.prefix, record.title),
      chapters,
      legacyId: record.legacyId ?? null,
      createdAt: record.createdAt ?? predicted.value.createdAt ?? now,
    },
  });
};

const prepareLesson = async (
  tenantId: string,
  record: ImportLessonRecord,
  payloadHash: string,
  deps: ImportReaders,
  now: string,
): Promise<Result<PreparedContent, AppError>> => {
  const predicted = await predictAction(tenantId, 'lesson', record.importKey, payloadHash, deps);
  if (!predicted.ok) return predicted;
  return ok({
    kind: 'lesson',
    importKey: record.importKey,
    payloadHash,
    action: predicted.value.action,
    resource: {
      id: predicted.value.id,
      tenantId,
      name: record.name,
      isPreview: record.isPreview,
      contents: record.contents,
      ...(record.durationMinutes === undefined ? {} : { durationMinutes: record.durationMinutes }),
      legacyId: record.legacyId ?? null,
      createdAt: record.createdAt ?? predicted.value.createdAt ?? now,
    },
  });
};

const resolveAccessItems = async (
  tenantId: string,
  record: ImportProductRecord,
  references: ReferenceMaps,
  deps: ImportReaders,
): Promise<Result<AccessItem[], AppError>> => {
  const accessItems: AccessItem[] = [];
  for (const item of record.accessItems) {
    const courseId = await resolveReference(tenantId, 'course', item.courseKey, references, deps);
    if (!courseId.ok) return courseId;
    if (item.level === 'course') {
      const excludedModuleIds = item.excludedModuleKeys === undefined
        ? undefined
        : await resolveKeys(tenantId, 'module', item.excludedModuleKeys, references, deps);
      if (excludedModuleIds !== undefined && !excludedModuleIds.ok) return excludedModuleIds;
      accessItems.push({
        level: 'course',
        courseId: courseId.value,
        ...(excludedModuleIds === undefined ? {} : { excludedModuleIds: excludedModuleIds.value }),
      });
      continue;
    }
    if (item.level === 'modules') {
      const moduleIds = await resolveKeys(tenantId, 'module', item.moduleKeys, references, deps);
      if (!moduleIds.ok) return moduleIds;
      accessItems.push({ level: 'modules', courseId: courseId.value, moduleIds: moduleIds.value });
      continue;
    }
    const lessonIds = await resolveKeys(tenantId, 'lesson', item.lessonKeys, references, deps);
    if (!lessonIds.ok) return lessonIds;
    accessItems.push({ level: 'lessons', courseId: courseId.value, lessonIds: lessonIds.value });
  }
  return ok(accessItems);
};

const prepareProduct = async (
  tenantId: string,
  record: ImportProductRecord,
  payloadHash: string,
  references: ReferenceMaps,
  deps: ImportReaders,
  now: string,
): Promise<Result<PreparedContent, AppError>> => {
  const accessItems = await resolveAccessItems(tenantId, record, references, deps);
  if (!accessItems.ok) return accessItems;
  const predicted = await predictAction(tenantId, 'product', record.importKey, payloadHash, deps);
  if (!predicted.ok) return predicted;
  const slugOwner = (await deps.products.listByTenant(tenantId)).find((product) => product.slug === record.slug);
  if (slugOwner !== undefined && slugOwner.id !== predicted.value.id) {
    return err(slugReserved(`A product with slug "${record.slug}" already exists`));
  }
  return ok({
    kind: 'product',
    importKey: record.importKey,
    payloadHash,
    action: predicted.value.action,
    resource: {
      id: predicted.value.id,
      tenantId,
      type: record.type,
      slug: record.slug,
      title: record.title,
      description: record.description,
      coverUrl: record.coverUrl,
      priceCents: record.priceCents,
      currency: record.currency,
      published: false,
      accessItems: accessItems.value,
      checkoutConsentDefinitionIds: [],
      legacyId: record.legacyId ?? null,
      createdAt: record.createdAt ?? predicted.value.createdAt ?? now,
    },
  });
};

const prepareRecord = async (
  tenantId: string,
  kind: ImportContentKind,
  record: unknown,
  payloadHash: string,
  references: ReferenceMaps,
  deps: ImportReaders,
  now: string,
): Promise<Result<PreparedContent, AppError>> => {
  if (kind === 'course') return prepareCourse(tenantId, importCourseRecordSchema.parse(record), payloadHash, references, deps, now);
  if (kind === 'module') return prepareModule(tenantId, importModuleRecordSchema.parse(record), payloadHash, references, deps, now);
  if (kind === 'lesson') return prepareLesson(tenantId, importLessonRecordSchema.parse(record), payloadHash, deps, now);
  return prepareProduct(tenantId, importProductRecordSchema.parse(record), payloadHash, references, deps, now);
};

const recordIdentity = (value: unknown, index: number): { kind?: ImportKind; importKey: string } => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { importKey: `record-${index}` };
  const record = Object.fromEntries(Object.entries(value));
  const kind = importKindSchema.safeParse(record['kind']);
  const importKey = typeof record['importKey'] === 'string' ? record['importKey'] : `record-${index}`;
  return { ...(kind.success ? { kind: kind.data } : {}), importKey };
};

const summarize = (results: ImportBatchResult[]): ImportBatchResponse['summary'] => ({
  created: results.filter((result) => result.action === 'created').length,
  updated: results.filter((result) => result.action === 'updated').length,
  unchanged: results.filter((result) => result.action === 'unchanged').length,
  failed: results.filter((result) => result.action === 'error').length,
});

const mutationFor = (
  prepared: PreparedContent,
  apiKey: TenantApiKey,
  deps: Pick<M2mImportContentDeps, 'ids' | 'clock'>,
): ImportContentMutation => {
  const event = {
    id: deps.ids.nextId(),
    tenantId: prepared.resource.tenantId,
    apiKeyId: apiKey.id,
    kind: prepared.kind,
    importKey: prepared.importKey,
    resourceId: prepared.resource.id,
    action: prepared.action,
    payloadHash: prepared.payloadHash,
    at: deps.clock.nowIso(),
  };
  if (prepared.kind === 'course') return { kind: prepared.kind, action: prepared.action, resource: prepared.resource, event };
  if (prepared.kind === 'module') return { kind: prepared.kind, action: prepared.action, resource: prepared.resource, event };
  if (prepared.kind === 'lesson') return { kind: prepared.kind, action: prepared.action, resource: prepared.resource, event };
  return { kind: prepared.kind, action: prepared.action, resource: prepared.resource, event };
};

export const importM2mContent = async (
  ctx: Ctx,
  apiKey: TenantApiKey,
  kind: ImportContentKind,
  input: ImportWriteRequest,
  deps: M2mImportContentDeps,
): Promise<Result<ImportBatchResponse, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'import:content-write');
  if (!tenantId.ok) return tenantId;
  const envelope = importWriteRequestSchema.safeParse(input);
  if (!envelope.success) return err(validation('Invalid import batch', envelope.error.flatten()));
  const results: ImportBatchResult[] = [];
  const seen = new Map<string, string>();
  const references = emptyReferenceMaps();
  for (let index = 0; index < envelope.data.records.length; index += 1) {
    const raw = envelope.data.records[index];
    const identity = recordIdentity(raw, index);
    const parsed = importRecordSchemaFor(kind).safeParse(raw);
    if (!parsed.success) {
      results.push({
        importKey: identity.importKey,
        action: 'error',
        error: validation(`Invalid ${kind} import record`, parsed.error.flatten()),
      });
      continue;
    }
    const payloadHash = deps.hash.sha256(canonicalImportPayload(parsed.data));
    const previousHash = seen.get(parsed.data.importKey);
    if (previousHash !== undefined && previousHash !== payloadHash) {
      results.push({
        importKey: parsed.data.importKey,
        action: 'error',
        error: appError('conflict', `Import key "${parsed.data.importKey}" has different payloads in this batch`),
      });
      continue;
    }
    seen.set(parsed.data.importKey, payloadHash);
    const prepared = await prepareRecord(
      tenantId.value,
      kind,
      parsed.data,
      payloadHash,
      references,
      deps,
      deps.clock.nowIso(),
    );
    if (!prepared.ok) {
      results.push({ importKey: parsed.data.importKey, action: 'error', error: prepared.error });
      continue;
    }
    const committed = await deps.importContent.commit(
      tenantId.value,
      mutationFor(prepared.value, apiKey, deps),
    );
    if (committed !== 'saved') {
      results.push({
        importKey: parsed.data.importKey,
        action: 'error',
        error: committed === 'slug_taken'
          ? slugReserved(`A product with slug "${prepared.value.kind === 'product' ? prepared.value.resource.slug : ''}" already exists`)
          : appError('conflict', `Imported ${kind} "${parsed.data.importKey}" changed concurrently`),
      });
      continue;
    }
    results.push({
      importKey: parsed.data.importKey,
      action: prepared.value.action,
      id: prepared.value.resource.id,
    });
  }
  return ok({ results, summary: summarize(results) });
};

const payloadWithoutKind = (record: ImportRecord): unknown => {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'kind'));
};

const emptyPlanCounts = (): Record<ImportKind, number> => ({
  course: 0,
  module: 0,
  lesson: 0,
  product: 0,
  member: 0,
  grant: 0,
  progress: 0,
});

const validateImportForTenant = async (
  ctx: Ctx,
  tenantId: string,
  input: ImportValidateRequest,
  deps: M2mImportValidationDeps,
): Promise<Result<ImportValidationResponse, AppError>> => {
  const envelope = importValidateRequestSchema.safeParse(input);
  if (!envelope.success) return err(validation('Invalid import validation request', envelope.error.flatten()));
  const create = emptyPlanCounts();
  const update = emptyPlanCounts();
  const unchanged = emptyPlanCounts();
  const errors: ImportValidationResponse['errors'] = [];
  const warnings: ImportValidationResponse['warnings'] = [];
  const references = emptyImportReferenceMaps();
  const parsedRecords = new Map<number, ImportRecord>();
  const recordsByKey = new Map<string, ImportRecord>();
  const seen = new Set<string>();
  const memberEmails = new Map<string, string>();
  for (let index = 0; index < envelope.data.records.length; index += 1) {
    const raw = envelope.data.records[index];
    const identity = recordIdentity(raw, index);
    const parsed = importRecordSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        index,
        ...(identity.kind === undefined ? {} : { kind: identity.kind }),
        importKey: identity.importKey,
        error: validation('Invalid import record', parsed.error.flatten()),
      });
      continue;
    }
    const requiredCapability = importContentKindSchema.safeParse(parsed.data.kind).success
      ? 'import:content-write'
      : 'import:users-write';
    if (ctx.capabilities?.includes(requiredCapability) !== true) {
      errors.push({
        index,
        kind: parsed.data.kind,
        importKey: parsed.data.importKey,
        error: appError('forbidden', `${requiredCapability} is required for ${parsed.data.kind} records`),
      });
      continue;
    }
    if (parsed.data.kind === 'member') {
      const emailOwner = memberEmails.get(parsed.data.email);
      if (emailOwner !== undefined && emailOwner !== parsed.data.importKey) {
        errors.push({
          index,
          kind: parsed.data.kind,
          importKey: parsed.data.importKey,
          error: appError('conflict', `Another record in this call uses "${parsed.data.email}"`),
        });
        continue;
      }
      memberEmails.set(parsed.data.email, parsed.data.importKey);
    }
    const uniqueKey = `${parsed.data.kind}:${parsed.data.importKey}`;
    if (seen.has(uniqueKey)) {
      errors.push({
        index,
        kind: parsed.data.kind,
        importKey: parsed.data.importKey,
        error: appError('conflict', `Import key "${parsed.data.importKey}" is duplicated in this call`),
      });
      continue;
    }
    seen.add(uniqueKey);
    parsedRecords.set(index, parsed.data);
    recordsByKey.set(uniqueKey, parsed.data);
    references[parsed.data.kind].set(parsed.data.importKey, parsed.data.importKey);
  }
  for (const [index, record] of parsedRecords) {
    const prepared = importContentKindSchema.safeParse(record.kind).success
      ? await prepareRecord(
          tenantId,
          importContentKindSchema.parse(record.kind),
          payloadWithoutKind(record),
          deps.hash.sha256(canonicalImportPayload(payloadWithoutKind(record))),
          references,
          deps,
          'createdAt' in record && record.createdAt !== undefined
            ? record.createdAt
            : deps.clock.nowIso(),
        )
      : await prepareM2mUsersValidationRecord(
          tenantId,
          record,
          references,
          deps,
          deps.clock.nowIso(),
          recordsByKey,
        );
    if (!prepared.ok) {
      errors.push({ index, kind: record.kind, importKey: record.importKey, error: prepared.error });
      continue;
    }
    if (prepared.value.action === 'created') create[record.kind] += 1;
    if (prepared.value.action === 'updated') update[record.kind] += 1;
    if (prepared.value.action === 'unchanged') unchanged[record.kind] += 1;
    if (
      record.kind === 'grant'
      && record.expiresAt !== null
      && Date.parse(record.expiresAt) < Date.parse(deps.clock.nowIso())
    ) {
      warnings.push({
        index,
        kind: record.kind,
        importKey: record.importKey,
        message: 'expiresAt is in the past — grant will import as expired',
      });
    }
  }
  errors.sort((left, right) => left.index - right.index);
  return ok({
    plan: { create, update, unchanged },
    errors,
    warnings,
    valid: errors.length === 0,
  });
};

export const validateM2mImport = async (
  ctx: Ctx,
  input: ImportValidateRequest,
  deps: M2mImportValidationDeps,
): Promise<Result<ImportValidationResponse, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'import:validate');
  return tenantId.ok ? validateImportForTenant(ctx, tenantId.value, input, deps) : tenantId;
};

const windowStart = (now: string, durationMs: number): string =>
  new Date(Math.floor(Date.parse(now) / durationMs) * durationMs).toISOString();

const retryAfter = (now: string, startedAt: string, durationMs: number): number =>
  Math.max(1, Math.ceil((Date.parse(startedAt) + durationMs - Date.parse(now)) / 1_000));

export const claimM2mImportRateLimit = async (
  tenantId: string,
  apiKey: TenantApiKey,
  input:
    | { mode: 'validate' }
    | { mode: 'content'; recordCount: number }
    | { mode: 'users'; kind: 'member' | 'grant' | 'progress'; recordCount: number },
  deps: M2mImportRateLimitDeps,
): Promise<Result<void, AppError>> => {
  const now = deps.clock.nowIso();
  if (input.mode === 'validate') {
    const durationMs = 3_600_000;
    const startedAt = windowStart(now, durationMs);
    const claimed = await deps.rateLimits.claim(tenantId, {
      apiKeyId: apiKey.id,
      period: 'hour',
      windowStartedAt: startedAt,
      limit: 30,
    });
    return claimed
      ? ok(undefined)
      : err(appError('rate_limited', 'Import validation rate limit exceeded', {
          period: 'hour',
          retryAfterSeconds: retryAfter(now, startedAt, durationMs),
        }));
  }
  const minuteDurationMs = 60_000;
  const minuteStartedAt = windowStart(now, minuteDurationMs);
  const minuteClaimed = await deps.rateLimits.claim(tenantId, {
    apiKeyId: apiKey.id,
    period: 'minute',
    windowStartedAt: minuteStartedAt,
    limit: 60,
  });
  if (!minuteClaimed) {
    return err(appError('rate_limited', 'Import request rate limit exceeded', {
      period: 'minute',
      retryAfterSeconds: retryAfter(now, minuteStartedAt, minuteDurationMs),
    }));
  }
  const dayDurationMs = 86_400_000;
  const dayStartedAt = windowStart(now, dayDurationMs);
  const dailyLimit = input.mode === 'users' && input.kind === 'member' ? 2_000 : 20_000;
  const dayClaimed = await deps.rateLimits.claim(tenantId, {
    apiKeyId: apiKey.id,
    period: 'day',
    windowStartedAt: dayStartedAt,
    limit: dailyLimit,
    cost: input.recordCount,
  });
  if (dayClaimed) return ok(undefined);
  await deps.rateLimits.release(tenantId, {
    apiKeyId: apiKey.id,
    period: 'minute',
    windowStartedAt: minuteStartedAt,
  });
  return err(appError('rate_limited', 'Import daily record limit exceeded', {
    period: 'day',
    retryAfterSeconds: retryAfter(now, dayStartedAt, dayDurationMs),
  }));
};
