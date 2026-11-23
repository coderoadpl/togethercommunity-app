import type { MiddlewareHandler } from 'hono';

import { looseEnvelopeSchema, MEMBER_DOWNLOAD_SIGN_IN_PATH, memberDownloadFailurePath } from '#core/contract/index.js';
import type { ErrorCode, MemberDownloadFailureCode } from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';

const specificityOf = (range: string, mediaType: string): number => {
  if (range === mediaType) return 2;
  if (range === `${mediaType.split('/')[0] ?? ''}/*`) return 1;
  return range === '*/*' ? 0 : -1;
};

const splitOutsideQuotes = (text: string, separator: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      escaped = false;
    } else if (quoted && char === '\\') {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
};

const qualityOf = (accept: string, mediaType: string): number => {
  let best = { specificity: -1, quality: 0 };
  for (const entry of splitOutsideQuotes(accept, ',')) {
    const [range = '', ...params] = splitOutsideQuotes(entry, ';').map((part) => part.trim().toLowerCase());
    const qIndex = params.findIndex((param) => param.startsWith('q='));
    const mediaParams = (qIndex < 0 ? params : params.slice(0, qIndex)).filter((param) => param !== '');
    const specificity = mediaParams.length === 0 ? specificityOf(range, mediaType) : -1;
    if (specificity < 0 || specificity < best.specificity) continue;
    const q = params[qIndex];
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
