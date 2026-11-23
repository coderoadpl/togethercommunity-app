import type { MiddlewareHandler } from 'hono';

import { looseEnvelopeSchema, MEMBER_DOWNLOAD_SIGN_IN_PATH, memberDownloadFailurePath } from '#core/contract/index.js';
import type { ErrorCode, MemberDownloadFailureCode } from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';

const specificityOf = (range: string, mediaType: string): number => {
  if (range === mediaType) return 2;
  if (range === `${mediaType.split('/')[0] ?? ''}/*`) return 1;
  return range === '*/*' ? 0 : -1;
};

const qualityOf = (accept: string, mediaType: string): number => {
  let best = { specificity: -1, quality: 0 };
  for (const entry of accept.split(',')) {
    const [range = '', ...params] = entry.split(';').map((part) => part.trim().toLowerCase());
    const specificity = specificityOf(range, mediaType);
    if (specificity < 0 || specificity < best.specificity) continue;
    const q = params.find((param) => param.startsWith('q='));
    const value = q === undefined ? 1 : Number(q.slice(2));
    if (!Number.isFinite(value)) continue;
    best = specificity > best.specificity
      ? { specificity, quality: value }
      : { specificity, quality: Math.max(best.quality, value) };
  }
  return best.quality;
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
