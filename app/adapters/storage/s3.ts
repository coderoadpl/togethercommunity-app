import { createHash, createHmac } from 'node:crypto';

import { err, integrationUnavailable, ok, validation } from '#core/domain/index.js';
import type { StorageProvider, TenantSecretResolver } from '#core/server/index.js';

const S3_HOST_PATTERN =
  /^(?<bucket>[a-z0-9][a-z0-9.-]*)\.s3(?:[.-](?<region>[a-z0-9-]+))?\.amazonaws\.com$/;

const rfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const canonicalUriSegment = (segment: string): string => {
  try {
    return rfc3986(decodeURIComponent(segment));
  } catch {
    return rfc3986(segment);
  }
};

const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest();

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

type StorageRequest = {
  url: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds: number;
};

type FetchStorage = (
  url: string,
  init: { method: 'DELETE' },
) => Promise<{ ok: boolean; status: number }>;

const presign = (
  method: 'DELETE' | 'GET' | 'PUT',
  input: StorageRequest,
  now: () => Date,
) => {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return err(validation(`Cannot presign "${input.url}": not a valid URL`));
  }
  const match = S3_HOST_PATTERN.exec(url.hostname);
  if (match === null) {
    return err(validation(`Cannot presign "${input.url}": not a virtual-hosted S3 URL`));
  }
  const region = match.groups?.['region'] ?? 'us-east-1';

  const at = now();
  const amzDate = `${at.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const query: [string, string][] = [
    ...url.searchParams.entries(),
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const canonicalQuery = query
    .map(([key, value]): [string, string] => [rfc3986(key), rfc3986(value)])
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? byCodePoint(aValue, bValue) : byCodePoint(aKey, bKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalUri = url.pathname.split('/').map(canonicalUriSegment).join('/');
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${url.host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), region), 's3'),
    'aws4_request',
  );
  const signature = hmac(signingKey, stringToSign).toString('hex');

  return ok(`${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`);
};

const checkCredentials = async (resolver: TenantSecretResolver, tenantId: string) => {
  const [accessKeyId, secretAccessKey] = await Promise.all([
    resolver.resolve(tenantId, 's3.accessKeyId'),
    resolver.resolve(tenantId, 's3.secretAccessKey'),
  ]);
  if (!accessKeyId.ok) return accessKeyId;
  if (!secretAccessKey.ok) return secretAccessKey;
  return ok({ healthy: true as const });
};

/**
 * Query-parameter SigV4 signing for virtual-hosted S3, hand-rolled on
 * node:crypto so no AWS SDK enters the dependency tree. Object operations take
 * credentials per call so the use-case controls which tenant secret is
 * decrypted; only the diagnostics resolve secrets themselves.
 */
export const createS3StorageProvider = (
  resolver: TenantSecretResolver,
  now: () => Date = () => new Date(),
  fetchStorage: FetchStorage = fetch,
): StorageProvider => ({
  presignPut: (input) => presign('PUT', input, now),
  presignGet: (input) => presign('GET', input, now),
  delete: async (input) => {
    const signed = presign('DELETE', { ...input, expiresInSeconds: 60 }, now);
    if (!signed.ok) return signed;
    try {
      const response = await fetchStorage(signed.value, { method: 'DELETE' });
      return response.ok
        ? ok({ deleted: true })
        : err(integrationUnavailable(`S3 rejected the delete request with status ${String(response.status)}`));
    } catch (cause) {
      return err(integrationUnavailable(`Could not reach S3: ${String(cause)}`));
    }
  },
  healthcheck: ({ tenantId }) => checkCredentials(resolver, tenantId),
  test: async ({ tenantId }) => {
    const checked = await checkCredentials(resolver, tenantId);
    return checked.ok
      ? ok({ code: 'storage.available', message: 'Storage credentials are available.' })
      : checked;
  },
});
