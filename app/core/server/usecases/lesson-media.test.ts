import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  err,
  internal,
  notFound,
  ok,
  validation,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type Product,
  type ProductGrant,
  type TenantSettings,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  StorageProvider,
  MemberCourseProgressRepository,
  ProductGrantRepository,
  ProductRepository,
  TenantRepository,
  TenantSecretResolver,
} from '../ports.js';
import {
  BUNNY_EMBED_URL_TTL_SECONDS,
  getPlayableLesson,
  PDF_URL_TTL_SECONDS,
  type PlayableLessonDeps,
} from './lesson-media.js';

const NOW = '2026-06-01T00:00:00.000Z';
const S3_PDF_URL =
  'https://legacy-pdf-bucket-example.s3.eu-central-1.amazonaws.com/pdf-files/handout.pdf';
const PUBLIC_PDF_URL = 'https://cdn.example.com/files/handout.pdf';

const identity = (over: Partial<Identity>): Identity => ({
  userId: 'u1',
  email: 'member@together.dev',
  name: 'Member',
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'mem1',
  memberBannedAt: null,
  ...over,
});

const ctx = (over: Partial<Identity> = {}): Ctx => ({ identity: identity(over) });

const pdfLesson: CourseLesson = {
  id: 'l1',
  tenantId: 't1',
  name: 'Lesson with documents',
  isPreview: false,
  contents: [
    { type: 'pdf', pdfUrl: S3_PDF_URL, name: 'Handout' },
    { type: 'pdf', pdfUrl: PUBLIC_PDF_URL },
    { type: 'html', html: '<p>Notes</p>' },
  ],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const m1: CourseModule = {
  id: 'm1',
  tenantId: 't1',
  courseIds: ['c1'],
  title: 'Module m1',
  prefix: null,
  name: computeCourseModuleName(null, 'Module m1'),
  chapters: [
    { id: 'ch1', name: 'Chapter 1', contents: [{ id: 'c-l1', name: 'C L1', lessonId: 'l1' }] },
  ],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const c1: Course = {
  id: 'c1',
  tenantId: 't1',
  name: 'Course c1',
  description: '',
  imageUrl: null,
  moduleOrder: ['m1'],
  publiclyVisible: false,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const pCourse: Product = {
  id: 'p-course',
  tenantId: 't1',
  type: 'course',
  slug: 'full-access',
  title: 'Full access',
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems: [{ level: 'course', courseId: 'c1' }],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const activeGrant: ProductGrant = {
  id: 'g1',
  tenantId: 't1',
  memberId: 'mem1',
  productId: 'p-course',
  source: 'manual',
  startsAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const clock: Clock = { nowIso: () => NOW };

const coursesRepo: CourseRepository = {
  list: async () => [c1],
  findById: async (_t, id) => (id === 'c1' ? c1 : null),
  findByIds: async () => [c1],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const modulesRepo: CourseModuleRepository = {
  list: async () => [m1],
  findById: async (_t, id) => (id === 'm1' ? m1 : null),
  findByIds: async () => [m1],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const lessonsRepo: CourseLessonRepository = {
  list: async () => [pdfLesson],
  listPreviews: async () => [],
  findById: async (_t, id) => (id === 'l1' ? pdfLesson : null),
  findByIds: async () => [pdfLesson],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const lessonsRepoWith = (lesson: CourseLesson): CourseLessonRepository => ({
  ...lessonsRepo,
  list: async () => [lesson],
  findById: async (_tenantId, id) => (id === lesson.id ? lesson : null),
  findByIds: async () => [lesson],
});

const grantsRepo: ProductGrantRepository = {
  findById: async () => null,
  findGrant: async () => null,
  createGrant: async () => true,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async () => [activeGrant],
  listGrantedProducts: async () => [pCourse],
};

const progressRepo: MemberCourseProgressRepository = {
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
  update: async (_t, progress) => progress,
  countReferencingLesson: async () => 0,
};

const productsRepo: ProductRepository = {
  listByTenant: async () => [pCourse],
  listPublishedByTenant: async () => [pCourse],
  findById: async () => pCourse,
  create: async () => 'created',
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
};

const tenantSettings: TenantSettings = {
  name: 'Acme',
  socialLinks: [],
  billingPortalUrl: null,
  bunnyStreamLibraryId: 'lib-77',
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
  defaultHomeSpaceId: null,
};

const tenantsRepo = (settings: TenantSettings | null = tenantSettings): TenantRepository => ({
  findById: async () => null,
  findBySlug: async () => null,
  findSole: async () => null,
  hasAny: async () => false,
  findSettings: async () => settings,
  updateSettings: async (_tenantId, next) => next,
  createTenantWithOwnerGrant: async () => {
    throw new Error('not used');
  },
});

const secretsOf = (values: Record<string, string>): TenantSecretResolver => ({
  resolve: async (_tenantId, key) => {
    const value = values[key];
    return value === undefined ? err(notFound(`No secret "${key}"`)) : ok(value);
  },
});

const recordingSigner = (): { signer: StorageProvider; calls: { url: string; expiresInSeconds: number }[] } => {
  const calls: { url: string; expiresInSeconds: number }[] = [];
  return {
    calls,
    signer: {
      objectUrl: (input, key) => new URL(`${input.endpoint}/${input.bucket}/${key}`),
      probe: async () => ok({ code: 'storage.available', message: 'Storage is available.' }),
      presignPut: (input) => ok(input.url),
      presignGet: (input) => {
        calls.push({ url: input.url, expiresInSeconds: input.expiresInSeconds });
        return ok(`${input.url}?X-Amz-Signature=test`);
      },
      delete: async () => ok({ deleted: true }),
      head: async () => ok({ sizeBytes: 1 }),
      healthcheck: async () => ok({ healthy: true }),
      test: async () => ok({ code: 'storage.available', message: 'Storage is available.' }),
    },
  };
};

const deps = (over: Partial<PlayableLessonDeps> = {}): PlayableLessonDeps => ({
  grants: grantsRepo,
  courses: coursesRepo,
  modules: modulesRepo,
  lessons: lessonsRepo,
  progress: progressRepo,
  products: productsRepo,
  tenants: tenantsRepo(),
  clock,
  bunnyTokenSigner: {
    signEmbedToken: ({ securityKey, videoId, expires }) => `${securityKey}-${videoId}-${expires}`,
    signHlsPlaylistUrl: ({ cdnHostname, videoId, expires }) =>
      `https://${cdnHostname}/${videoId}/playlist.m3u8?expires=${expires}`,
  },
  secretResolver: secretsOf({
    's3.accessKeyId': 'AKIA-TEST',
    's3.secretAccessKey': 'secret-test',
  }),
  storage: recordingSigner().signer,
  ...over,
});

describe('getPlayableLesson', () => {
  it('adds an expiring Bunny token when the tenant security key is configured', async () => {
    const videoLesson: CourseLesson = {
      ...pdfLesson,
      contents: [
        { type: 'video', storageKey: 'videos/one', streamLibraryId: 'lib-1', streamVideoId: 'video-1' },
        { type: 'video', storageKey: 'videos/two', streamLibraryId: 'lib-1', streamVideoId: 'video-2' },
      ],
    };
    const result = await getPlayableLesson(
      ctx(),
      'l1',
      deps({
        lessons: lessonsRepoWith(videoLesson),
        secretResolver: secretsOf({ 'bunny.securityKey': 'security-key' }),
      }),
    );
    if (!result.ok) throw new Error(result.error.message);

    const expires = Math.floor(Date.parse(NOW) / 1000) + BUNNY_EMBED_URL_TTL_SECONDS;
    const urls = result.value.contents.map((block) => {
      if (block.type !== 'video' || block.embedUrl === undefined) throw new Error('missing embed url');
      return new URL(block.embedUrl);
    });
    expect(urls[0]?.origin).toBe('https://iframe.mediadelivery.net');
    expect(urls[0]?.pathname).toBe('/embed/lib-77/video-1');
    expect(urls[0]?.searchParams.get('expires')).toBe(String(expires));
    expect(urls[0]?.searchParams.get('token')).toBe(`security-key-video-1-${expires}`);
    expect(urls[1]?.searchParams.get('token')).not.toBe(urls[0]?.searchParams.get('token'));
  });

  it('adds a raw Bunny embed url when the security key is not configured', async () => {
    const video = {
      type: 'video' as const,
      storageKey: 'videos/one',
      streamLibraryId: 'lib-1',
      streamVideoId: 'video-1',
    };
    const videoLesson: CourseLesson = { ...pdfLesson, contents: [video] };
    const result = await getPlayableLesson(
      ctx(),
      'l1',
      deps({ lessons: lessonsRepoWith(videoLesson), secretResolver: secretsOf({}) }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.contents).toEqual([
      { ...video, embedUrl: 'https://iframe.mediadelivery.net/embed/lib-77/video-1' },
    ]);
  });

  it('builds a signed Bunny embed url for an imported video without a block library id', async () => {
    const video = {
      type: 'video' as const,
      storageKey: 'videos/imported',
      streamVideoId: 'imported-video',
    };
    const videoLesson: CourseLesson = { ...pdfLesson, contents: [video] };
    const result = await getPlayableLesson(
      ctx(),
      'l1',
      deps({
        lessons: lessonsRepoWith(videoLesson),
        secretResolver: secretsOf({ 'bunny.securityKey': 'security-key' }),
      }),
    );
    if (!result.ok) throw new Error(result.error.message);

    const expires = Math.floor(Date.parse(NOW) / 1000) + BUNNY_EMBED_URL_TTL_SECONDS;
    expect(result.value.contents).toEqual([{
      ...video,
      embedUrl: `https://iframe.mediadelivery.net/embed/lib-77/imported-video?token=security-key-imported-video-${expires}&expires=${expires}`,
    }]);
  });

  it.each([
    ['missing tenant settings', null],
    ['missing tenant library id', { ...tenantSettings, bunnyStreamLibraryId: null }],
  ])('keeps the video unchanged with %s', async (_case, settings) => {
    const video = {
      type: 'video' as const,
      storageKey: 'videos/one',
      streamLibraryId: 'block-library',
      streamVideoId: 'video-1',
    };
    const videoLesson: CourseLesson = { ...pdfLesson, contents: [video] };
    const result = await getPlayableLesson(
      ctx(),
      'l1',
      deps({ lessons: lessonsRepoWith(videoLesson), tenants: tenantsRepo(settings) }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.contents).toEqual([video]);
  });

  it('signs only S3-hosted pdf blocks and passes the TTL', async () => {
    const { signer, calls } = recordingSigner();
    const result = await getPlayableLesson(ctx(), 'l1', deps({ storage: signer }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.contents).toEqual([
      { type: 'pdf', pdfUrl: `${S3_PDF_URL}?X-Amz-Signature=test`, name: 'Handout' },
      { type: 'pdf', pdfUrl: PUBLIC_PDF_URL },
      { type: 'html', html: '<p>Notes</p>' },
    ]);
    expect(calls).toEqual([{ url: S3_PDF_URL, expiresInSeconds: PDF_URL_TTL_SECONDS }]);
  });

  it('returns the lesson untouched when S3 secrets are not configured', async () => {
    const result = await getPlayableLesson(ctx(), 'l1', deps({ secretResolver: secretsOf({}) }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual(pdfLesson);
  });

  it('propagates resolver failures other than not_found', async () => {
    const broken: TenantSecretResolver = {
      resolve: async () => err(internal('secret decryption failed')),
    };
    const result = await getPlayableLesson(ctx(), 'l1', deps({ secretResolver: broken }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal');
  });

  it('keeps the original url when the signer fails', async () => {
    const failing: StorageProvider = {
      objectUrl: (input, key) => new URL(`${input.endpoint}/${input.bucket}/${key}`),
      probe: async () => err(validation('bad url')),
      presignPut: () => err(validation('bad url')),
      presignGet: () => err(validation('bad url')),
      delete: async () => err(validation('bad url')),
      head: async () => err(validation('bad url')),
      healthcheck: async () => err(validation('bad url')),
      test: async () => err(validation('bad url')),
    };
    const result = await getPlayableLesson(ctx(), 'l1', deps({ storage: failing }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.contents[0]).toEqual({ type: 'pdf', pdfUrl: S3_PDF_URL, name: 'Handout' });
  });

  it('still denies non-members before touching any secret', async () => {
    const result = await getPlayableLesson(ctx({ memberId: null }), 'l1', deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('forbidden');
  });

  it('allows an anonymous preview while denying a paid lesson from the same course', async () => {
    const preview = { ...pdfLesson, id: 'preview', isPreview: true };
    const paid = { ...pdfLesson, id: 'paid', isPreview: false };
    const courseModule: CourseModule = {
      ...m1,
      chapters: [{
        id: 'ch1',
        name: 'Chapter 1',
        contents: [
          { id: 'content-preview', name: preview.name, lessonId: preview.id },
          { id: 'content-paid', name: paid.name, lessonId: paid.id },
        ],
      }],
    };
    const anonymous: Ctx = {
      identity: identity({ memberId: null }),
      capabilities: ['lesson:play'],
    };
    const publicCourses: CourseRepository = {
      ...coursesRepo,
      list: async () => [{ ...c1, publiclyVisible: true }],
    };
    const repository: CourseLessonRepository = {
      ...lessonsRepo,
      list: async () => [preview, paid],
      findById: async (_tenantId, id) => [preview, paid].find((lesson) => lesson.id === id) ?? null,
      findByIds: async () => [preview, paid],
    };
    const moduleRepository: CourseModuleRepository = {
      ...modulesRepo,
      list: async () => [courseModule],
      findById: async (_tenantId, id) => (id === courseModule.id ? courseModule : null),
      findByIds: async () => [courseModule],
    };

    const playableDeps = deps({
      lessons: repository,
      modules: moduleRepository,
      courses: publicCourses,
    });

    await expect(getPlayableLesson(anonymous, preview.id, playableDeps))
      .resolves.toMatchObject({ ok: true, value: { id: preview.id, isPreview: true } });
    await expect(getPlayableLesson(anonymous, paid.id, playableDeps))
      .resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('denies an anonymous preview whose courses are not publicly visible', async () => {
    const preview = { ...pdfLesson, id: 'preview', isPreview: true };
    const courseModule: CourseModule = {
      ...m1,
      chapters: [{
        id: 'ch1',
        name: 'Chapter 1',
        contents: [{ id: 'content-preview', name: preview.name, lessonId: preview.id }],
      }],
    };
    const anonymous: Ctx = {
      identity: identity({ memberId: null }),
      capabilities: ['lesson:play'],
    };

    const result = await getPlayableLesson(anonymous, preview.id, deps({
      lessons: {
        ...lessonsRepo,
        list: async () => [preview],
        findById: async (_tenantId, id) => (id === preview.id ? preview : null),
        findByIds: async () => [preview],
      },
      modules: {
        ...modulesRepo,
        list: async () => [courseModule],
        findById: async (_tenantId, id) => (id === courseModule.id ? courseModule : null),
        findByIds: async () => [courseModule],
      },
    }));

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
