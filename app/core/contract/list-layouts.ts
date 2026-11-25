import { z } from 'zod';

import { listLayoutIdSchema, listLayoutSchema } from '#core/domain/index.js';

const listIdInput = z.object({ listId: listLayoutIdSchema }).strict();

export const listLayoutContracts = {
  getListLayout: { input: listIdInput, output: z.object({ layout: listLayoutSchema.nullable() }) },
  saveListLayout: { input: listIdInput.extend({ layout: listLayoutSchema }), output: z.object({ layout: listLayoutSchema }) },
  resetListLayout: { input: listIdInput, output: z.object({ reset: z.literal(true) }) },
} as const;

export const LIST_LAYOUT_ROUTES = {
  getListLayout: { method: 'GET', path: '/api/panel/list-layouts/:listId' },
  saveListLayout: { method: 'PUT', path: '/api/panel/list-layouts/:listId' },
  resetListLayout: { method: 'DELETE', path: '/api/panel/list-layouts/:listId' },
} as const;
