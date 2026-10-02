import { describe, expect, it } from 'vitest';

import type {
  Course,
  CourseLesson,
  CourseModule,
  Identity,
  TenantAuditEventInput,
  TenantRedirect,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import {
  createTenantRedirect,
  deleteTenantRedirect,
  listTenantRedirects,
  updateTenantRedirect,
  type TenantRedirectWriteDeps,
} from './tenant-redirects.js';

const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-acme';

const identity: Identity = {
  userId: 'user-owner',
  email: 'owner@together.dev',
  name: 'Owner',
  emailVerified: true,
  tenantAccess: 'staff',
  tenantId: TENANT_ID,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
};

const ctx: Ctx = { identity };
const adminCtx: Ctx = { identity: { ...identity, staffRole: 'admin' } };

const course: Course = {
  id: 'course-js',
  tenantId: TENANT_ID,
  name: 'Course',
  description: '',
  imageUrl: null,
  moduleOrder: ['module-basics'],
  publiclyVisible: false,
  legacyId: null,
  createdAt: NOW,
};

const lesson: CourseLesson = {
  id: 'lesson-intro',
  tenantId: TENANT_ID,
  name: 'Lesson',
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: NOW,
};

const orphanLesson: CourseLesson = { ...lesson, id: 'lesson-orphan' };

const courseModule: CourseModule = {
  id: 'module-basics',
  tenantId: TENANT_ID,
  courseIds: [course.id],
  title: 'Module',
  prefix: null,
  name: 'Module',
  chapters: [{
    id: 'chapter-1',
    name: 'Chapter',
    contents: [{ id: 'content-1', name: 'Lesson', lessonId: lesson.id }],
  }],
  legacyId: null,
  createdAt: NOW,
};

const redirectFixture = (overrides: Partial<TenantRedirect> = {}): TenantRedirect => ({
  id: 'redirect-import',
  tenantId: TENANT_ID,
  fromPath: '/legacy/one',
  targetKind: 'path',
  targetId: null,
  targetPath: '/my',
  targetAnchor: null,
  permanent: true,
  locked: false,
  hitCount: 0,
  lastHitAt: null,
  origin: 'import',
  createdBy: null,
  createdAt: NOW,
  ...overrides,
});

const harness = (seed: TenantRedirect[] = []) => {
  const redirects = new Map(seed.map((redirect) => [redirect.id, redirect]));
  const audit: TenantAuditEventInput[] = [];
  let sequence = 0;
  const deps: TenantRedirectWriteDeps = {
    redirects: {
      findById: async (_tenantId, id) => redirects.get(id) ?? null,
      findByFromPath: async (_tenantId, fromPath) =>
        [...redirects.values()].find((redirect) => redirect.fromPath === fromPath) ?? null,
      listPage: async (_tenantId, query) => {
        const matching = [...redirects.values()]
          .filter((redirect) =>
            query.search === undefined
            || redirect.fromPath.includes(query.search)
            || redirect.targetPath.includes(query.search))
          .sort((left, right) => left.fromPath.localeCompare(right.fromPath));
        return {
          redirects: matching.slice(query.offset, query.offset + query.limit),
          total: matching.length,
        };
      },
      create: async (_tenantId, redirect) => {
        if ([...redirects.values()].some((entry) => entry.fromPath === redirect.fromPath)) {
          return 'path_taken';
        }
        redirects.set(redirect.id, redirect);
        return 'saved';
      },
      update: async (_tenantId, redirect) => {
        if (!redirects.has(redirect.id)) return null;
        redirects.set(redirect.id, redirect);
        return redirect;
      },
      deleteById: async (_tenantId, id) => redirects.delete(id),
      incrementHit: async () => undefined,
    },
    courses: { findById: async (_tenantId, id) => id === course.id ? course : null },
    modules: { list: async () => [courseModule] },
    lessons: {
      findById: async (_tenantId, id) =>
        id === lesson.id ? lesson : id === orphanLesson.id ? orphanLesson : null,
    },
    auditEvents: {
      list: async () => ({ events: [], nextCursor: null }),
      record: async (_tenantId, event) => { audit.push(event); },
    },
    ids: { nextId: () => `id-${String(sequence += 1)}` },
    clock: { nowIso: () => NOW },
  };
  return { deps, redirects, audit };
};

describe('tenant redirect management', () => {
  it('normalises the source path and resolves a course target', async () => {
    const h = harness();

    const result = await createTenantRedirect(
      ctx,
      { fromPath: '/Course/JavaScript/', target: { kind: 'course', courseId: course.id }, permanent: true },
      h.deps,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        fromPath: '/course/javascript',
        targetKind: 'course',
        targetId: course.id,
        targetPath: `/my/courses/${course.id}`,
        origin: 'manual',
        createdBy: identity.userId,
      },
    });
    expect(h.audit).toMatchObject([{ kind: 'redirect_created', actorUserId: identity.userId }]);
  });

  it('resolves a lesson target inside its course', async () => {
    const h = harness();

    const result = await createTenantRedirect(
      ctx,
      {
        fromPath: '/course/javascript/intro',
        target: { kind: 'lesson', courseId: course.id, lessonId: lesson.id, anchor: 'wiring' },
        permanent: false,
      },
      h.deps,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        targetKind: 'lesson',
        targetPath: `/my/courses/${course.id}/lessons/${lesson.id}`,
        targetAnchor: 'wiring',
      },
    });
  });

  it('retargets in place while keeping identity, source, counts, and creation time', async () => {
    const original = redirectFixture({
      id: 'redirect-print',
      fromPath: '/printed/guide',
      hitCount: 27,
      lastHitAt: '2026-10-01T10:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const h = harness([original]);

    const result = await updateTenantRedirect(ctx, {
      id: original.id,
      target: { kind: 'lesson', courseId: course.id, lessonId: lesson.id, anchor: 'safety' },
      permanent: false,
      locked: true,
    }, h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: original.id,
        fromPath: original.fromPath,
        hitCount: 27,
        lastHitAt: original.lastHitAt,
        createdAt: original.createdAt,
        targetAnchor: 'safety',
        permanent: false,
        locked: true,
      },
    });
    expect(h.audit).toMatchObject([{
      kind: 'redirect_updated',
      reason: '/my to /my/courses/course-js/lessons/lesson-intro#safety',
    }]);
  });

  it('keeps an imported module target when its resolved course does not change', async () => {
    const original = redirectFixture({
      targetKind: 'module-as-course',
      targetId: courseModule.id,
      targetPath: `/my/courses/${course.id}`,
    });
    const h = harness([original]);

    expect(await updateTenantRedirect(ctx, {
      id: original.id,
      target: { kind: 'course', courseId: course.id },
      permanent: false,
      locked: false,
    }, h.deps)).toMatchObject({
      ok: true,
      value: { targetKind: 'module-as-course', targetId: courseModule.id },
    });
  });

  it('refuses to delete a locked redirect but lets the owner unlock it', async () => {
    const locked = redirectFixture({ locked: true });
    const h = harness([locked]);

    expect(await deleteTenantRedirect(ctx, { id: locked.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', message: 'Locked redirects cannot be deleted' } });
    expect(await updateTenantRedirect(ctx, {
      id: locked.id,
      target: { kind: 'path', path: '/new-target' },
      permanent: true,
      locked: false,
    }, h.deps)).toMatchObject({ ok: true, value: { locked: false } });
  });

  it('requires the tenant settings write capability for updates', async () => {
    const redirect = redirectFixture();
    const h = harness([redirect]);

    expect(await updateTenantRedirect(adminCtx, {
      id: redirect.id,
      target: { kind: 'path', path: '/new-target' },
      permanent: true,
      locked: true,
    }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('refuses a lesson that belongs to no module of the chosen course', async () => {
    const h = harness();

    const result = await createTenantRedirect(
      ctx,
      {
        fromPath: '/course/javascript/obcy',
        target: { kind: 'lesson', courseId: course.id, lessonId: orphanLesson.id },
        permanent: false,
      },
      h.deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.redirects.size).toBe(0);
  });

  it('refuses a source path that is not a path at all', async () => {
    const h = harness();

    const result = await createTenantRedirect(
      ctx,
      { fromPath: '/\\evil.example', target: { kind: 'path', path: '/my' }, permanent: false },
      h.deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('refuses a redirect that points at its own source path', async () => {
    const h = harness();

    const result = await createTenantRedirect(
      ctx,
      { fromPath: '/offer', target: { kind: 'path', path: '/offer' }, permanent: false },
      h.deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.redirects.size).toBe(0);
  });

  it('refuses a target that only differs from its source before normalisation', async () => {
    const h = harness();

    for (const path of ['/offer/', '/Offer']) {
      expect(await createTenantRedirect(
        ctx,
        { fromPath: '/offer', target: { kind: 'path', path }, permanent: true },
        h.deps,
      )).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(h.redirects.size).toBe(0);
  });

  it('refuses a source path the platform serves itself', async () => {
    const h = harness();

    for (const fromPath of ['/panel', '/My/courses/course-js', '/api/health']) {
      expect(await createTenantRedirect(
        ctx,
        { fromPath, target: { kind: 'path', path: '/offer' }, permanent: true },
        h.deps,
      )).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(h.redirects.size).toBe(0);
  });

  it('refuses a source path that normalises to the workspace root', async () => {
    const h = harness();

    for (const fromPath of ['/', '///', '#anchor', '?ref=x']) {
      expect(await createTenantRedirect(
        ctx,
        { fromPath, target: { kind: 'path', path: '/offer' }, permanent: true },
        h.deps,
      )).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(h.redirects.size).toBe(0);
  });

  it('refuses a source path an existing redirect already answers', async () => {
    const h = harness([redirectFixture({ fromPath: '/legacy/one' })]);

    const result = await createTenantRedirect(
      ctx,
      { fromPath: '/Legacy/One', target: { kind: 'path', path: '/my' }, permanent: false },
      h.deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.redirects.size).toBe(1);
  });

  it('deletes a redirect of either origin and records the deletion', async () => {
    const h = harness([
      redirectFixture(),
      redirectFixture({ id: 'redirect-manual', fromPath: '/legacy/two', origin: 'manual' }),
    ]);

    expect(await deleteTenantRedirect(ctx, { id: 'redirect-import' }, h.deps))
      .toMatchObject({ ok: true, value: { id: 'redirect-import' } });
    expect(await deleteTenantRedirect(ctx, { id: 'redirect-manual' }, h.deps))
      .toMatchObject({ ok: true });
    expect(h.redirects.size).toBe(0);
    expect(h.audit.map((event) => event.kind)).toEqual(['redirect_deleted', 'redirect_deleted']);
  });

  it('reports a missing redirect as not found', async () => {
    const h = harness();

    expect(await deleteTenantRedirect(ctx, { id: 'redirect-absent' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('pages and searches the list ordered by source path', async () => {
    const h = harness([
      redirectFixture({ id: 'r-1', fromPath: '/b-second' }),
      redirectFixture({ id: 'r-2', fromPath: '/a-first' }),
      redirectFixture({ id: 'r-3', fromPath: '/c-third', targetPath: '/my/needle' }),
    ]);

    expect(await listTenantRedirects(ctx, { limit: 2, offset: 0 }, h.deps)).toMatchObject({
      ok: true,
      value: { total: 3, redirects: [{ fromPath: '/a-first' }, { fromPath: '/b-second' }] },
    });
    expect(await listTenantRedirects(ctx, { limit: 2, offset: 2 }, h.deps)).toMatchObject({
      ok: true,
      value: { total: 3, redirects: [{ fromPath: '/c-third' }] },
    });
    expect(await listTenantRedirects(ctx, { limit: 50, offset: 0, search: 'needle' }, h.deps))
      .toMatchObject({ ok: true, value: { total: 1 } });
  });

  it('lets an admin list but reserves writing for the owner', async () => {
    const h = harness([redirectFixture()]);

    expect(await listTenantRedirects(adminCtx, { limit: 50, offset: 0 }, h.deps))
      .toMatchObject({ ok: true, value: { total: 1 } });
    expect(await createTenantRedirect(
      adminCtx,
      { fromPath: '/legacy/two', target: { kind: 'path', path: '/my' }, permanent: false },
      h.deps,
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await deleteTenantRedirect(adminCtx, { id: 'redirect-import' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.redirects.size).toBe(1);
  });

  it('refuses every operation without a tenant', async () => {
    const h = harness();
    const noTenant: Ctx = { identity: { ...identity, tenantId: null } };

    expect(await listTenantRedirects(noTenant, { limit: 50, offset: 0 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
    expect(await createTenantRedirect(
      noTenant,
      { fromPath: '/legacy/two', target: { kind: 'path', path: '/my' }, permanent: false },
      h.deps,
    )).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
