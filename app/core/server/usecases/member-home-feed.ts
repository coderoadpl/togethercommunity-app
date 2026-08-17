import {
  err,
  memberHomeFeedInputSchema,
  ok,
  renderPost,
  toPublicPost,
  validation,
  type AppError,
  type MemberHomeFeed,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  PostReactionRepository,
  PostRepository,
  ProductGrantRepository,
  SpaceRepository,
} from '../ports.js';
import { listAccessibleSpaces, requireMemberOrStaff } from './community-access.js';

export interface MemberHomeFeedDeps {
  spaces: SpaceRepository;
  grants: ProductGrantRepository;
  clock: Clock;
  posts: PostRepository;
  reactions: PostReactionRepository;
}

export const getMemberHomeFeed = async (
  ctx: Ctx,
  input: unknown,
  deps: MemberHomeFeedDeps,
): Promise<Result<MemberHomeFeed, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:read');
  if (!actor.ok) return actor;
  const parsed = memberHomeFeedInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid home feed query', parsed.error.flatten()));
  const visible = await listAccessibleSpaces(ctx, deps);
  if (!visible.ok) return visible;
  const nameById = new Map(visible.value.map((space) => [space.id, space.name]));
  if (nameById.size === 0) return ok({ items: [], nextCursor: null });

  const listed = await deps.posts.listThreadsForSpaces(actor.value.tenantId, {
    spaceIds: [...nameById.keys()],
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
  const reactions = await deps.reactions.summarize(actor.value.tenantId, {
    postIds: listed.threads.map((thread) => thread.post.id),
    viewerUserId: actor.value.userId,
  });

  return ok({
    items: listed.threads.map((thread) => ({
      ...toPublicPost(renderPost(thread.post), actor.value.userId),
      replyCount: thread.replyCount,
      reactions: reactions.get(thread.post.id) ?? [],
      spaceId: thread.post.contextId,
      spaceName: nameById.get(thread.post.contextId) ?? '',
    })),
    nextCursor: listed.nextCursor,
  });
};
