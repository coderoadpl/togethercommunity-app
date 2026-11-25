import { z } from 'zod';

import { listLayoutIdSchema, listLayoutSchema } from '#core/domain/index.js';

export const LIST_LAYOUT_EXPECTED_USER_HEADER = 'X-Expected-User-Id';

const listLayoutScopeInput = z.object({ listId: listLayoutIdSchema, expectedUserId: z.string().min(1) }).strict();

export const listLayoutContracts = {
  getListLayout: { input: listLayoutScopeInput, output: z.object({ layout: listLayoutSchema.nullable() }) },
  saveListLayout: { input: listLayoutScopeInput.extend({ layout: listLayoutSchema }), output: z.object({ layout: listLayoutSchema }) },
  resetListLayout: { input: listLayoutScopeInput, output: z.object({ reset: z.literal(true) }) },
} as const;

export const LIST_LAYOUT_ROUTES = {
  getListLayout: { method: 'GET', path: '/api/panel/list-layouts/:listId' },
  saveListLayout: { method: 'PUT', path: '/api/panel/list-layouts/:listId' },
  resetListLayout: { method: 'DELETE', path: '/api/panel/list-layouts/:listId' },
} as const;
