import { describe, expect, it } from 'vitest';

import {
  capabilitiesForApiKey,
  type Course,
  type CourseLesson,
  type CourseModule,
  type ImportAuditEvent,
  type MemberCourseProgress,
  type Product,
  type ProductGrant,
  type TenantApiKey,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  ImportAuthUserState,
  ImportMemberResource,
  ImportUsersMutation,
} from '../ports.js';
import { importM2mUsers, type M2mImportUsersDeps } from './m2m-import-users.js';
import {
  validateM2mImportForUsers,
  type M2mImportValidationDeps,
} from './m2m-import.js';

const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-1';
const MARKER = `pbkdf2$25000$${'ab'.repeat(32)}$${'cd'.repeat(512)}`;
const OTHER_MARKER = `pbkdf2$25000$${'ef'.repeat(32)}$${'01'.repeat(512)}`;

const apiKey: TenantApiKey = {
  id: 'key-1',
  tenantId: TENANT_ID,
  name: 'Migration',
  keyHash: 'hash',
  scopes: ['import:users'],
  createdAt: NOW,
  expiresAt: '1998-08-20T10:00:00.000Z',
  revokedAt: null,
};

const ctx: Ctx = {
  identity: {
    userId: 'api-key',
    email: 'api-key@invalid.test',
    name: 'Migration API',
    emailVerified: true,
    tenantId: TENANT_ID,
    tenantSlug: 'tenant',
    tenantName: 'Tenant',
    staffRole: null,
    memberId: null,
    memberBannedAt: null,
  },
  capabilities: capabilitiesForApiKey(apiKey),
};

const course: Course = {
  id: 'course-native',
  tenantId: TENANT_ID,
  name: 'Course',
  description: '',
  imageUrl: null,
  moduleOrder: ['module-native'],
  legacyId: null,
  createdAt: NOW,
};

const lesson: CourseLesson = {
  id: 'lesson-native',
  tenantId: TENANT_ID,
  name: 'Lesson',
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: NOW,
};

const module: CourseModule = {
  id: 'module-native',
  tenantId: TENANT_ID,
  courseIds: [course.id],
  title: 'Module',
  prefix: null,
  name: 'Module',
  chapters: [{
    id: 'chapter-native',
    name: 'Chapter',
    contents: [{ id: 'content-native', name: 'Lesson', lessonId: lesson.id }],
  }],
  legacyId: null,
  createdAt: NOW,
};

const product: Product = {
  id: 'product-native',
  tenantId: TENANT_ID,
  type: 'course',
  slug: 'native',
  title: 'Native',
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  published: false,
  accessItems: [],
  checkoutConsentDefinitionIds: [],
  legacyId: null,
  createdAt: NOW,
};

const memberRecord = (legacyPasswordHash: string | null = MARKER) => ({
  importKey: 'member-source',
  legacyId: 'source',
  email: 'USER@Example.test',
  displayName: 'Jan Kowalski',
  ...(legacyPasswordHash === null ? {} : { legacyPasswordHash }),
});

const harness = () => {
  let sequence = 0;
  const authUsers = new Map<string, ImportAuthUserState>();
  const members = new Map<string, ImportMemberResource>();
  const grants = new Map<string, ProductGrant>();
  const progress = new Map<string, MemberCourseProgress>();
  const audits = new Map<string, ImportAuditEvent>();
  const commits: ImportUsersMutation[] = [];
  const importUsers: M2mImportUsersDeps['importUsers'] = {
    findAuthUserByEmail: async (_tenantId, email) => authUsers.get(email) ?? null,
    findMemberById: async (_tenantId, id) => members.get(id) ?? null,
    findMemberByEmail: async (_tenantId, email) =>
      [...members.values()].find((member) => member.email === email) ?? null,
    findGrantById: async (_tenantId, id) => grants.get(id) ?? null,
    findGrantByPair: async (_tenantId, input) =>
      [...grants.values()].find((grant) =>
        grant.memberId === input.memberId && grant.productId === input.productId) ?? null,
    findProgressById: async (_tenantId, id) => progress.get(id) ?? null,
    findProgressByPair: async (_tenantId, input) =>
      [...progress.values()].find((row) =>
        row.memberId === input.memberId && row.courseId === input.courseId) ?? null,
    commit: async (_tenantId, mutation) => {
      commits.push(mutation);
      if (mutation.kind === 'member') {
        const previous = authUsers.get(mutation.resource.email);
        authUsers.set(mutation.resource.email, {
          id: mutation.resource.userId,
          email: mutation.resource.email,
          hasCredentialAccount:
            previous?.hasCredentialAccount === true
            || mutation.authUser.legacyPasswordHash !== null,
          credentialPassword:
            mutation.authUser.legacyPasswordHash ?? previous?.credentialPassword ?? null,
        });
        members.set(mutation.resource.id, mutation.resource);
      }
      if (mutation.kind === 'grant') grants.set(mutation.resource.id, mutation.resource);
      if (mutation.kind === 'progress') progress.set(mutation.resource.id, mutation.resource);
      audits.set(`${mutation.kind}:${mutation.event.importKey}`, mutation.event);
      return 'saved';
    },
  };
  const deps: M2mImportUsersDeps = {
    courses: { findById: async (_tenantId, id) => id === course.id ? course : null },
    modules: {
      findById: async (_tenantId, id) => id === module.id ? module : null,
      list: async () => [module],
    },
    lessons: { findById: async (_tenantId, id) => id === lesson.id ? lesson : null },
    products: { findById: async (_tenantId, id) => id === product.id ? product : null },
    importAuditEvents: {
      findLatestByImportKey: async (_tenantId, kind, importKey) =>
        audits.get(`${kind}:${importKey}`) ?? null,
    },
    importUsers,
    ids: { nextId: () => `id-${sequence += 1}` },
    clock: { nowIso: () => NOW },
    hash: { sha256: (content) => String(content) },
  };
  return { deps, authUsers, members, grants, progress, audits, commits };
};

describe('m2m users import', () => {
  it('creates a verified-ready member identity and makes exact replays unchanged', async () => {
    const h = harness();
    const created = await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1',
      records: [memberRecord()],
    }, h.deps);
    const unchanged = await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1',
      records: [memberRecord()],
    }, h.deps);

    expect(created).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(unchanged).toMatchObject({ ok: true, value: { summary: { unchanged: 1 } } });
    expect(h.members.get('member-source')).toMatchObject({
      email: 'user@example.test',
      displayName: 'Jan Kowalski',
    });
    expect(h.commits[0]).toMatchObject({
      kind: 'member',
      authUser: { action: 'create', emailVerified: true },
    });
    expect(h.audits.get('member:member-source')?.payloadHash).not.toContain(MARKER);
  });

  it('attaches an existing tenant owner user without replacing its identity', async () => {
    const h = harness();
    h.authUsers.set('user@example.test', {
      id: 'owner-user',
      email: 'user@example.test',
      hasCredentialAccount: false,
      credentialPassword: null,
    });
    const result = await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1',
      records: [memberRecord(null)],
    }, h.deps);

    expect(result).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(h.members.get('member-source')?.userId).toBe('owner-user');
    expect(h.commits[0]).toMatchObject({ kind: 'member', authUser: { action: 'keep' } });
  });

  it('does not plant a credential while attaching an existing passwordless user', async () => {
    const h = harness();
    h.authUsers.set('user@example.test', {
      id: 'owner-user',
      email: 'user@example.test',
      hasCredentialAccount: false,
      credentialPassword: null,
    });
    const result = await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1',
      records: [memberRecord()],
    }, h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'conflict' } }] },
    });
    expect(h.commits).toEqual([]);
    expect(h.authUsers.get('user@example.test')?.credentialPassword).toBeNull();
  });

  it('allows an import-created member credential to transition from empty to set once', async () => {
    const h = harness();
    await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1',
      records: [memberRecord(null)],
    }, h.deps);
    const updated = await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1',
      records: [memberRecord()],
    }, h.deps);

    expect(updated).toMatchObject({ ok: true, value: { summary: { updated: 1 } } });
    expect(h.authUsers.get('user@example.test')?.credentialPassword).toBe(MARKER);
  });

  it('rejects malformed, plaintext-looking, and replacement credential inputs per record', async () => {
    const h = harness();
    const invalid = await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1',
      records: [
        memberRecord('plaintext-password'),
        memberRecord(MARKER.replace('pbkdf2', 'PBKDF2')),
        { ...memberRecord(null), password: 'secret' },
      ],
    }, h.deps);
    await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1', records: [memberRecord()],
    }, h.deps);
    const replacement = await importM2mUsers(ctx, apiKey, 'member', {
      datasetVersion: 'together-import/v1', records: [memberRecord(OTHER_MARKER)],
    }, h.deps);

    expect(invalid).toMatchObject({ ok: true, value: { summary: { failed: 3 } } });
    expect(replacement).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'conflict' } }] },
    });
    expect(h.authUsers.get('user@example.test')?.credentialPassword).toBe(MARKER);
  });

  it('creates, updates, and replays import grants while rejecting dangling references', async () => {
    const h = harness();
    h.members.set('member-native', {
      id: 'member-native', tenantId: TENANT_ID, userId: 'user-native',
      email: 'native@example.test', displayName: 'Native', legacyId: null, createdAt: NOW,
    });
    const grantRecord = (expiresAt: string | null) => ({
      importKey: 'grant-source',
      memberKey: 'member-native',
      productKey: 'product-native',
      startsAt: '1995-01-01T00:00:00.000Z',
      expiresAt,
    });
    const created = await importM2mUsers(ctx, apiKey, 'grant', {
      datasetVersion: 'together-import/v1', records: [grantRecord(null)],
    }, h.deps);
    const updated = await importM2mUsers(ctx, apiKey, 'grant', {
      datasetVersion: 'together-import/v1',
      records: [grantRecord('1999-01-01T00:00:00.000Z')],
    }, h.deps);
    const unchanged = await importM2mUsers(ctx, apiKey, 'grant', {
      datasetVersion: 'together-import/v1',
      records: [grantRecord('1999-01-01T00:00:00.000Z')],
    }, h.deps);
    const dangling = await importM2mUsers(ctx, apiKey, 'grant', {
      datasetVersion: 'together-import/v1',
      records: [{ ...grantRecord(null), importKey: 'grant-dangling', memberKey: 'missing' }],
    }, h.deps);

    expect(created).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(updated).toMatchObject({ ok: true, value: { summary: { updated: 1 } } });
    expect(unchanged).toMatchObject({ ok: true, value: { summary: { unchanged: 1 } } });
    expect(h.grants.get('grant-source')).toMatchObject({
      source: 'import',
      expiresAt: '1999-01-01T00:00:00.000Z',
    });
    expect(dangling).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'conflict' } }] },
    });
  });

  it('imports minimal completion progress and rejects lessons outside the course', async () => {
    const h = harness();
    h.members.set('member-native', {
      id: 'member-native', tenantId: TENANT_ID, userId: 'user-native',
      email: 'native@example.test', displayName: 'Native', legacyId: null, createdAt: NOW,
    });
    const validRecord = {
      importKey: 'progress-source',
      memberKey: 'member-native',
      courseKey: 'course-native',
      completedLessonKeys: ['lesson-native'],
      lastViewedLessonKey: 'lesson-native',
      lastViewedModuleKey: 'module-native',
      lastViewedChapterId: 'chapter-native',
      updatedAt: '1998-08-01T00:00:00.000Z',
    };
    const created = await importM2mUsers(ctx, apiKey, 'progress', {
      datasetVersion: 'together-import/v1', records: [validRecord],
    }, h.deps);
    const unchanged = await importM2mUsers(ctx, apiKey, 'progress', {
      datasetVersion: 'together-import/v1', records: [validRecord],
    }, h.deps);
    const outside = await importM2mUsers(ctx, apiKey, 'progress', {
      datasetVersion: 'together-import/v1',
      records: [{
        ...validRecord,
        importKey: 'progress-outside',
        completedLessonKeys: ['unattached-lesson'],
      }],
    }, {
      ...h.deps,
      lessons: {
        findById: async (_tenantId, id) => id === 'unattached-lesson'
          ? { ...lesson, id }
          : id === lesson.id ? lesson : null,
      },
    });

    expect(created).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(unchanged).toMatchObject({ ok: true, value: { summary: { unchanged: 1 } } });
    expect(h.progress.get('progress-source')).toMatchObject({
      completedLessonIds: ['lesson-native'],
      lastViewedChapterId: 'chapter-native',
    });
    expect(outside).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'conflict' } }] },
    });
  });

  it('validates mixed users records and in-call references without committing', async () => {
    const h = harness();
    const validationDeps: M2mImportValidationDeps = {
      ...h.deps,
      products: {
        ...h.deps.products,
        listByTenant: async () => [product],
      },
    };
    const result = await validateM2mImportForUsers(ctx, {
      datasetVersion: 'together-import/v1',
      records: [
        {
          kind: 'course', importKey: 'course-source', name: 'Imported course',
          description: '', imageUrl: null, moduleOrder: ['module-source'],
        },
        {
          kind: 'lesson', importKey: 'lesson-source', name: 'Imported lesson',
          isPreview: false, contents: [],
        },
        {
          kind: 'module', importKey: 'module-source', courseKeys: ['course-source'],
          title: 'Imported module', prefix: null, chapters: [{
            id: 'chapter-source',
            name: 'Chapter',
            contents: [{ id: 'content-source', name: 'Lesson', lessonKey: 'lesson-source' }],
          }],
        },
        { kind: 'member', ...memberRecord(null) },
        {
          kind: 'grant',
          importKey: 'grant-source',
          memberKey: 'member-source',
          productKey: 'product-native',
          startsAt: '1998-08-01T00:00:00.000Z',
          expiresAt: null,
        },
        {
          kind: 'progress',
          importKey: 'progress-source',
          memberKey: 'member-source',
          courseKey: 'course-source',
          completedLessonKeys: ['lesson-source'],
          lastViewedModuleKey: 'module-source',
          lastViewedChapterId: 'chapter-source',
          updatedAt: '1998-08-10T00:00:00.000Z',
        },
      ],
    }, validationDeps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        plan: {
          create: { course: 1, lesson: 1, module: 1, member: 1, grant: 1, progress: 1 },
        },
        errors: [],
        valid: true,
      },
    });
    expect(h.commits).toEqual([]);
  });
});
