import type { MiddlewareHandler } from 'hono';

import { looseEnvelopeSchema } from '#core/contract/index.js';
import {
  MEMBER_DOWNLOAD_SIGN_IN_PATH,
  memberDownloadFailurePath,
  type ErrorCode,
  type MemberDownloadFailureCode,
} from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';

const isDocumentNavigation = (accept: string | undefined): boolean => {
  const value = (accept ?? '').toLowerCase();
  return value.includes('text/html') && !value.includes('application/json');
};

const failureCodeFor = (code: ErrorCode): MemberDownloadFailureCode => {
  if (code === 'forbidden' || code === 'banned') return 'no_access';
  if (code === 'not_found') return 'not_found';
  return 'failed';
};

const errorCodeOf = async (response: Response): Promise<ErrorCode | null> => {
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') return null;
  try {
    const envelope = looseEnvelopeSchema.safeParse(await response.clone().json());
    return envelope.success && !envelope.data.ok ? envelope.data.error.code : null;
  } catch {
    return null;
  }
};

export const memberDownloadNavigation: MiddlewareHandler<AppVars> = async (c, next) => {
  const productId = c.req.param('productId') ?? '';
  const assetId = c.req.param('assetId') ?? '';
  await next();
  if (c.req.method !== 'GET' || !isDocumentNavigation(c.req.header('accept')) || c.res.status < 400) return;
  const code = await errorCodeOf(c.res);
  if (code === null) return;
  const location = code === 'unauthorized'
    ? MEMBER_DOWNLOAD_SIGN_IN_PATH
    : memberDownloadFailurePath({
      code: failureCodeFor(code),
      productId,
      assetId,
    });
  c.res = new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
};
