import type { MiddlewareHandler } from 'hono';

import { looseEnvelopeSchema, MEMBER_DOWNLOAD_SIGN_IN_PATH, memberDownloadFailurePath } from '#core/contract/index.js';
import type { ErrorCode, MemberDownloadFailureCode } from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';

const qualityOf = (accept: string, mediaType: string): number => {
  let quality = 0;
  for (const range of accept.split(',')) {
    const [type = '', ...params] = range.split(';').map((part) => part.trim().toLowerCase());
    if (type !== mediaType) continue;
    const q = params.find((param) => param.startsWith('q='));
    const value = q === undefined ? 1 : Number(q.slice(2));
    if (Number.isFinite(value)) quality = Math.max(quality, value);
  }
  return quality;
};

const isDocumentNavigation = (accept: string | undefined): boolean => {
  const html = qualityOf(accept ?? '', 'text/html');
  return html > 0 && html > qualityOf(accept ?? '', 'application/json');
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
