import { describe, expect, it } from 'vitest';

import type {
  Course,
  CourseLesson,
  CourseModule,
  Post,
  Product,
  Space,
  Tenant,
} from '#core/domain/index.js';

import {
  getPublicCourseStructure,
  getPublicNavigation,
  getPublicSpaceFeed,
  getPublicSpaceThread,
  type PublicCourseStructureDeps,
  type PublicNavigationDeps,
  type PublicSpaceDeps,
} from './public-surface.js';

const tenant: Tenant = {
  id: 't1',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'hosted',
  contentVersion: 3,
};

const space = (input: {
  id: string;
  publicReadOnly: boolean;
  visibility?: Space['visibility'];
  productIds?: string[];
  position?: number;
  archivedAt?: string | null;
}): Space => ({
  id: input.id,
  tenantId: tenant.id,
  slug: input.id,
  name: `Space ${input.id}`,
  description: `About ${input.id}`,
  visibility: input.visibility ?? 'members',
  productIds: input.productIds ?? [],
  publicReadOnly: input.publicReadOnly,
  position: input.position ?? 0,
  archivedAt: input.archivedAt ?? null,
  createdAt: '1998-01-01T00:00:00.000Z',
});

const course = (id: string, publiclyVisible: boolean): Course => ({
  id,
  tenantId: tenant.id,
  name: `Course ${id}`,
  description: `About ${id}`,
  imageUrl: null,
  moduleOrder: [`module-${id}`],
  publiclyVisible,
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
});

const lesson = (id: string, isPreview: boolean): CourseLesson => ({
  id,
  tenantId: tenant.id,
  name: `Lesson ${id}`,
  isPreview,
  contents: [],
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
});

const courseModule = (courseId: string, lessonIds: string[]): CourseModule => ({
  id: `module-${courseId}`,
  tenantId: tenant.id,
  courseIds: [courseId],
  title: `Module ${courseId}`,
  prefix: null,
  name: `Module ${courseId}`,
  chapters: [{
    id: `chapter-${courseId}`,
    name: `Chapter ${courseId}`,
    contents: lessonIds.map((lessonId) => ({
      id: `content-${lessonId}`,
      name: `Lesson ${lessonId}`,
      lessonId,
    })),
  }],
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
});

const product = (id: string, lessonIds: string[], courseId: string): Product => ({
  id,
  tenantId: tenant.id,
  type: 'course',
  slug: id,
  title: `Product ${id}`,
  description: '',
  coverUrl: null,
  priceCents: 5000,
  currency: 'PLN',
  published: true,
  accessItems: [{ level: 'lessons', courseId, lessonIds }],
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
});

const post = (input: {
  id: string;
  contextId: string;
  rootPostId?: string;
  parentPostId?: string | null;
  pinnedAt?: string | null;
}): Post => ({
  id: input.id,
  tenantId: tenant.id,
  contextKind: 'space',
  contextId: input.contextId,
  parentPostId: input.parentPostId ?? null,
  rootPostId: input.rootPostId ?? input.id,
  authorUserId: 'author-user',
  authorDisplay: 'Author',
  authorIsStaff: false,
  body: `Body ${input.id}`,
  createdAt: '1998-01-01T00:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: input.pinnedAt ?? null,
});

const navigationDeps = (input: {
  spaces: Space[];
  courses?: Course[];
  products?: Product[];
  defaultHomeSpaceId?: string | null;
}): PublicNavigationDeps => ({
  spaces: { list: async () => input.spaces.filter((row) => row.archivedAt === null) },
  courses: { list: async () => input.courses ?? [] },
  products: { listPublishedByTenant: async () => input.products ?? [] },
  tenants: {
    findSettings: async () => ({
      name: tenant.name,
      socialLinks: [],
      billingPortalUrl: null,
      bunnyStreamLibraryId: null,
      bunnyStreamCdnHostname: null,
      logoUrl: null,
      accentColor: null,
      faviconUrl: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      supportEmail: null,
      supportUrl: null,
      termsUrl: null,
      privacyUrl: null,
      defaultHomeSpaceId: input.defaultHomeSpaceId ?? null,
    }),
  },
});

const structureDeps = (input: {
  courses: Course[];
  modules: CourseModule[];
  lessons: CourseLesson[];
  products?: Product[];
}): PublicCourseStructureDeps => ({
  courses: { findById: async (_tenantId, id) => input.courses.find((row) => row.id === id) ?? null },
  modules: { list: async () => input.modules },
  lessons: { list: async () => input.lessons },
  products: { listPublishedByTenant: async () => input.products ?? [] },
});

const spaceDeps = (input: {
  spaces: Space[];
  posts?: Post[];
  pinned?: Post[];
  replies?: Post[];
}): PublicSpaceDeps => ({
  spaces: { findById: async (_tenantId, id) => input.spaces.find((row) => row.id === id) ?? null },
  posts: {
    findById: async (_tenantId, id) => (input.posts ?? []).find((row) => row.id === id) ?? null,
    listThreadsForContext: async (_tenantId, query) => ({
      threads: (input.posts ?? [])
        .filter((row) => row.contextId === query.contextId && row.parentPostId === null)
        .map((row) => ({ post: row, replyCount: 2 })),
      nextCursor: null,
    }),
    listPinnedForContext: async () => input.pinned ?? [],
    listReplies: async (_tenantId, rootPostId) =>
      (input.replies ?? []).filter((row) => row.rootPostId === rootPostId),
  },
  reactions: {
    summarize: async (_tenantId, query) =>
      new Map(
        query.postIds.map((postId) => [
          postId,
          [{ emoji: '👍' as const, count: 2, viewerReacted: query.viewerUserId === 'author-user' }],
        ]),
      ),
  },
});

describe('getPublicNavigation', () => {
  it('lists publicly readable spaces by position and publicly visible courses', async () => {
    const result = await getPublicNavigation(
      tenant,
      navigationDeps({
        spaces: [
          space({ id: 'second', publicReadOnly: true, position: 2 }),
          space({ id: 'first', publicReadOnly: true, position: 1 }),
          space({ id: 'members', publicReadOnly: false }),
        ],
        courses: [course('open', true), course('hidden', false)],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        spaces: [{ id: 'first' }, { id: 'second' }],
        courses: [{ id: 'open', name: 'Course open', description: 'About open', imageUrl: null }],
        lockedSpaces: [],
      },
    });
  });

  it('advertises only product-gated spaces backed by a published product', async () => {
    const result = await getPublicNavigation(
      tenant,
      navigationDeps({
        spaces: [
          space({ id: 'sellable', publicReadOnly: false, visibility: 'product', productIds: ['p1'] }),
          space({ id: 'draft-gated', publicReadOnly: false, visibility: 'product', productIds: ['p2'] }),
          space({ id: 'members', publicReadOnly: false }),
        ],
        products: [product('p1', [], 'open')],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { lockedSpaces: [{ id: 'sellable', productIds: ['p1'] }] },
    });
  });

  it('resolves the configured home space and falls back to the first public space', async () => {
    const spaces = [
      space({ id: 'second', publicReadOnly: true, position: 2 }),
      space({ id: 'first', publicReadOnly: true, position: 1 }),
    ];

    expect(
      await getPublicNavigation(tenant, navigationDeps({ spaces, defaultHomeSpaceId: 'second' })),
    ).toMatchObject({ ok: true, value: { defaultHomeSpaceId: 'second' } });

    expect(
      await getPublicNavigation(tenant, navigationDeps({ spaces, defaultHomeSpaceId: 'members' })),
    ).toMatchObject({ ok: true, value: { defaultHomeSpaceId: 'first' } });

    expect(
      await getPublicNavigation(tenant, navigationDeps({ spaces: [], defaultHomeSpaceId: 'first' })),
    ).toMatchObject({ ok: true, value: { defaultHomeSpaceId: null, spaces: [] } });
  });
});

describe('getPublicCourseStructure', () => {
  const open = course('open', true);
  const hidden = course('hidden', false);
  const modules = [courseModule('open', ['preview', 'paid'])];
  const courseLessons = [lesson('preview', true), lesson('paid', false)];

  it('unlocks preview lessons and keeps the rest behind their upsell product', async () => {
    const result = await getPublicCourseStructure(
      tenant,
      open.id,
      structureDeps({
        courses: [open],
        modules,
        lessons: courseLessons,
        products: [product('p1', ['paid'], open.id)],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        courseId: open.id,
        accessStatus: 'partially-accessible',
        modules: [{
          accessStatus: 'partially-accessible',
          chapters: [{
            accessStatus: 'partially-accessible',
            lessons: [
              { lessonId: 'preview', accessStatus: 'fully-accessible' },
              { lessonId: 'paid', accessStatus: 'not-accessible', unlockProductId: 'p1' },
            ],
          }],
        }],
      },
    });
  });

  it('answers not_found for missing and non-public courses alike', async () => {
    const deps = structureDeps({ courses: [hidden], modules: [], lessons: [] });

    expect(await getPublicCourseStructure(tenant, hidden.id, deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await getPublicCourseStructure(tenant, 'absent', deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

describe('getPublicSpaceFeed', () => {
  const open = space({ id: 'open', publicReadOnly: true });

  it('projects the feed without a viewer', async () => {
    const pinned = post({ id: 'pinned', contextId: open.id, pinnedAt: '1998-02-01T00:00:00.000Z' });
    const thread = post({ id: 'thread', contextId: open.id });
    const result = await getPublicSpaceFeed(
      tenant,
      { spaceId: open.id },
      spaceDeps({
        spaces: [open],
        posts: [pinned, thread],
        pinned: [pinned],
        replies: [post({ id: 'reply', contextId: open.id, rootPostId: 'pinned', parentPostId: 'pinned' })],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        spaceId: open.id,
        isFollowing: false,
        pinned: [{ id: 'pinned', isOwn: false, replyCount: 1, reactions: [{ viewerReacted: false }] }],
        items: [{ id: 'thread', isOwn: false, replyCount: 2 }],
        nextCursor: null,
      },
    });
  });

  it('answers not_found for private, archived and unknown spaces', async () => {
    const deps = spaceDeps({
      spaces: [
        space({ id: 'private', publicReadOnly: false }),
        space({ id: 'retired', publicReadOnly: true, archivedAt: '1998-02-01T00:00:00.000Z' }),
      ],
    });

    for (const spaceId of ['private', 'retired', 'absent']) {
      expect(await getPublicSpaceFeed(tenant, { spaceId }, deps)).toMatchObject({
        ok: false,
        error: { code: 'not_found' },
      });
    }
  });

  it('rejects a malformed feed query', async () => {
    const result = await getPublicSpaceFeed(tenant, { spaceId: '' }, spaceDeps({ spaces: [open] }));

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('getPublicSpaceThread', () => {
  const open = space({ id: 'open', publicReadOnly: true });
  const root = post({ id: 'root', contextId: open.id });
  const reply = post({ id: 'reply', contextId: open.id, rootPostId: 'root', parentPostId: 'root' });
  const nested = post({ id: 'nested', contextId: open.id, rootPostId: 'root', parentPostId: 'reply' });

  it('returns the thread with nested replies and no viewer state', async () => {
    const result = await getPublicSpaceThread(
      tenant,
      { spaceId: open.id, postId: root.id },
      spaceDeps({ spaces: [open], posts: [root], replies: [reply, nested] }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        nextCursor: null,
        viewerSubscriptions: {},
        threads: [{
          id: 'root',
          isOwn: false,
          replyCount: 2,
          replies: [{ id: 'reply', replyCount: 1, replies: [{ id: 'nested' }] }],
        }],
      },
    });
  });

  it('answers not_found for a post that is not a root of the requested space', async () => {
    const deps = spaceDeps({
      spaces: [open, space({ id: 'other', publicReadOnly: true })],
      posts: [post({ id: 'elsewhere', contextId: 'other' }), reply],
    });

    expect(
      await getPublicSpaceThread(tenant, { spaceId: open.id, postId: 'elsewhere' }, deps),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(
      await getPublicSpaceThread(tenant, { spaceId: open.id, postId: reply.id }, deps),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(
      await getPublicSpaceThread(tenant, { spaceId: open.id, postId: 'absent' }, deps),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects a malformed thread query', async () => {
    const result = await getPublicSpaceThread(
      tenant,
      { spaceId: open.id },
      spaceDeps({ spaces: [open] }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('anonymous avatar boundary', () => {
  const open = space({ id: 'open', publicReadOnly: true });
  const root = post({ id: 'root', contextId: open.id });
  const reply = post({ id: 'reply', contextId: open.id, rootPostId: 'root', parentPostId: 'root' });

  it('never emits an avatar url on the public feed or thread', async () => {
    const deps = spaceDeps({ spaces: [open], posts: [root], replies: [reply] });
    const feed = await getPublicSpaceFeed(tenant, { spaceId: open.id }, deps);
    const thread = await getPublicSpaceThread(tenant, { spaceId: open.id, postId: root.id }, deps);

    expect(feed).toMatchObject({ ok: true, value: { items: [{ authorAvatarUrl: null }] } });
    expect(thread).toMatchObject({
      ok: true,
      value: { threads: [{ authorAvatarUrl: null, replies: [{ authorAvatarUrl: null }] }] },
    });
    expect(JSON.stringify([feed, thread])).not.toContain('gravatar.com');
  });
});
