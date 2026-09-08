import type { ApiClient } from '#core/client/index.js';
import { API_PATHS } from '#core/contract/index.js';

export const visualSeedTime = '2026-07-01T12:00:00.000Z';
const abortedMutations = {
  updateLastViewed: API_PATHS.studentLastViewed,
  markSpaceSeen: API_PATHS.spaceSeen,
} satisfies Partial<Record<keyof ApiClient, string>>;
const abortedPaths = Object.values(abortedMutations).map((path) =>
  new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`),
);
export const abortVisualMutation = (method: string): boolean => Object.hasOwn(abortedMutations, method);
export const visualRequestPolicy = (url: URL, resourceType: string): 'abort' | 'continue' | 'placeholder' => {
  if (abortedPaths.some((path) => path.test(url.pathname))) return 'abort';
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localhost')) return 'continue';
  return resourceType === 'image' ? 'placeholder' : 'abort';
};
