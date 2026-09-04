import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  err,
  internal,
  notFound,
  ok,
  tenantSettingsSchema,
  type AppError,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type Product,
  type ProductGrant,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  MemberCourseProgressRepository,
  ProductGrantRepository,
  ProductRepository,
  TenantRepository,
  TenantSecretResolver,
} from '../ports.js';
import {
  DEFAULT_PLAYBACK_TOKEN_TTL_SECONDS,
  getLessonPlayback,
  type LessonPlaybackDeps,
} from './lesson-playback.js';

const NOW = '1998-08-07T12:00:00.000Z';
const VIDEO_ID = 'video-1';
const EMBED_URL = 'https://player.vimeo.com/video/123456';

const identity = (over: Partial<Identity> = {}): Identity => ({
  userId: 'u1',
  email: 'member@together.dev',
  name: 'Member',
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'mem1',
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  ...over,
});

const ctx = (over: Partial<Identity> = {}): Ctx => ({ identity: identity(over) });

const lesson: CourseLesson = {
  id: 'l1',
  tenantId: 't1',
  name: 'Playback lesson',
  isPreview: false,
  contents: [
    {
      type: 'video',
      storageKey: 'videos/one',
      streamLibraryId: 'lib-1',
      streamVideoId: VIDEO_ID,
    },
  ],
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
};

const module: CourseModule = {
  id: 'm1',
  tenantId: 't1',
  courseIds: ['c1'],
  title: 'Module 1',
  prefix: null,
  name: computeCourseModuleName(null, 'Module 1'),
  chapters: [
    { id: 'ch1', name: 'Chapter 1', contents: [{ id: 'entry-1', name: 'Lesson', lessonId: 'l1' }] },
  ],
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
};

const course: Course = {
  id: 'c1',
  tenantId: 't1',
  name: 'Course 1',
  description: '',
  imageUrl: null,
  moduleOrder: ['m1'],
  publiclyVisible: false,
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
};

const product: Product = {
  id: 'p1',
  tenantId: 't1',
  type: 'course',
  slug: 'course-1',
  title: 'Course 1',
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems: [{ level: 'course', courseId: 'c1' }],
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
};

const grant: ProductGrant = {
  id: 'g1',
  tenantId: 't1',
  memberId: 'mem1',
  productId: 'p1',
  source: 'manual',
  startsAt: '1998-01-01T00:00:00.000Z',
  expiresAt: null,
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
};

const courses: CourseRepository = {
  list: async () => [course],
  findById: async (_tenantId, id) => (id === course.id ? course : null),
  findByIds: async () => [course],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const modules: CourseModuleRepository = {
  list: async () => [module],
  findById: async (_tenantId, id) => (id === module.id ? module : null),
  findByIds: async () => [module],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const lessonRepository = (value: CourseLesson | null): CourseLessonRepository => ({
  list: async () => (value === null ? [] : [value]),
  listPreviews: async () => [],
  findById: async (_tenantId, id) => (value?.id === id ? value : null),
  findByIds: async () => (value === null ? [] : [value]),
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
});

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

const products: ProductRepository = {
  listByTenant: async () => [product],
  listPublishedByTenant: async () => [product],
  findById: async () => product,
  create: async () => 'created',
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
};

const grants = (entitled: boolean): ProductGrantRepository => ({
  findById: async () => null,
  findGrant: async () => null,
  createGrant: async () => true,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async () => (entitled ? [grant] : []),
  listGrantedProducts: async () => (entitled ? [product] : []),
});

const settings = (cdnHostname: string | null) => tenantSettingsSchema.parse({
  name: 'Acme',
  billingPortalUrl: null,
  bunnyStreamLibraryId: 'lib-1',
  bunnyStreamCdnHostname: cdnHostname,
});

interface Recording {
  secretCalls: number;
  embedCalls: number;
  hlsCalls: number;
}

const dependencies = (over: {
  lesson?: CourseLesson | null;
  entitled?: boolean;
  secret?: Result<string, AppError>;
  cdnHostname?: string | null;
  ttl?: number;
} = {}): { deps: LessonPlaybackDeps; recording: Recording } => {
  const recording: Recording = { secretCalls: 0, embedCalls: 0, hlsCalls: 0 };
  const secretResolver: TenantSecretResolver = {
    resolve: async () => {
      recording.secretCalls += 1;
      return over.secret ?? ok('security-key');
    },
  };
  const tenants: TenantRepository = {
    findById: async () => null,
    findBySlug: async () => null,
    findSole: async () => null,
    hasAny: async () => false,
    findSettings: async () => settings(over.cdnHostname === undefined ? 'vz-demo.b-cdn.net' : over.cdnHostname),
    updateSettings: async (_tenantId, value) => value,
    createTenantWithOwnerGrant: async () => null,
  };
  return {
    recording,
    deps: {
      grants: grants(over.entitled ?? true),
      courses,
      modules,
      lessons: lessonRepository(over.lesson === undefined ? lesson : over.lesson),
      progress,
      products,
      clock: { nowIso: () => NOW },
      tenants,
      secretResolver,
      bunnyTokenSigner: {
        signEmbedToken: ({ videoId, expires }) => {
          recording.embedCalls += 1;
          return `embed-${videoId}-${expires}`;
        },
        signHlsPlaylistUrl: ({ cdnHostname, videoId, expires }) => {
          recording.hlsCalls += 1;
          return `https://${cdnHostname}/${videoId}/playlist.m3u8?expires=${expires}`;
        },
      },
      playbackTokenTtlSeconds: over.ttl ?? DEFAULT_PLAYBACK_TOKEN_TTL_SECONDS,
    },
  };
};

describe('getLessonPlayback', () => {
  it('returns signed embed and HLS URLs with one shared expiry', async () => {
    const { deps, recording } = dependencies();
    const result = await getLessonPlayback(ctx(), lesson.id, deps);
    if (!result.ok) throw new Error(result.error.message);

    const expires = Math.floor(Date.parse(NOW) / 1000) + DEFAULT_PLAYBACK_TOKEN_TTL_SECONDS;
    expect(result.value).toEqual({
      lessonId: lesson.id,
      expiresAt: new Date(expires * 1000).toISOString(),
      videos: [{
        kind: 'bunny',
        storageKey: 'videos/one',
        videoId: VIDEO_ID,
        libraryId: 'lib-1',
        embedUrl: `https://iframe.mediadelivery.net/embed/lib-1/${VIDEO_ID}?token=embed-${VIDEO_ID}-${expires}&expires=${expires}`,
        hlsUrl: `https://vz-demo.b-cdn.net/${VIDEO_ID}/playlist.m3u8?expires=${expires}`,
        signed: true,
      }],
    });
    expect(recording).toEqual({ secretCalls: 1, embedCalls: 1, hlsCalls: 1 });
  });

  it('rejects a non-entitled member before resolving or signing', async () => {
    const { deps, recording } = dependencies({ entitled: false });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('forbidden');
    expect(recording).toEqual({ secretCalls: 0, embedCalls: 0, hlsCalls: 0 });
  });

  it('returns not_found for an unknown lesson', async () => {
    const { deps } = dependencies({ lesson: null });
    const result = await getLessonPlayback(ctx(), 'missing', deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_found');
  });

  it('allows a preview lesson without a grant', async () => {
    const { deps } = dependencies({ lesson: { ...lesson, isPreview: true }, entitled: false });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);

    expect(result.ok).toBe(true);
  });

  it('allows staff without a member grant', async () => {
    const { deps } = dependencies({ entitled: false });
    const result = await getLessonPlayback(
      ctx({ staffRole: 'owner', memberId: null }),
      lesson.id,
      deps,
    );

    expect(result.ok).toBe(true);
  });

  it('returns unsigned embeds when the security key is absent', async () => {
    const { deps, recording } = dependencies({ secret: err(notFound('missing key')) });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.videos).toEqual([{
      kind: 'bunny',
      storageKey: 'videos/one',
      videoId: VIDEO_ID,
      libraryId: 'lib-1',
      embedUrl: `https://iframe.mediadelivery.net/embed/lib-1/${VIDEO_ID}`,
      hlsUrl: null,
      signed: false,
    }]);
    expect(recording).toEqual({ secretCalls: 1, embedCalls: 0, hlsCalls: 0 });
  });

  it('propagates non-not_found secret failures unchanged', async () => {
    const failure = internal('secret store failed');
    const { deps } = dependencies({ secret: err(failure) });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);

    expect(result).toEqual(err(failure));
  });

  it('returns a signed embed without HLS when the CDN hostname is absent', async () => {
    const { deps, recording } = dependencies({ cdnHostname: null });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.videos[0]).toMatchObject({ kind: 'bunny', signed: true, hlsUrl: null });
    expect(recording).toEqual({ secretCalls: 1, embedCalls: 1, hlsCalls: 0 });
  });

  it('preserves external and Bunny block order', async () => {
    const mixedLesson: CourseLesson = {
      ...lesson,
      contents: [
        { type: 'embed', embedUrl: EMBED_URL },
        ...lesson.contents,
      ],
    };
    const { deps } = dependencies({ lesson: mixedLesson });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.videos[0]).toEqual({ kind: 'external', embedUrl: EMBED_URL });
    expect(result.value.videos[1]).toMatchObject({ kind: 'bunny', videoId: VIDEO_ID });
  });

  it('marks video blocks without a library id unavailable', async () => {
    const unavailableLesson: CourseLesson = {
      ...lesson,
      contents: [{ type: 'video', storageKey: 'videos/missing', streamVideoId: VIDEO_ID }],
    };
    const { deps, recording } = dependencies({ lesson: unavailableLesson });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.videos).toEqual([{
      kind: 'unavailable',
      storageKey: 'videos/missing',
      reason: 'missing_library_id',
    }]);
    expect(recording).toEqual({ secretCalls: 0, embedCalls: 0, hlsCalls: 0 });
  });

  it('returns an empty list when the lesson has no playable blocks', async () => {
    const { deps } = dependencies({
      lesson: { ...lesson, contents: [{ type: 'html', html: '<p>Notes</p>' }] },
    });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.videos).toEqual([]);
  });

  it('uses the configured TTL in every signed URL', async () => {
    const { deps } = dependencies({ ttl: 60 });
    const result = await getLessonPlayback(ctx(), lesson.id, deps);
    if (!result.ok) throw new Error(result.error.message);

    const expires = Math.floor(Date.parse(NOW) / 1000) + 60;
    expect(result.value.expiresAt).toBe(new Date(expires * 1000).toISOString());
    expect(result.value.videos[0]).toMatchObject({
      embedUrl: expect.stringContaining(`expires=${expires}`),
      hlsUrl: expect.stringContaining(`expires=${expires}`),
    });
  });
});
