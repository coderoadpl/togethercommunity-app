import {
  err,
  listSpaceEventsInputSchema,
  listSpaceFeedInputSchema,
  MAX_PINNED_POSTS_PER_SPACE,
  notFound,
  ok,
  publicSpaceEventRefSchema,
  publicSpaceThreadInputSchema,
  renderPost,
  toAnonymousSpaceEvent,
  toPublicPost,
  validation,
  type AppError,
  type CourseLesson,
  type CourseStructureWithAccess,
  type Discussion,
  type PublicNavigation,
  type PublicSpaceEvent,
  type Result,
  type Space,
  type SpaceEvent,
  type SpaceFeed,
  type Tenant,
} from '#core/domain/index.js';

import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  PostReactionRepository,
  PostRepository,
  ProductRepository,
  SpaceEventRepository,
  SpaceEventRsvpRepository,
  SpaceRepository,
  TenantRepository,
} from '../ports.js';
import { buildCourseStructure, type AccessLookup } from './access.js';
import { nestReplies } from './community.js';

/**
 * Anonymous reads follow the `getPublicOffer` shape: a tenant resolved from the
 * host instead of a ctx, so the `public` principal keeps its capability list.
 */

export interface PublicNavigationDeps {
  spaces: Pick<SpaceRepository, 'list'>;
  courses: Pick<CourseRepository, 'list'>;
  products: Pick<ProductRepository, 'listPublishedByTenant'>;
  tenants: Pick<TenantRepository, 'findSettings'>;
}

export interface PublicCourseStructureDeps {
  courses: Pick<CourseRepository, 'findById'>;
  modules: Pick<CourseModuleRepository, 'list'>;
  lessons: Pick<CourseLessonRepository, 'list'>;
  products: Pick<ProductRepository, 'listPublishedByTenant'>;
}

export interface PublicSpaceDeps {
  spaces: Pick<SpaceRepository, 'findById'>;
  posts: Pick<
    PostRepository,
    'findById' | 'listThreadsForContext' | 'listPinnedForContext' | 'listReplies'
  >;
  reactions: Pick<PostReactionRepository, 'summarize'>;
}

export interface PublicSpaceEventDeps {
  spaces: Pick<SpaceRepository, 'findById'>;
  events: Pick<SpaceEventRepository, 'findById' | 'listForSpace'>;
  eventRsvps: Pick<SpaceEventRsvpRepository, 'countsForEvents'>;
  clock: Clock;
}

/** No account is attached to an anonymous read, so no post is ever own or reacted to. */
const NO_VIEWER = '';

const byPosition = (a: Space, b: Space): number => a.position - b.position;

export const getPublicNavigation = async (
  tenant: Tenant,
  deps: PublicNavigationDeps,
): Promise<Result<PublicNavigation, AppError>> => {
  const [spaces, courses, products, settings] = await Promise.all([
    deps.spaces.list(tenant.id),
    deps.courses.list(tenant.id),
    deps.products.listPublishedByTenant(tenant.id),
    deps.tenants.findSettings(tenant.id),
  ]);
  const publishedProductIds = new Set(products.map((product) => product.id));
  const publicSpaces = spaces.filter((space) => space.publicReadOnly).sort(byPosition);
  const lockedSpaces = spaces
    .filter(
      (space) =>
        !space.publicReadOnly &&
        space.visibility === 'product' &&
        space.productIds.some((productId) => publishedProductIds.has(productId)),
    )
    .sort(byPosition);
  const configuredHomeSpaceId = settings?.defaultHomeSpaceId ?? null;
  const homeSpace =
    publicSpaces.find((space) => space.id === configuredHomeSpaceId) ?? publicSpaces[0];

  return ok({
    defaultHomeSpaceId: homeSpace?.id ?? null,
    spaces: publicSpaces.map((space) => ({
      id: space.id,
      slug: space.slug,
      name: space.name,
      description: space.description,
      position: space.position,
    })),
    courses: courses
      .filter((course) => course.publiclyVisible)
      .map((course) => ({
        id: course.id,
        name: course.name,
        description: course.description,
        imageUrl: course.imageUrl,
      })),
    lockedSpaces: lockedSpaces.map((space) => ({
      id: space.id,
      slug: space.slug,
      name: space.name,
      description: space.description,
      productIds: space.productIds,
    })),
  });
};

const previewOnlyLookup = (lessons: CourseLesson[]): AccessLookup => ({
  courseLevel: new Set<string>(),
  excludedModuleIds: new Set<string>(),
  moduleIds: new Set<string>(),
  lessonIds: new Set(lessons.filter((lesson) => lesson.isPreview).map((lesson) => lesson.id)),
});

export const getPublicCourseStructure = async (
  tenant: Tenant,
  courseId: string,
  deps: PublicCourseStructureDeps,
): Promise<Result<CourseStructureWithAccess, AppError>> => {
  if (!courseId) return err(validation('courseId is required'));
  const course = await deps.courses.findById(tenant.id, courseId);
  if (course === null || !course.publiclyVisible) {
    return err(notFound(`No course "${courseId}" in this tenant`));
  }
  const [modules, lessons, products] = await Promise.all([
    deps.modules.list(tenant.id),
    deps.lessons.list(tenant.id),
    deps.products.listPublishedByTenant(tenant.id),
  ]);
  return ok(
    buildCourseStructure(
      course,
      modules,
      new Map(lessons.map((lesson) => [lesson.id, lesson])),
      previewOnlyLookup(lessons),
      new Set(),
      products,
    ),
  );
};

const publiclyReadableSpace = async (
  tenantId: string,
  spaceId: string,
  deps: Pick<PublicSpaceDeps, 'spaces'>,
): Promise<Result<Space, AppError>> => {
  const space = await deps.spaces.findById(tenantId, spaceId);
  return space === null || space.archivedAt !== null || !space.publicReadOnly
    ? err(notFound('Space not found'))
    : ok(space);
};

export const getPublicSpaceFeed = async (
  tenant: Tenant,
  input: unknown,
  deps: PublicSpaceDeps,
): Promise<Result<SpaceFeed, AppError>> => {
  const parsed = listSpaceFeedInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space feed query', parsed.error.flatten()));
  const space = await publiclyReadableSpace(tenant.id, parsed.data.spaceId, deps);
  if (!space.ok) return space;
  const [listed, pinnedPosts] = await Promise.all([
    deps.posts.listThreadsForContext(tenant.id, {
      contextKind: 'space',
      contextId: space.value.id,
      limit: parsed.data.limit,
      order: 'desc',
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    }),
    deps.posts.listPinnedForContext(tenant.id, {
      contextKind: 'space',
      contextId: space.value.id,
      limit: MAX_PINNED_POSTS_PER_SPACE,
    }),
  ]);
  const pinnedIds = new Set(pinnedPosts.map((post) => post.id));
  const reactions = await deps.reactions.summarize(tenant.id, {
    postIds: [...listed.threads.map((thread) => thread.post.id), ...pinnedIds],
    viewerUserId: NO_VIEWER,
  });
  const pinnedReplies = await Promise.all(
    pinnedPosts.map((post) => deps.posts.listReplies(tenant.id, post.rootPostId)),
  );
  return ok({
    spaceId: space.value.id,
    pinned: pinnedPosts.map((post, index) => ({
      ...toPublicPost(renderPost(post), NO_VIEWER),
      replyCount: pinnedReplies[index]?.length ?? 0,
      reactions: reactions.get(post.id) ?? [],
    })),
    items: listed.threads
      .filter((thread) => !pinnedIds.has(thread.post.id))
      .map((thread) => ({
        ...toPublicPost(renderPost(thread.post), NO_VIEWER),
        replyCount: thread.replyCount,
        reactions: reactions.get(thread.post.id) ?? [],
      })),
    nextCursor: listed.nextCursor,
    isFollowing: false,
  });
};

const projectPublicEvents = async (
  tenantId: string,
  events: readonly SpaceEvent[],
  deps: PublicSpaceEventDeps,
): Promise<PublicSpaceEvent[]> => {
  if (events.length === 0) return [];
  const counts = await deps.eventRsvps.countsForEvents(
    tenantId,
    events.map((event) => event.id),
  );
  const now = deps.clock.nowIso();
  return events.map((event) =>
    toAnonymousSpaceEvent(event, {
      goingCount: counts.get(event.id)?.going ?? 0,
      notGoingCount: counts.get(event.id)?.notGoing ?? 0,
      viewerRsvp: null,
      now,
    }),
  );
};

export const getPublicSpaceEvents = async (
  tenant: Tenant,
  input: unknown,
  deps: PublicSpaceEventDeps,
): Promise<Result<{ events: PublicSpaceEvent[]; nextCursor: string | null }, AppError>> => {
  const parsed = listSpaceEventsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid events query', parsed.error.flatten()));
  const space = await publiclyReadableSpace(tenant.id, parsed.data.spaceId, deps);
  if (!space.ok) return space;
  const listed = await deps.events.listForSpace(tenant.id, {
    spaceId: space.value.id,
    scope: parsed.data.scope,
    now: deps.clock.nowIso(),
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
  return ok({
    events: await projectPublicEvents(tenant.id, listed.events, deps),
    nextCursor: listed.nextCursor,
  });
};

export const getPublicSpaceEvent = async (
  tenant: Tenant,
  input: unknown,
  deps: PublicSpaceEventDeps,
): Promise<Result<PublicSpaceEvent, AppError>> => {
  const parsed = publicSpaceEventRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid event query', parsed.error.flatten()));
  const space = await publiclyReadableSpace(tenant.id, parsed.data.spaceId, deps);
  if (!space.ok) return space;
  const event = await deps.events.findById(tenant.id, parsed.data.eventId);
  if (event === null || event.deletedAt !== null || event.spaceId !== space.value.id) {
    return err(notFound('Event not found'));
  }
  const [projected] = await projectPublicEvents(tenant.id, [event], deps);
  return projected === undefined ? err(notFound('Event not found')) : ok(projected);
};

export const getPublicSpaceThread = async (
  tenant: Tenant,
  input: unknown,
  deps: PublicSpaceDeps,
): Promise<Result<Discussion, AppError>> => {
  const parsed = publicSpaceThreadInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space thread query', parsed.error.flatten()));
  const space = await publiclyReadableSpace(tenant.id, parsed.data.spaceId, deps);
  if (!space.ok) return space;
  const root = await deps.posts.findById(tenant.id, parsed.data.postId);
  if (
    root === null ||
    root.contextKind !== 'space' ||
    root.contextId !== space.value.id ||
    root.rootPostId !== root.id
  ) {
    return err(notFound('Thread not found'));
  }
  const replies = await deps.posts.listReplies(tenant.id, root.rootPostId);
  return ok({
    threads: [
      {
        ...toPublicPost(renderPost(root), NO_VIEWER),
        replyCount: replies.length,
        replies: nestReplies(root.id, replies, NO_VIEWER),
      },
    ],
    nextCursor: null,
    viewerSubscriptions: {},
  });
};
