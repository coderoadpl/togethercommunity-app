import type { Hono } from 'hono';

import {
  SIGN_IN_CLIENT_ROUTES,
  createSignInClientInputSchema,
  rotateSignInClientSecretInputSchema,
  signInClientDisableBodySchema,
  signInClientIdSchema,
  signInClientListQuerySchema,
} from '#core/contract/index.js';
import { err, ok, validation } from '#core/domain/index.js';
import {
  createSignInClient,
  disableSignInClient,
  listSignInClients,
  rotateSignInClientSecret,
  type SignInClientDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

const invalidRequest = () => respond(err(validation('Invalid sign-in client request')));

export const registerSignInClientRoutes = (app: Hono<AppVars>, deps: SignInClientDeps): void => {
  app.get(SIGN_IN_CLIENT_ROUTES.signInClients.path, async (c) => {
    const query = Object.fromEntries(Object.entries(c.req.queries()).map(([key, values]) =>
      [key, values.length === 1 ? values[0] : values] as const));
    const parsed = signInClientListQuerySchema.safeParse(query);
    if (!parsed.success) return invalidRequest();
    return respond(await listSignInClients(ctxOf(c), parsed.data, deps));
  });

  app.post(SIGN_IN_CLIENT_ROUTES.signInClientCreate.path, async (c) => {
    const parsed = createSignInClientInputSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return invalidRequest();
    return respond(await createSignInClient(ctxOf(c), parsed.data, deps), { successStatus: 201 });
  });

  app.post(SIGN_IN_CLIENT_ROUTES.signInClientRotateSecret.path, async (c) => {
    const id = signInClientIdSchema.safeParse(c.req.param('id'));
    const body = rotateSignInClientSecretInputSchema.safeParse(await readJson(c.req.raw));
    if (!id.success || !body.success) return invalidRequest();
    return respond(await rotateSignInClientSecret(ctxOf(c), { id: id.data, ...body.data }, deps));
  });

  app.post(SIGN_IN_CLIENT_ROUTES.signInClientDisable.path, async (c) => {
    const id = signInClientIdSchema.safeParse(c.req.param('id'));
    const body = signInClientDisableBodySchema.safeParse(c.req.raw.body === null ? {} : await readJson(c.req.raw));
    if (!id.success || !body.success) return invalidRequest();
    const result = await disableSignInClient(ctxOf(c), { id: id.data }, deps);
    return respond(result.ok ? ok({ client: result.value }) : result);
  });
};
