import { z } from 'zod';

import { listSignInClientsInputSchema, signInClientPublicSchema } from '#core/domain/index.js';

export {
  createSignInClientInputSchema,
  rotateSignInClientSecretInputSchema,
  signInClientCredentialSchema,
  signInClientIdSchema,
  signInClientPageSchema,
  type CreateSignInClientInput,
  type ListSignInClientsInput,
  type RotateSignInClientSecretInput,
} from '#core/domain/index.js';

export const SIGN_IN_CLIENT_ROUTES = {
  signInClients: { method: 'GET', path: '/api/sign-in-clients' },
  signInClientCreate: { method: 'POST', path: '/api/sign-in-clients' },
  signInClientRotateSecret: { method: 'POST', path: '/api/sign-in-clients/:id/rotate-secret' },
  signInClientDisable: { method: 'POST', path: '/api/sign-in-clients/:id/disable' },
} as const;

export const signInClientListQuerySchema = listSignInClientsInputSchema.extend({
  limit: z.string().regex(/^[1-9][0-9]{0,2}$/u).transform(Number).optional()
    .pipe(listSignInClientsInputSchema.shape.limit),
});

export const signInClientDisableBodySchema = z.object({}).strict();

export const signInClientDisableOutputSchema = z.object({ client: signInClientPublicSchema }).strict();
