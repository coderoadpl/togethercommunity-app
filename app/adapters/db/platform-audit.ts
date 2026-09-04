import type { PlatformAuditRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { platformAuditEvents } from './schema.js';

export const createPlatformAuditRepository = (db: Db): PlatformAuditRepository => ({
  record: async (event) => {
    await db.insert(platformAuditEvents).values(event);
  },
});
