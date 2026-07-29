import { createHash } from 'node:crypto';

import type { ContentHash } from '#core/server/index.js';

export const createContentHash = (): ContentHash => ({
  sha256: (content) => createHash('sha256').update(content).digest('hex'),
});
