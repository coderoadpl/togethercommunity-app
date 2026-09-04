import { describe, expect, it } from 'vitest';

import {
  LESSON_ATTACHMENT_MAX_BYTES,
  computeCourseModuleName,
  err,
  integrationUnavailable,
  notFound,
  ok,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type LessonAttachment,
  type Product,
  type ProductGrant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  LessonAttachmentRepository,
  MemberCourseProgressRepository,
  ProductGrantRepository,
  ProductRepository,
  StorageProvider,
} from '../ports.js';
import {
  ATTACHMENT_DOWNLOAD_TTL_SECONDS,
  ATTACHMENT_UPLOAD_TTL_SECONDS,
  beginLessonAttachmentUpload,
  completeLessonAttachmentUpload,
  deleteLessonAttachment,
  getLessonAttachmentDownload,
  listLessonAttachments,
  listMemberLessonAttachments,
  type MemberLessonAttachmentDeps,
} from './lesson-attachments.js';

const NOW = '2026-08-03T12:00:00.000Z';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: 'user-1',
  email: 'member@example.test',
  name: 'Member',
  emailVerified: true,
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'member-1',
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  ...overrides,
});

const ctx = (overrides: Partial<Identity> = {}): Ctx => ({ identity: identity(overrides) });

const lesson: CourseLesson = {
  id: 'lesson-1',
  tenantId: 'tenant-1',
  name: 'Private lesson',
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const course: Course = {
  id: 'course-1',
  tenantId: 'tenant-1',
  name: 'Course',
  description: '',
  imageUrl: null,
  moduleOrder: ['module-1'],
  publiclyVisible: false,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const module: CourseModule = {
  id: 'module-1',
  tenantId: 'tenant-1',
  courseIds: ['course-1'],
  title: 'Module',
  prefix: null,
  name: computeCourseModuleName(null, 'Module'),
  chapters: [{
    id: 'chapter-1',
    name: 'Chapter',
    contents: [{ id: 'content-1', name: 'Private lesson', lessonId: 'lesson-1' }],
  }],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const product: Product = {
  id: 'product-1',
  tenantId: 'tenant-1',
  type: 'course',
  slug: 'course-access',
  title: 'Course access',
  description: '',
  coverUrl: null,
  priceCents: 1000,
  currency: 'PLN',
  published: true,
  accessItems: [{ level: 'course', courseId: 'course-1' }],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const grant: ProductGrant = {
  id: 'grant-1',
  tenantId: 'tenant-1',
  memberId: 'member-1',
  productId: 'product-1',
  source: 'stripe',
  startsAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const attachmentRepository = (): LessonAttachmentRepository & { rows: LessonAttachment[] } => {
  const rows: LessonAttachment[] = [];
  return {
    rows,
    create: async (tenantId, attachment) => {
      rows.push({ ...attachment, tenantId });
    },
    findById: async (tenantId, attachmentId) =>
      rows.find((row) => row.tenantId === tenantId && row.id === attachmentId) ?? null,
    listByLesson: async (tenantId, lessonId) =>
      rows.filter((row) => row.tenantId === tenantId && row.lessonId === lessonId),
    listReadyByLesson: async (tenantId, lessonId) =>
      rows.filter((row) => row.tenantId === tenantId && row.lessonId === lessonId && row.status === 'ready'),
    markReady: async (tenantId, attachmentId, sizeBytes) => {
      const index = rows.findIndex((row) => row.tenantId === tenantId && row.id === attachmentId);
      const current = rows[index];
      if (current === undefined) return null;
      const ready: LessonAttachment = { ...current, status: 'ready', sizeBytes };
      rows[index] = ready;
      return ready;
    },
    delete: async (tenantId, attachmentId) => {
      const index = rows.findIndex((row) => row.tenantId === tenantId && row.id === attachmentId);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
};

const lessons: CourseLessonRepository = {
  list: async () => [lesson],
  listPreviews: async () => [],
  findById: async (tenantId, id) => tenantId === lesson.tenantId && id === lesson.id ? lesson : null,
  findByIds: async () => [lesson],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const courses: CourseRepository = {
  list: async () => [course],
  findById: async () => course,
  findByIds: async () => [course],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const modules: CourseModuleRepository = {
  list: async () => [module],
  findById: async () => module,
  findByIds: async () => [module],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const grants: ProductGrantRepository = {
  findById: async () => null,
  findGrant: async () => null,
  createGrant: async () => true,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async (_tenantId, memberId) => memberId === grant.memberId ? [grant] : [],
  listGrantedProducts: async (_tenantId, memberId) => memberId === grant.memberId ? [product] : [],
};

const products: ProductRepository = {
  listByTenant: async () => [product],
  listPublishedByTenant: async () => [product],
  findById: async () => product,
  create: async () => 'created',
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
};

const progress: MemberCourseProgressRepository = {
  findByMemberAndCourse: async () => null,
  listByMember: async () => [],
  findOrCreate: async (tenantId, input) => ({
    id: input.id,
    tenantId,
    memberId: input.memberId,
    courseId: input.courseId,
    completedLessonIds: [],
    updatedAt: input.now,
  }),
  update: async (_tenantId, value) => value,
  countReferencingLesson: async () => 0,
};

const storageConfiguration = JSON.stringify({
  provider: 'minio',
  endpoint: 'https://storage.example.test',
  region: 'eu-central-1',
  bucket: 'creator-files',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
});

const testDeps = (actualSizeBytes = 2048) => {
  const attachments = attachmentRepository();
  const signed: Array<{ method: 'GET' | 'PUT'; url: string; region?: string; expiresInSeconds: number }> = [];
  const removed: string[] = [];
  const storage: StorageProvider = {
    objectUrl: (input, key) => new URL(`${input.endpoint}/${input.bucket}/${key}`),
    probe: async () => ok({ code: 'storage.available', message: 'ok' }),
    presignPut: (input) => {
      signed.push({
        method: 'PUT',
        url: input.url,
        ...(input.region === undefined ? {} : { region: input.region }),
        expiresInSeconds: input.expiresInSeconds,
      });
      return ok(`${input.url}?signed=put`);
    },
    presignGet: (input) => {
      signed.push({
        method: 'GET',
        url: input.url,
        ...(input.region === undefined ? {} : { region: input.region }),
        expiresInSeconds: input.expiresInSeconds,
      });
      return ok(`${input.url}&signed=get`);
    },
    delete: async (input) => {
      removed.push(input.url);
      return ok({ deleted: true });
    },
    head: async () => ok({ sizeBytes: actualSizeBytes }),
    healthcheck: async () => ok({ healthy: true }),
    test: async () => ok({ code: 'storage.available', message: 'ok' }),
  };
  const deps: MemberLessonAttachmentDeps = {
    attachments,
    lessons,
    courses,
    modules,
    grants,
    products,
    progress,
    storage,
    secretResolver: {
      resolve: async (_tenantId, key) => key === 's3.configuration'
        ? ok(storageConfiguration)
        : err(notFound('missing')),
    },
    ids: { nextId: () => 'attachment-1' },
    clock: { nowIso: () => NOW },
  };
  return { attachments, deps, removed, signed };
};

describe('lesson attachments', () => {
  it('shows pending uploads to staff but exposes them to members only after completion', async () => {
    const { attachments, deps, signed } = testDeps();
    const owner = ctx({ staffRole: 'owner', memberId: null });
    const started = await beginLessonAttachmentUpload(owner, lesson.id, {
      fileName: 'Ćwiczenia 01.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);

    expect(started.value.attachment.status).toBe('pending');
    expect(started.value.expiresAt).toBe('2026-08-03T12:15:00.000Z');
    expect(signed).toEqual([{
      method: 'PUT',
      url: 'https://storage.example.test/creator-files/lesson-attachments/lesson-1/attachment-1/C-wiczenia-01.pdf',
      region: 'eu-central-1',
      expiresInSeconds: ATTACHMENT_UPLOAD_TTL_SECONDS,
    }]);
    await expect(listLessonAttachments(owner, lesson.id, deps)).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'attachment-1', status: 'pending' }],
    });
    await expect(listMemberLessonAttachments(ctx(), lesson.id, deps)).resolves.toEqual({ ok: true, value: [] });

    await expect(
      completeLessonAttachmentUpload(owner, lesson.id, started.value.attachment.id, deps),
    ).resolves.toMatchObject({ ok: true, value: { status: 'ready' } });
    expect(attachments.rows[0]?.status).toBe('ready');
    await expect(listMemberLessonAttachments(ctx(), lesson.id, deps)).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'attachment-1' }],
    });
  });

  it('uses HEAD metadata as the authoritative object size before completion', async () => {
    const { attachments, deps } = testDeps(8192);
    const owner = ctx({ staffRole: 'owner', memberId: null });
    const started = await beginLessonAttachmentUpload(owner, lesson.id, {
      fileName: 'handout.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);

    await expect(
      completeLessonAttachmentUpload(owner, lesson.id, started.value.attachment.id, deps),
    ).resolves.toMatchObject({ ok: true, value: { status: 'ready', sizeBytes: 8192 } });
    expect(attachments.rows[0]?.sizeBytes).toBe(8192);
  });

  it('deletes an uploaded object whose authoritative size is out of range', async () => {
    const { attachments, deps, removed } = testDeps(LESSON_ATTACHMENT_MAX_BYTES + 1);
    const owner = ctx({ staffRole: 'owner', memberId: null });
    const started = await beginLessonAttachmentUpload(owner, lesson.id, {
      fileName: 'oversized.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);

    await expect(
      completeLessonAttachmentUpload(owner, lesson.id, started.value.attachment.id, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(removed).toEqual([
      'https://storage.example.test/creator-files/lesson-attachments/lesson-1/attachment-1/oversized.pdf',
    ]);
    expect(attachments.rows[0]?.status).toBe('pending');
  });

  it('keeps an upload pending when the stored object cannot be verified', async () => {
    const { attachments, deps } = testDeps();
    const owner = ctx({ staffRole: 'owner', memberId: null });
    const started = await beginLessonAttachmentUpload(owner, lesson.id, {
      fileName: 'missing.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);
    const unavailableDeps: MemberLessonAttachmentDeps = {
      ...deps,
      storage: {
        ...deps.storage,
        head: async () => err(integrationUnavailable('Object does not exist')),
      },
    };

    await expect(
      completeLessonAttachmentUpload(owner, lesson.id, started.value.attachment.id, unavailableDeps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(attachments.rows[0]?.status).toBe('pending');
  });

  it('signs a download for an entitled member and returns forbidden for everyone without access', async () => {
    const { deps, signed } = testDeps();
    const owner = ctx({ staffRole: 'owner', memberId: null });
    const started = await beginLessonAttachmentUpload(owner, lesson.id, {
      fileName: 'private handout.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4096,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);
    await completeLessonAttachmentUpload(owner, lesson.id, started.value.attachment.id, deps);

    const allowed = await getLessonAttachmentDownload(ctx(), lesson.id, 'attachment-1', deps);
    if (!allowed.ok) throw new Error(allowed.error.message);
    expect(allowed.value).toContain('signed=get');
    expect(signed[1]).toMatchObject({
      method: 'GET',
      region: 'eu-central-1',
      expiresInSeconds: ATTACHMENT_DOWNLOAD_TTL_SECONDS,
    });
    expect(signed[1]?.url).toContain('response-content-disposition=attachment%3B+filename*%3DUTF-8');

    const unentitled = await getLessonAttachmentDownload(
      ctx({ userId: 'user-2', memberId: 'member-2' }),
      lesson.id,
      'attachment-1',
      deps,
    );
    expect(unentitled).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const nonMember = await getLessonAttachmentDownload(
      ctx({ userId: 'user-3', memberId: null }),
      lesson.id,
      'attachment-1',
      deps,
    );
    expect(nonMember).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(signed).toHaveLength(2);
  });

  it('hides an attachment that belongs to another tenant', async () => {
    const { attachments, deps } = testDeps();
    attachments.rows.push({
      id: 'tenant-b-attachment',
      tenantId: 'tenant-2',
      lessonId: lesson.id,
      fileName: 'tenant-b.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: 'tenant-b/private.pdf',
      status: 'ready',
      createdAt: NOW,
    });

    await expect(
      getLessonAttachmentDownload(ctx(), lesson.id, 'tenant-b-attachment', deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects attachment writes from an ordinary member', async () => {
    const { attachments, deps } = testDeps();
    const member = ctx();

    await expect(beginLessonAttachmentUpload(member, lesson.id, {
      fileName: 'member.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    }, deps)).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    attachments.rows.push({
      id: 'attachment-member-cannot-delete',
      tenantId: 'tenant-1',
      lessonId: lesson.id,
      fileName: 'owner.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: 'private/owner.pdf',
      status: 'ready',
      createdAt: NOW,
    });
    await expect(
      deleteLessonAttachment(member, lesson.id, 'attachment-member-cannot-delete', deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(attachments.rows).toHaveLength(1);
  });

  it('removes the stored object of an abandoned upload', async () => {
    const { attachments, deps, removed } = testDeps();
    const owner = ctx({ staffRole: 'owner', memberId: null });
    const started = await beginLessonAttachmentUpload(owner, lesson.id, {
      fileName: 'draft.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);

    await expect(
      deleteLessonAttachment(owner, lesson.id, started.value.attachment.id, deps),
    ).resolves.toEqual({ ok: true, value: { deleted: true } });
    expect(removed).toEqual([
      'https://storage.example.test/creator-files/lesson-attachments/lesson-1/attachment-1/draft.pdf',
    ]);
    expect(attachments.rows).toEqual([]);
  });

  it('detaches an attachment even when storage deletion fails', async () => {
    const { attachments, deps } = testDeps();
    const owner = ctx({ staffRole: 'owner', memberId: null });
    const started = await beginLessonAttachmentUpload(owner, lesson.id, {
      fileName: 'orphan.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);
    const unavailableDeps: MemberLessonAttachmentDeps = {
      ...deps,
      storage: {
        ...deps.storage,
        delete: async () => err(integrationUnavailable('Storage unavailable')),
      },
    };

    await expect(
      deleteLessonAttachment(owner, lesson.id, started.value.attachment.id, unavailableDeps),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'integration_unavailable',
        message: expect.stringContaining('lesson-attachments/lesson-1/attachment-1/orphan.pdf'),
      },
    });
    expect(attachments.rows).toEqual([]);
  });
});
