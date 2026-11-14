import {
  appError,
  canonicalImportPayload,
  err,
  importGrantRecordSchema,
  importMemberRecordSchema,
  importProgressRecordSchema,
  importRecordSchemaFor,
  importWriteRequestSchema,
  ok,
  validation,
  type AppError,
  type CourseModule,
  type ImportModuleRecord,
  type ImportBatchResponse,
  type ImportBatchResult,
  type ImportGrantRecord,
  type ImportKind,
  type ImportMemberRecord,
  type ImportProgressRecord,
  type ImportRecord,
  type ImportUsersKind,
  type ImportWriteRequest,
  type MemberCourseProgress,
  type ProductGrant,
  type Result,
  type TenantApiKey,
} from '#core/domain/index.js';

import {
  cacheImportContentReaders,
  checkImportCreatedAt,
  emptyImportReferenceMaps,
  memoizeImportRead,
  rememberImportReference,
  resolveImportReference,
  type ImportReferenceMaps,
} from './m2m-import-context.js';

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
  ImportMemberResource,
  ImportUsersMutation,
  ImportUsersReader,
  ImportUsersRepository,
  ProductRepository,
} from '../ports.js';

export type M2mImportUsersReaders = {
  courses: Pick<CourseRepository, 'findById'>;
  modules: Pick<CourseModuleRepository, 'findById' | 'list'>;
  lessons: Pick<CourseLessonRepository, 'findById'>;
  products: Pick<ProductRepository, 'findById'>;
  importAuditEvents: Pick<ImportAuditEventRepository, 'findLatestByImportKey'>;
  importUsers: ImportUsersReader;
  hash: ContentHash;
};

export type M2mImportUsersDeps = M2mImportUsersReaders & {
  importUsers: ImportUsersRepository;
  ids: IdGenerator;
  clock: Clock;
};

type PredictedAction = {
  action: 'created' | 'updated' | 'unchanged';
  id: string;
};

type PreparedUsersRecord =
  | {
      kind: 'member';
      importKey: string;
      payloadHash: string;
      action: PredictedAction['action'];
      resource: ImportMemberResource;
      authUser: {
        action: 'create' | 'keep';
        name: string;
        emailVerified: true;
      };
    }
  | {
      kind: 'grant';
      importKey: string;
      payloadHash: string;
      action: PredictedAction['action'];
      resource: ProductGrant;
    }
  | {
      kind: 'progress';
      importKey: string;
      payloadHash: string;
      action: PredictedAction['action'];
      resource: MemberCourseProgress;
    };

const findTarget = async (
  tenantId: string,
  kind: ImportKind,
  id: string,
  deps: M2mImportUsersReaders,
): Promise<{ id: string; archivedAt?: string | null | undefined } | null> => {
  if (kind === 'course') return deps.courses.findById(tenantId, id);
  if (kind === 'module') return deps.modules.findById(tenantId, id);
  if (kind === 'lesson') return deps.lessons.findById(tenantId, id);
  if (kind === 'product') return deps.products.findById(tenantId, id);
  if (kind === 'member') return deps.importUsers.findMemberById(tenantId, id);
  if (kind === 'grant') return deps.importUsers.findGrantById(tenantId, id);
  return deps.importUsers.findProgressById(tenantId, id);
};

const resolveReference = (
  tenantId: string,
  kind: ImportKind,
  key: string,
  references: ImportReferenceMaps,
  deps: M2mImportUsersReaders,
): Promise<Result<string, AppError>> => resolveImportReference(
  tenantId,
  kind,
  key,
  references,
  () => deps.importAuditEvents.findLatestByImportKey(tenantId, kind, key),
  (id) => findTarget(tenantId, kind, id, deps),
);

const importPayloadHash = (
  record: unknown,
  hash: ContentHash,
): string => hash.sha256(canonicalImportPayload(record));

const prepareMember = async (
  tenantId: string,
  record: ImportMemberRecord,
  payloadHash: string,
  deps: M2mImportUsersReaders,
  now: string,
  newUserId: string,
): Promise<Result<PreparedUsersRecord, AppError>> => {
  const audit = await deps.importAuditEvents.findLatestByImportKey(
    tenantId,
    'member',
    record.importKey,
  );
  if (audit === null) {
    if (await deps.importUsers.findMemberById(tenantId, record.importKey) !== null) {
      return err(appError(
        'conflict',
        `The member id "${record.importKey}" already belongs to a non-imported resource`,
      ));
    }
    if (await deps.importUsers.findMemberByEmail(tenantId, record.email) !== null) {
      return err(appError('conflict', `A tenant member already uses "${record.email}"`));
    }
    const authUser = await deps.importUsers.findAuthUserByEmail(tenantId, record.email);
    if (authUser !== null) {
      return err(appError('conflict', 'This member identity cannot be imported'));
    }
    return ok({
      kind: 'member',
      importKey: record.importKey,
      payloadHash,
      action: 'created',
      resource: {
        id: record.importKey,
        tenantId,
        userId: newUserId,
        email: record.email,
        displayName: record.displayName,
        legacyId: record.legacyId ?? null,
        createdAt: record.createdAt ?? now,
      },
      authUser: {
        action: 'create',
        name: record.displayName,
        emailVerified: true,
      },
    });
  }
  const target = await deps.importUsers.findMemberById(tenantId, audit.resourceId);
  if (target === null) {
    return err(appError('conflict', `Imported member "${record.importKey}" no longer exists`));
  }
  if (target.email !== record.email) {
    return err(appError('conflict', 'An imported member email cannot be changed'));
  }
  const authUser = await deps.importUsers.findAuthUserByEmail(tenantId, target.email);
  if (authUser === null || authUser.id !== target.userId) {
    return err(appError('conflict', `Imported member "${record.importKey}" has no matching user`));
  }
  const action = audit.payloadHash === payloadHash ? 'unchanged' : 'updated';
  return ok({
    kind: 'member',
    importKey: record.importKey,
    payloadHash,
    action,
    resource: {
      ...target,
      displayName: record.displayName,
      legacyId: record.legacyId ?? null,
      createdAt: record.createdAt ?? target.createdAt,
    },
    authUser: {
      action: 'keep',
      name: record.displayName,
      emailVerified: true,
    },
  });
};

const prepareGrant = async (
  tenantId: string,
  record: ImportGrantRecord,
  payloadHash: string,
  references: ImportReferenceMaps,
  deps: M2mImportUsersReaders,
  now: string,
): Promise<Result<PreparedUsersRecord, AppError>> => {
  const memberId = await resolveReference(tenantId, 'member', record.memberKey, references, deps);
  if (!memberId.ok) return memberId;
  const productId = await resolveReference(tenantId, 'product', record.productKey, references, deps);
  if (!productId.ok) return productId;
  const audit = await deps.importAuditEvents.findLatestByImportKey(
    tenantId,
    'grant',
    record.importKey,
  );
  let predicted: PredictedAction;
  let createdAt = now;
  if (audit === null) {
    if (await deps.importUsers.findGrantById(tenantId, record.importKey) !== null) {
      return err(appError(
        'conflict',
        `The grant id "${record.importKey}" already belongs to a non-imported resource`,
      ));
    }
    if (await deps.importUsers.findGrantByPair(tenantId, {
      memberId: memberId.value,
      productId: productId.value,
    }) !== null) {
      return err(appError('conflict', 'A grant already exists for this member and product'));
    }
    predicted = { action: 'created', id: record.importKey };
  } else {
    const target = await deps.importUsers.findGrantById(tenantId, audit.resourceId);
    if (target === null) {
      return err(appError('conflict', `Imported grant "${record.importKey}" no longer exists`));
    }
    if (target.memberId !== memberId.value || target.productId !== productId.value) {
      return err(appError('conflict', 'An imported grant member and product cannot be changed'));
    }
    predicted = {
      action: audit.payloadHash === payloadHash ? 'unchanged' : 'updated',
      id: target.id,
    };
    createdAt = target.createdAt;
  }
  return ok({
    kind: 'grant',
    importKey: record.importKey,
    payloadHash,
    action: predicted.action,
    resource: {
      id: predicted.id,
      tenantId,
      memberId: memberId.value,
      productId: productId.value,
      mode: 'live',
      source: 'import',
      startsAt: record.startsAt,
      expiresAt: record.expiresAt,
      legacyId: record.legacyId ?? null,
      createdAt,
    },
  });
};

const progressCourseMembership = (
  tenantId: string,
  courseId: string,
  courseKey: string,
  references: ImportReferenceMaps,
  deps: M2mImportUsersReaders,
  validationRecords: ReadonlyMap<string, ImportRecord> | undefined,
) => {
  const cacheKey = JSON.stringify([tenantId, courseId, courseKey]);
  let membership = references.progressCourses.get(cacheKey);
  if (membership !== undefined) return membership;
  let moduleIndex = references.modulesByCourse.get(tenantId);
  if (moduleIndex === undefined) {
    moduleIndex = deps.modules.list(tenantId).then((modules) => {
      const byCourse = new Map<string, CourseModule[]>();
      for (const module of modules) {
        for (const id of module.courseIds) {
          const entries = byCourse.get(id) ?? [];
          entries.push(module);
          byCourse.set(id, entries);
        }
      }
      return byCourse;
    });
    references.modulesByCourse.set(tenantId, moduleIndex);
  }
  if (references.forwardModulesByCourse === undefined) {
    const byCourse = new Map<string, ImportModuleRecord[]>();
    for (const record of validationRecords?.values() ?? []) {
      if (record.kind !== 'module') continue;
      for (const key of record.courseKeys) {
        const entries = byCourse.get(key) ?? [];
        entries.push(record);
        byCourse.set(key, entries);
      }
    }
    references.forwardModulesByCourse = byCourse;
  }
  const inCallModules = references.forwardModulesByCourse.get(courseKey) ?? [];
  membership = moduleIndex.then((byCourse) => {
    const modules = byCourse.get(courseId) ?? [];
    const lessonIds = new Set(modules.flatMap((module) =>
      module.chapters.flatMap((chapter) => chapter.contents.map((content) => content.lessonId))));
    for (const module of inCallModules) {
      for (const chapter of module.chapters) {
        for (const content of chapter.contents) {
          lessonIds.add(references.lesson.get(content.lessonKey) ?? content.lessonKey);
        }
      }
    }
    return { modules, inCallModules, lessonIds };
  });
  references.progressCourses.set(cacheKey, membership);
  return membership;
};

const prepareProgress = async (
  tenantId: string,
  record: ImportProgressRecord,
  payloadHash: string,
  references: ImportReferenceMaps,
  deps: M2mImportUsersReaders,
  validationRecords?: ReadonlyMap<string, ImportRecord>,
): Promise<Result<PreparedUsersRecord, AppError>> => {
  const memberId = await resolveReference(tenantId, 'member', record.memberKey, references, deps);
  if (!memberId.ok) return memberId;
  const courseId = await resolveReference(tenantId, 'course', record.courseKey, references, deps);
  if (!courseId.ok) return courseId;
  const completedLessonIds: string[] = [];
  for (const key of record.completedLessonKeys) {
    const lessonId = await resolveReference(tenantId, 'lesson', key, references, deps);
    if (!lessonId.ok) return lessonId;
    completedLessonIds.push(lessonId.value);
  }
  const lastViewedLessonId = record.lastViewedLessonKey === undefined
    ? undefined
    : await resolveReference(tenantId, 'lesson', record.lastViewedLessonKey, references, deps);
  if (lastViewedLessonId !== undefined && !lastViewedLessonId.ok) return lastViewedLessonId;
  const lastViewedModuleId = record.lastViewedModuleKey === undefined
    ? undefined
    : await resolveReference(tenantId, 'module', record.lastViewedModuleKey, references, deps);
  if (lastViewedModuleId !== undefined && !lastViewedModuleId.ok) return lastViewedModuleId;
  const { modules, inCallModules, lessonIds: courseLessonIds } = await progressCourseMembership(
    tenantId, courseId.value, record.courseKey, references, deps, validationRecords,
  );
  for (const lessonId of completedLessonIds) {
    if (!courseLessonIds.has(lessonId)) {
      return err(appError('conflict', `Lesson "${lessonId}" does not belong to the referenced course`));
    }
  }
  if (lastViewedLessonId !== undefined && !courseLessonIds.has(lastViewedLessonId.value)) {
    return err(appError(
      'conflict',
      `Lesson "${lastViewedLessonId.value}" does not belong to the referenced course`,
    ));
  }
  if (
    lastViewedModuleId !== undefined
    && !modules.some((module) => module.id === lastViewedModuleId.value)
    && !inCallModules.some((candidate) => candidate.importKey === record.lastViewedModuleKey)
  ) {
    return err(appError(
      'conflict',
      `Module "${lastViewedModuleId.value}" does not belong to the referenced course`,
    ));
  }
  if (record.lastViewedChapterId !== undefined) {
    const eligibleModules = lastViewedModuleId === undefined
      ? modules
      : modules.filter((module) => module.id === lastViewedModuleId.value);
    const eligibleInCallModules = lastViewedModuleId === undefined
      ? inCallModules
      : inCallModules.filter((candidate) => candidate.importKey === record.lastViewedModuleKey);
    if (
      !eligibleModules.some((module) =>
        module.chapters.some((chapter) => chapter.id === record.lastViewedChapterId))
      && !eligibleInCallModules.some((candidate) =>
        candidate.chapters.some((chapter) => chapter.id === record.lastViewedChapterId))
    ) {
      return err(appError(
        'conflict',
        `Chapter "${record.lastViewedChapterId}" does not belong to the referenced course`,
      ));
    }
  }
  const audit = await deps.importAuditEvents.findLatestByImportKey(
    tenantId,
    'progress',
    record.importKey,
  );
  let predicted: PredictedAction;
  if (audit === null) {
    if (await deps.importUsers.findProgressById(tenantId, record.importKey) !== null) {
      return err(appError(
        'conflict',
        `The progress id "${record.importKey}" already belongs to a non-imported resource`,
      ));
    }
    if (await deps.importUsers.findProgressByPair(tenantId, {
      memberId: memberId.value,
      courseId: courseId.value,
    }) !== null) {
      return err(appError('conflict', 'Progress already exists for this member and course'));
    }
    predicted = { action: 'created', id: record.importKey };
  } else {
    const target = await deps.importUsers.findProgressById(tenantId, audit.resourceId);
    if (target === null) {
      return err(appError('conflict', `Imported progress "${record.importKey}" no longer exists`));
    }
    if (target.memberId !== memberId.value || target.courseId !== courseId.value) {
      return err(appError('conflict', 'An imported progress member and course cannot be changed'));
    }
    predicted = {
      action: audit.payloadHash === payloadHash ? 'unchanged' : 'updated',
      id: target.id,
    };
  }
  return ok({
    kind: 'progress',
    importKey: record.importKey,
    payloadHash,
    action: predicted.action,
    resource: {
      id: predicted.id,
      tenantId,
      memberId: memberId.value,
      courseId: courseId.value,
      completedLessonIds,
      ...(lastViewedLessonId === undefined ? {} : { lastViewedLessonId: lastViewedLessonId.value }),
      ...(lastViewedModuleId === undefined ? {} : { lastViewedModuleId: lastViewedModuleId.value }),
      ...(record.lastViewedChapterId === undefined
        ? {}
        : { lastViewedChapterId: record.lastViewedChapterId }),
      updatedAt: record.updatedAt,
    },
  });
};

const prepareUsersRecord = async (
  tenantId: string,
  kind: ImportUsersKind,
  record: unknown,
  payloadHash: string,
  references: ImportReferenceMaps,
  deps: M2mImportUsersReaders,
  now: string,
  newUserId: string,
  validationRecords?: ReadonlyMap<string, ImportRecord>,
): Promise<Result<PreparedUsersRecord, AppError>> => {
  if (kind === 'member') {
    return prepareMember(
      tenantId,
      importMemberRecordSchema.parse(record),
      payloadHash,
      deps,
      now,
      newUserId,
    );
  }
  if (kind === 'grant') {
    return prepareGrant(
      tenantId,
      importGrantRecordSchema.parse(record),
      payloadHash,
      references,
      deps,
      now,
    );
  }
  return prepareProgress(
    tenantId,
    importProgressRecordSchema.parse(record),
    payloadHash,
    references,
    deps,
    validationRecords,
  );
};

const recordImportKey = (value: unknown, index: number): string => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return `record-${index}`;
  const record = Object.fromEntries(Object.entries(value));
  return typeof record['importKey'] === 'string' ? record['importKey'] : `record-${index}`;
};

const summarize = (results: ImportBatchResult[]): ImportBatchResponse['summary'] => ({
  created: results.filter((result) => result.action === 'created').length,
  updated: results.filter((result) => result.action === 'updated').length,
  unchanged: results.filter((result) => result.action === 'unchanged').length,
  failed: results.filter((result) => result.action === 'error').length,
});

const mutationFor = (
  prepared: PreparedUsersRecord,
  apiKey: TenantApiKey,
  deps: Pick<M2mImportUsersDeps, 'ids'>,
  now: string,
): ImportUsersMutation => {
  const event = {
    id: deps.ids.nextId(),
    tenantId: prepared.resource.tenantId,
    apiKeyId: apiKey.id,
    kind: prepared.kind,
    importKey: prepared.importKey,
    resourceId: prepared.resource.id,
    action: prepared.action,
    payloadHash: prepared.payloadHash,
    at: now,
  };
  if (prepared.kind === 'member') {
    return {
      kind: prepared.kind,
      action: prepared.action,
      resource: prepared.resource,
      authUser: prepared.authUser,
      event,
    };
  }
  if (prepared.kind === 'grant') {
    return { kind: prepared.kind, action: prepared.action, resource: prepared.resource, event };
  }
  return { kind: prepared.kind, action: prepared.action, resource: prepared.resource, event };
};

export const importM2mUsers = async (
  ctx: Ctx,
  apiKey: TenantApiKey,
  kind: ImportUsersKind,
  input: ImportWriteRequest,
  deps: M2mImportUsersDeps,
): Promise<Result<ImportBatchResponse, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'import:users-write');
  if (!tenantId.ok) return tenantId;
  const envelope = importWriteRequestSchema.safeParse(input);
  if (!envelope.success) return err(validation('Invalid import batch', envelope.error.flatten()));
  const cachedReaders = cacheImportContentReaders(deps);
  const modulesList = memoizeImportRead(deps.modules.list);
  deps = { ...cachedReaders.deps, modules: { ...cachedReaders.deps.modules, list: modulesList.read } };
  const now = deps.clock.nowIso();
  const results: ImportBatchResult[] = [];
  const seen = new Map<string, string>();
  const seenMemberEmails = new Map<string, string>();
  const references = emptyImportReferenceMaps();
  for (let index = 0; index < envelope.data.records.length; index += 1) {
    const raw = envelope.data.records[index];
    const importKey = recordImportKey(raw, index);
    const parsed = importRecordSchemaFor(kind).safeParse(raw);
    if (!parsed.success) {
      results.push({
        importKey,
        action: 'error',
        error: validation(`Invalid ${kind} import record`, parsed.error.flatten()),
      });
      continue;
    }
    const timestamp = checkImportCreatedAt(parsed.data, now);
    if (!timestamp.ok) {
      results.push({ importKey: parsed.data.importKey, action: 'error', error: timestamp.error });
      continue;
    }
    const payloadHash = importPayloadHash(parsed.data, deps.hash);
    const previousHash = seen.get(parsed.data.importKey);
    if (previousHash !== undefined && previousHash !== payloadHash) {
      results.push({
        importKey: parsed.data.importKey,
        action: 'error',
        error: appError(
          'conflict',
          `Import key "${parsed.data.importKey}" has different payloads in this batch`,
        ),
      });
      continue;
    }
    seen.set(parsed.data.importKey, payloadHash);
    if (kind === 'member') {
      const member = importMemberRecordSchema.parse(parsed.data);
      const emailOwner = seenMemberEmails.get(member.email);
      if (emailOwner !== undefined && emailOwner !== member.importKey) {
        results.push({
          importKey: member.importKey,
          action: 'error',
          error: appError('conflict', `Another record in this batch uses "${member.email}"`),
        });
        continue;
      }
      seenMemberEmails.set(member.email, member.importKey);
    }
    const prepared = await prepareUsersRecord(
      tenantId.value,
      kind,
      parsed.data,
      payloadHash,
      references,
      deps,
      now,
      deps.ids.nextId(),
    );
    if (!prepared.ok) {
      results.push({ importKey: parsed.data.importKey, action: 'error', error: prepared.error });
      continue;
    }
    const committed = await deps.importUsers.commit(
      tenantId.value,
      mutationFor(prepared.value, apiKey, deps, now),
    );
    if (committed !== 'saved') {
      results.push({
        importKey: parsed.data.importKey,
        action: 'error',
        error: appError('conflict', `Imported ${kind} "${parsed.data.importKey}" changed concurrently`),
      });
      continue;
    }
    rememberImportReference(tenantId.value, kind, parsed.data.importKey, prepared.value.resource.id, references);
    results.push({
      importKey: parsed.data.importKey,
      action: prepared.value.action,
      id: prepared.value.resource.id,
    });
  }
  return ok({ results, summary: summarize(results) });
};

export const prepareM2mUsersValidationRecord = async (
  tenantId: string,
  record: ImportRecord,
  references: ImportReferenceMaps,
  deps: M2mImportUsersReaders,
  now: string,
  validationRecords: ReadonlyMap<string, ImportRecord>,
): Promise<Result<PredictedAction, AppError>> => {
  if (record.kind !== 'member' && record.kind !== 'grant' && record.kind !== 'progress') {
    return err(validation('Expected a users import record'));
  }
  const payload = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'kind'));
  const prepared = await prepareUsersRecord(
    tenantId,
    record.kind,
    payload,
    importPayloadHash(payload, deps.hash),
    references,
    deps,
    now,
    `${record.importKey}:user`,
    validationRecords,
  );
  return prepared.ok
    ? ok({ action: prepared.value.action, id: prepared.value.resource.id })
    : prepared;
};
