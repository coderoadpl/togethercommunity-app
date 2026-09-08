import type { AvatarSourceReader } from '../ports.js';

const avatarAssetPathPattern = /^\/api\/public\/assets\/avatar\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/iu;

export const avatarUrlFor = (image: string | null): string | null =>
  image !== null && avatarAssetPathPattern.test(image)
  ? image
  : null;

export interface AvatarDeps {
  avatarSources: AvatarSourceReader;
}

export type AvatarUrlMap = ReadonlyMap<string, string | null>;

export const avatarUrlsFor = async (
  tenantId: string,
  authorUserIds: readonly string[],
  deps: AvatarDeps,
): Promise<AvatarUrlMap> => {
  const distinct = [...new Set(authorUserIds)];
  if (distinct.length === 0) return new Map();
  const sources = await deps.avatarSources.listAvatarSources(tenantId, distinct);
  return new Map(sources.map((source) => [source.userId, avatarUrlFor(source.image)]));
};

export const avatarUrlForAuthor = async (
  tenantId: string,
  authorUserId: string,
  deps: AvatarDeps,
): Promise<string | null> =>
  (await avatarUrlsFor(tenantId, [authorUserId], deps)).get(authorUserId) ?? null;
