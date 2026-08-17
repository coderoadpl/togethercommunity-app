import type { ContentHash } from '../ports.js';

const GRAVATAR_SIZE = 160;

export const gravatarUrl = (hash: ContentHash, email: string): string =>
  `https://www.gravatar.com/avatar/${hash.sha256(email.trim().toLocaleLowerCase())}?d=404&s=${GRAVATAR_SIZE}`;

export const avatarUrlFor = (
  hash: ContentHash,
  source: { image: string | null; email: string },
): string => source.image ?? gravatarUrl(hash, source.email);
