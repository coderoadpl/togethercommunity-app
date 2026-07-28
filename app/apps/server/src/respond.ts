import { HTTP_STATUS_BY_ERROR_CODE, toEnvelope } from '#core/contract/index.js';
import type { AppError, Result } from '#core/domain/index.js';

import { recordAppError } from './telemetry.js';

type ResponseOptions = {
  cacheControl?: string;
  headers?: HeadersInit;
  successStatus?: number;
};

export const respond = <T>(
  result: Result<T, AppError>,
  options: ResponseOptions = {},
): Response => {
  const envelope = toEnvelope(result);
  if (!envelope.ok) recordAppError(envelope.error);
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  headers.set('cache-control', envelope.ok ? options.cacheControl ?? 'no-store' : 'no-store');
  return new Response(JSON.stringify(envelope), {
    status: envelope.ok
      ? options.successStatus ?? 200
      : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code],
    headers,
  });
};

export const respondNotModified = (headers: HeadersInit = {}): Response => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('cache-control', 'public, no-cache');
  return new Response(null, { status: 304, headers: responseHeaders });
};
