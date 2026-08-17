import type { AvatarSourceReader, ContentHash } from '../ports.js';

const GRAVATAR_SIZE = 160;

export const gravatarUrl = (hash: ContentHash, email: string): string =>
  `https://www.gravatar.com/avatar/${hash.sha256(email.trim().toLocaleLowerCase())}?d=404&s=${GRAVATAR_SIZE}`;

export const avatarUrlFor = (
  hash: ContentHash,
  source: { image: string | null; email: string },
): string => source.image ?? gravatarUrl(hash, source.email);

export interface AvatarDeps {
  avatarSources: AvatarSourceReader;
  contentHash: ContentHash;
}

export type AvatarUrlMap = ReadonlyMap<string, string>;

export const avatarUrlsFor = async (
  tenantId: string,
  authorUserIds: readonly string[],
  deps: AvatarDeps,
): Promise<AvatarUrlMap> => {
  const distinct = [...new Set(authorUserIds)];
  if (distinct.length === 0) return new Map();
  const sources = await deps.avatarSources.listAvatarSources(tenantId, distinct);
  return new Map(sources.map((source) => [source.userId, avatarUrlFor(deps.contentHash, source)]));
};

export const avatarUrlForAuthor = async (
  tenantId: string,
  authorUserId: string,
  deps: AvatarDeps,
): Promise<string | null> =>
  (await avatarUrlsFor(tenantId, [authorUserId], deps)).get(authorUserId) ?? null;
