import { HTTPException } from 'hono/http-exception';

import { err, validation } from '#core/domain/index.js';

import { respond } from './respond.js';

export const requireJsonContentType = (request: Request): void => {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HTTPException(400, {
      res: respond(err(validation('Content-Type must be application/json'))),
    });
  }
};

export const readJson = async (request: Request): Promise<unknown> => {
  requireJsonContentType(request);
  return request.json().catch(() => null);
};
