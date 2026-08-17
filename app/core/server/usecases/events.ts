import {
  DEFAULT_LANGUAGE,
  buildEventIcs,
  createEventInputSchema,
  err,
  eventDiscussionBody,
  eventRefSchema,
  internal,
  listSpaceEventsInputSchema,
  notFound,
  ok,
  postSchema,
  postSnippet,
  rsvpEventInputSchema,
  spaceEventSchema,
  toPublicSpaceEvent,
  upcomingEventsInputSchema,
  updateEventInputSchema,
  validation,
  type AppError,
  type EventIcs,
  type Notification,
  type PublicSpaceEvent,
  type Result,
  type Space,
  type SpaceEvent,
  type SpaceEventRsvpStatus,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  AvatarSourceReader,
  Clock,
  ContentHash,
  DiscussionLinkPort,
  IdGenerator,
  NotificationChannelPort,
  NotificationRepository,
  PostRepository,
  ProductGrantRepository,
  SpaceEventRepository,
  SpaceEventRsvpRepository,
  SpaceRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  ThreadSubscriptionRepository,
} from '../ports.js';
import { avatarUrlForAuthor } from './avatar.js';
import {
  listAccessibleSpaces,
  requireActor,
  requireMemberOrStaff,
  requireUnbannedMember,
  spaceContextAccess,
  spaceVisibleToMemberScope,
} from './community-access.js';
import { resolveAuthorDisplay } from './community.js';

export interface EventsDeps {
  events: SpaceEventRepository;
  eventRsvps: SpaceEventRsvpRepository;
  spaces: SpaceRepository;
  posts: PostRepository;
  threadSubscriptions: ThreadSubscriptionRepository;
  spaceSubscriptions: SpaceSubscriptionRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  grants: ProductGrantRepository;
  tenantAccess: TenantAccessReader;
  links: DiscussionLinkPort;
  ids: IdGenerator;
  clock: Clock;
  avatarSources: AvatarSourceReader;
  contentHash: ContentHash;
}

const ARCHIVED_SPACE_MESSAGE = 'Restore the space before scheduling events in it';

const eventAuthorDisplay = async (ctx: Ctx, deps: EventsDeps): Promise<string> => {
  const tenantId = ctx.identity.tenantId;
  if (tenantId !== null) {
    const member = await deps.tenantAccess.findMember(tenantId, ctx.identity.userId);
    const override = member?.displayName?.trim() ?? '';
    if (override.length > 0) return override;
  }
  return resolveAuthorDisplay(ctx.identity);
};

const projectEvents = async (
  tenantId: string,
  viewerUserId: string,
  events: readonly SpaceEvent[],
  deps: Pick<EventsDeps, 'eventRsvps' | 'clock'>,
): Promise<PublicSpaceEvent[]> => {
  if (events.length === 0) return [];
  const eventIds = events.map((event) => event.id);
  const [counts, viewerRsvps] = await Promise.all([
    deps.eventRsvps.countsForEvents(tenantId, eventIds),
    deps.eventRsvps.listForViewer(tenantId, { userId: viewerUserId, eventIds }),
  ]);
  const answerByEvent = new Map<string, SpaceEventRsvpStatus>(
    viewerRsvps.map((rsvp) => [rsvp.eventId, rsvp.status]),
  );
  const now = deps.clock.nowIso();
  return events.map((event) =>
    toPublicSpaceEvent(event, {
      goingCount: counts.get(event.id)?.going ?? 0,
      notGoingCount: counts.get(event.id)?.notGoing ?? 0,
      viewerRsvp: answerByEvent.get(event.id) ?? null,
      now,
    }),
  );
};

const projectEvent = async (
  tenantId: string,
  viewerUserId: string,
  event: SpaceEvent,
  deps: Pick<EventsDeps, 'eventRsvps' | 'clock'>,
): Promise<Result<PublicSpaceEvent, AppError>> => {
  const [projected] = await projectEvents(tenantId, viewerUserId, [event], deps);
  return projected === undefined ? err(internal('Could not project the event')) : ok(projected);
};

const accessibleEvent = async (
  ctx: Ctx,
  tenantId: string,
  eventId: string,
  deps: EventsDeps,
): Promise<Result<{ event: SpaceEvent; space: Space }, AppError>> => {
  const event = await deps.events.findById(tenantId, eventId);
  if (event === null || event.deletedAt !== null) return err(notFound('Event not found'));
  const space = await spaceContextAccess(ctx, event.spaceId, deps);
  return space.ok ? ok({ event, space: space.value }) : space;
};

/**
 * The synthetic thread is the event's discussion and its live chat, so the
 * regular space-post fan-out is skipped: followers get one `space-event` item.
 */
const createEventDiscussion = async (
  event: SpaceEvent,
  author: { userId: string; display: string },
  deps: EventsDeps,
): Promise<Result<string, AppError>> => {
  const id = deps.ids.nextId();
  const record = postSchema.safeParse({
    id,
    tenantId: event.tenantId,
    contextKind: 'space',
    contextId: event.spaceId,
    parentPostId: null,
    rootPostId: id,
    authorUserId: author.userId,
    authorDisplay: author.display,
    authorIsStaff: true,
    body: eventDiscussionBody(event.title),
    createdAt: event.createdAt,
    editedAt: null,
    deletedAt: null,
  });
  if (!record.success) return err(internal('Could not create the event discussion thread'));
  const created = await deps.posts.createPost(event.tenantId, record.data);
  await deps.threadSubscriptions.upsert(event.tenantId, {
    userId: author.userId,
    rootPostId: created.rootPostId,
    createdAt: created.createdAt,
  });
  return ok(created.rootPostId);
};

const notifySpaceFollowersOfEvent = async (
  tenantId: string,
  event: SpaceEvent,
  space: Space,
  authorDisplay: string,
  deps: EventsDeps,
  tenant: { tenantName: string; tenantSlug: string | null },
): Promise<Result<void, AppError>> => {
  const followers = await deps.spaceSubscriptions.listFollowersForSpace(tenantId, space.id);
  if (followers.length === 0) return ok(undefined);
  const authorAvatarUrl = await avatarUrlForAuthor(tenantId, event.createdByUserId, deps);
  const eventUrl = deps.links.eventUrl({
    tenantSlug: tenant.tenantSlug,
    spaceId: space.id,
    eventId: event.id,
  });
  const reference = event.discussionRootPostId ?? event.id;
  for (const follower of followers) {
    if (follower.userId === event.createdByUserId) continue;
    const [staffGrant, member] = await Promise.all([
      deps.tenantAccess.findStaffGrant(follower.userId, { tenantId }),
      deps.tenantAccess.findMember(tenantId, follower.userId),
    ]);
    const memberCanAccess =
      member !== null &&
      (await spaceVisibleToMemberScope({ tenantId, memberId: member.id }, space, deps));
    if (staffGrant === null && !memberCanAccess) continue;
    const notification: Notification = {
      id: deps.ids.nextId(),
      tenantId,
      recipientUserId: follower.userId,
      kind: 'space-event',
      payload: {
        rootPostId: reference,
        postId: reference,
        contextKind: 'space',
        contextId: space.id,
        courseId: null,
        eventId: event.id,
        lessonName: space.name,
        authorDisplay,
        authorAvatarUrl,
        snippet: postSnippet(`${event.title} · ${event.startsAt}`),
      },
      readAt: null,
      createdAt: deps.clock.nowIso(),
    };
    const inserted = await deps.notifications.insert(tenantId, notification);
    for (const channel of deps.notificationChannels) {
      const delivered = await channel.deliver(inserted, {
        recipientEmail: member?.email ?? null,
        tenantName: tenant.tenantName,
        contextName: space.name,
        contextUrl: eventUrl,
        language: DEFAULT_LANGUAGE,
      });
      if (!delivered.ok) return delivered;
    }
  }
  return ok(undefined);
};

export const createEvent = async (
  ctx: Ctx,
  input: unknown,
  deps: EventsDeps,
): Promise<Result<PublicSpaceEvent, AppError>> => {
  const staff = requireActor(ctx, 'event:write');
  if (!staff.ok) return staff;
  const parsed = createEventInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid event payload', parsed.error.flatten()));
  const space = await deps.spaces.findById(staff.value.tenantId, parsed.data.spaceId);
  if (space === null) return err(notFound('Space not found'));
  if (space.archivedAt !== null) return err(validation(ARCHIVED_SPACE_MESSAGE));
  const record = spaceEventSchema.safeParse({
    id: deps.ids.nextId(),
    tenantId: staff.value.tenantId,
    spaceId: space.id,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    startsAt: parsed.data.startsAt,
    endsAt: parsed.data.endsAt,
    location: parsed.data.location ?? null,
    url: parsed.data.url ?? null,
    liveEmbedUrl: parsed.data.liveEmbedUrl ?? null,
    replayUrl: parsed.data.replayUrl ?? null,
    createdByUserId: staff.value.userId,
    createdAt: deps.clock.nowIso(),
  });
  if (!record.success) return err(validation('Invalid event payload', record.error.flatten()));
  const authorDisplay = await eventAuthorDisplay(ctx, deps);
  const discussion = await createEventDiscussion(
    record.data,
    { userId: staff.value.userId, display: authorDisplay },
    deps,
  );
  if (!discussion.ok) return discussion;
  const created = await deps.events.insert(staff.value.tenantId, {
    ...record.data,
    discussionRootPostId: discussion.value,
  });
  const notified = await notifySpaceFollowersOfEvent(
    staff.value.tenantId,
    created,
    space,
    authorDisplay,
    deps,
    { tenantName: ctx.identity.tenantName ?? 'Together', tenantSlug: ctx.identity.tenantSlug },
  );
  if (!notified.ok) return notified;
  return projectEvent(staff.value.tenantId, staff.value.userId, created, deps);
};

/** Edits stay silent on purpose: followers were notified when the event was created. */
export const updateEvent = async (
  ctx: Ctx,
  input: unknown,
  deps: EventsDeps,
): Promise<Result<PublicSpaceEvent, AppError>> => {
  const staff = requireActor(ctx, 'event:write');
  if (!staff.ok) return staff;
  const parsed = updateEventInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid event update payload', parsed.error.flatten()));
  const event = await deps.events.findById(staff.value.tenantId, parsed.data.eventId);
  if (event === null || event.deletedAt !== null) return err(notFound('Event not found'));
  const record = spaceEventSchema.safeParse({
    ...event,
    title: parsed.data.title ?? event.title,
    description: parsed.data.description === undefined ? event.description : parsed.data.description,
    startsAt: parsed.data.startsAt ?? event.startsAt,
    endsAt: parsed.data.endsAt ?? event.endsAt,
    location: parsed.data.location === undefined ? event.location : parsed.data.location,
    url: parsed.data.url === undefined ? event.url : parsed.data.url,
    liveEmbedUrl:
      parsed.data.liveEmbedUrl === undefined ? event.liveEmbedUrl : parsed.data.liveEmbedUrl,
    replayUrl: parsed.data.replayUrl === undefined ? event.replayUrl : parsed.data.replayUrl,
    updatedAt: deps.clock.nowIso(),
  });
  if (!record.success) return err(validation('Invalid event update payload', record.error.flatten()));
  const updated = await deps.events.update(staff.value.tenantId, record.data);
  if (updated === null) return err(notFound('Event not found'));
  return projectEvent(staff.value.tenantId, staff.value.userId, updated, deps);
};

/** Soft delete keeps RSVPs, notifications and the discussion thread resolvable. */
export const deleteEvent = async (
  ctx: Ctx,
  input: unknown,
  deps: EventsDeps,
): Promise<Result<{ eventId: string }, AppError>> => {
  const staff = requireActor(ctx, 'event:write');
  if (!staff.ok) return staff;
  const parsed = eventRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid event payload', parsed.error.flatten()));
  const event = await deps.events.findById(staff.value.tenantId, parsed.data.eventId);
  if (event === null || event.deletedAt !== null) return err(notFound('Event not found'));
  const deleted = await deps.events.softDelete(staff.value.tenantId, {
    id: event.id,
    deletedAt: deps.clock.nowIso(),
  });
  return deleted === null ? err(notFound('Event not found')) : ok({ eventId: deleted.id });
};

export const listSpaceEvents = async (
  ctx: Ctx,
  input: unknown,
  deps: EventsDeps,
): Promise<Result<{ events: PublicSpaceEvent[]; nextCursor: string | null }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'event:read');
  if (!actor.ok) return actor;
  const parsed = listSpaceEventsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid events query', parsed.error.flatten()));
  const space = await spaceContextAccess(ctx, parsed.data.spaceId, deps);
  if (!space.ok) return space;
  const listed = await deps.events.listForSpace(actor.value.tenantId, {
    spaceId: space.value.id,
    scope: parsed.data.scope,
    now: deps.clock.nowIso(),
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
  return ok({
    events: await projectEvents(actor.value.tenantId, actor.value.userId, listed.events, deps),
    nextCursor: listed.nextCursor,
  });
};

export const getEvent = async (
  ctx: Ctx,
  input: unknown,
  deps: EventsDeps,
): Promise<Result<PublicSpaceEvent, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'event:read');
  if (!actor.ok) return actor;
  const parsed = eventRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid event query', parsed.error.flatten()));
  const found = await accessibleEvent(ctx, actor.value.tenantId, parsed.data.eventId, deps);
  if (!found.ok) return found;
  return projectEvent(actor.value.tenantId, actor.value.userId, found.value.event, deps);
};

export const rsvpEvent = async (
  ctx: Ctx,
  input: unknown,
  deps: EventsDeps,
): Promise<Result<PublicSpaceEvent, AppError>> => {
  const actor = requireUnbannedMember(ctx, 'event:rsvp');
  if (!actor.ok) return actor;
  const parsed = rsvpEventInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid rsvp payload', parsed.error.flatten()));
  const found = await accessibleEvent(ctx, actor.value.tenantId, parsed.data.eventId, deps);
  if (!found.ok) return found;
  const now = deps.clock.nowIso();
  if (found.value.event.endsAt < now) return err(validation('This event is already over'));
  await deps.eventRsvps.upsert(actor.value.tenantId, {
    eventId: found.value.event.id,
    userId: actor.value.userId,
    status: parsed.data.status,
    updatedAt: now,
  });
  return projectEvent(actor.value.tenantId, actor.value.userId, found.value.event, deps);
};

export const listUpcomingEvents = async (
  ctx: Ctx,
  input: unknown,
  deps: EventsDeps,
): Promise<Result<{ events: PublicSpaceEvent[] }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'event:read');
  if (!actor.ok) return actor;
  const parsed = upcomingEventsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid upcoming events query', parsed.error.flatten()));
  const visible = await listAccessibleSpaces(ctx, deps);
  if (!visible.ok) return visible;
  const upcoming = await deps.events.listUpcomingForSpaces(actor.value.tenantId, {
    spaceIds: visible.value.map((space) => space.id),
    now: deps.clock.nowIso(),
    limit: parsed.data.limit,
  });
  return ok({
    events: await projectEvents(actor.value.tenantId, actor.value.userId, upcoming, deps),
  });
};

export const getEventIcs = async (
  ctx: Ctx,
  input: unknown,
  deps: EventsDeps,
): Promise<Result<EventIcs, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'event:read');
  if (!actor.ok) return actor;
  const parsed = eventRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid event query', parsed.error.flatten()));
  const found = await accessibleEvent(ctx, actor.value.tenantId, parsed.data.eventId, deps);
  if (!found.ok) return found;
  return ok(buildEventIcs(found.value.event, ctx.identity.tenantName ?? 'Together'));
};
