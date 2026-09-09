import type { Context } from 'hono';

import type { Ctx } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';

export const ctxOf = (c: Context<AppVars>): Ctx => {
  const impersonation = c.get('impersonation');
  return impersonation === undefined
    ? { identity: c.get('identity') }
    : { identity: c.get('identity'), impersonation };
};

