import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { z } from 'zod';

const normalizeAddress = (address: string | undefined): string | null => {
  if (address === undefined) return null;
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return z.string().ip().safeParse(normalized).success ? normalized : null;
};

export const createAuthAttributionFailureReporter = (
  write: (message: string) => void = (message) => { process.stderr.write(message); },
): ((header: string) => void) => {
  let reported = false;
  return (header) => {
    if (reported) return;
    reported = true;
    write(
      `[auth-network] ${header} did not provide one valid client IP; auth rate limiting will use its shared fallback bucket\n`,
    );
  };
};

const reportAuthAttributionFailure = createAuthAttributionFailureReporter();

export const trustedAuthHeaders = (
  source: Headers,
  trustedProxyHeader: string | null,
  remoteAddress: string | undefined,
  reportFailure: (header: string) => void = reportAuthAttributionFailure,
): Headers => {
  const headers = new Headers(source);
  const forwarded = trustedProxyHeader === null
    ? null
    : normalizeAddress(source.get(trustedProxyHeader)?.trim());
  const direct = normalizeAddress(remoteAddress);
  headers.delete('x-forwarded-for');
  if (forwarded !== null) headers.set('x-forwarded-for', forwarded);
  else if (trustedProxyHeader === null && direct !== null) headers.set('x-forwarded-for', direct);
  else if (trustedProxyHeader !== null) reportFailure(trustedProxyHeader);
  return headers;
};

const remoteAddress = (context: Context): string | undefined => {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
};

const trustedAuthContextHeaders = (
  context: Context,
  trustedProxyHeader: string | null,
): Headers => trustedAuthHeaders(
  context.req.raw.headers,
  trustedProxyHeader,
  remoteAddress(context),
);

export const trustedAuthRequest = (
  context: Context,
  request: Request,
  trustedProxyHeader: string | null,
): Request => new Request(request, {
  headers: trustedAuthHeaders(request.headers, trustedProxyHeader, remoteAddress(context)),
});

export const checkoutConsentEvidence = (
  context: Context,
  trustedProxyHeader: string | null,
): { ip?: string; userAgent?: string; } => {
  const headers = trustedAuthContextHeaders(context, trustedProxyHeader);
  const ip = headers.get('x-forwarded-for') ?? undefined;
  const userAgent = context.req.raw.headers.get('user-agent') ?? undefined;
  return {
    ...(ip === undefined ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
};
