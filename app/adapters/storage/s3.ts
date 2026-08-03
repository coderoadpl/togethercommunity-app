import { createHash, createHmac, randomUUID } from 'node:crypto';

import {
  err,
  integrationAuth,
  integrationNotConfigured,
  integrationUnavailable,
  ok,
  storageConfigurationSchema,
  validation,
  type AppError,
  type ProviderDiagnostic,
  type Result,
  type StorageConfiguration,
  type StorageProbeErrorCode,
} from '#core/domain/index.js';
import type { StorageProvider, TenantSecretResolver } from '#core/server/index.js';

const S3_HOST_PATTERN =
  /^(?<bucket>[a-z0-9][a-z0-9.-]*)\.s3(?:[.-](?<region>[a-z0-9-]+))?\.amazonaws\.com$/;

const PROBE_EXPIRY_SECONDS = 60;

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

interface StorageResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

type FetchStorage = (
  url: string,
  init: {
    method: 'DELETE' | 'GET' | 'OPTIONS' | 'PUT';
    body?: string;
    headers?: Record<string, string>;
  },
) => Promise<StorageResponse>;

interface StorageProviderOptions {
  now?: () => Date;
  fetchStorage?: FetchStorage;
  probeKey?: () => string;
  corsOrigin?: string;
  allowPrivateEndpoints?: boolean;
}

const probeError = (
  providerCode: StorageProbeErrorCode,
  message: string,
): AppError =>
  providerCode === 'storage.credentials'
    ? integrationAuth(message, { providerCode })
    : integrationUnavailable(message, { providerCode });

export const mapStorageProbeFailure = (status: number, body: string): AppError => {
  if (
    status === 301 ||
    /AuthorizationHeaderMalformed|IllegalLocationConstraint|IncorrectEndpoint|InvalidLocationConstraint|PermanentRedirect/i.test(
      body,
    )
  ) {
    return probeError(
      'storage.wrong_region',
      'The bucket is in a different region or behind a different endpoint.',
    );
  }
  if (status === 404 || /NoSuchBucket/i.test(body)) {
    return probeError('storage.bucket', 'The configured bucket does not exist or is not visible.');
  }
  if (/cors/i.test(body)) {
    return probeError('storage.cors', 'The bucket CORS policy rejected the probe.');
  }
  if (
    status === 401 ||
    status === 403 ||
    /AccessDenied|ExpiredToken|InvalidAccessKeyId|InvalidToken|SignatureDoesNotMatch/i.test(body)
  ) {
    return probeError(
      'storage.credentials',
      'The storage provider rejected the access key or its bucket permissions.',
    );
  }
  return probeError(
    'storage.unavailable',
    `The storage endpoint answered the probe with status ${String(status)}.`,
  );
};

const sendProbeRequest = async (
  fetchStorage: FetchStorage,
  url: string,
  init: { method: 'DELETE' | 'GET' | 'PUT'; body?: string },
): Promise<Result<StorageResponse, AppError>> => {
  let response: StorageResponse;
  try {
    response = await fetchStorage(url, init);
  } catch (cause) {
    return err(
      probeError('storage.unavailable', `The storage endpoint is unreachable: ${String(cause)}`),
    );
  }
  if (response.ok) return ok(response);
  const body = await response.text().catch(() => '');
  return err(mapStorageProbeFailure(response.status, body));
};

const privateIpv4 = (address: string): boolean => {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224;
};

const privateAddress = (address: string): boolean => {
  if (/^\d+(?:\.\d+){3}$/.test(address)) return privateIpv4(address);
  if (!address.includes(':')) return false;
  const normalized = address.toLowerCase();
  return normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff');
};

const validateProbeEndpoint = (
  endpoint: string,
  allowPrivateEndpoints: boolean,
): Result<undefined, AppError> => {
  if (allowPrivateEndpoints) return ok(undefined);
  const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
  const blocked = hostname === 'localhost' || hostname.endsWith('.localhost') || privateAddress(hostname);
  return blocked
    ? err(probeError('storage.unavailable', 'Private storage endpoints are disabled.'))
    : ok(undefined);
};

const verifyCors = async (
  fetchStorage: FetchStorage,
  url: string,
  corsOrigin: string,
): Promise<Result<undefined, AppError>> => {
  let response: StorageResponse;
  try {
    response = await fetchStorage(url, {
      method: 'OPTIONS',
      headers: {
        Origin: corsOrigin,
        'Access-Control-Request-Method': 'PUT',
      },
    });
  } catch (cause) {
    return err(probeError('storage.unavailable', `The storage endpoint is unreachable: ${String(cause)}`));
  }
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  const allowedMethods = response.headers.get('access-control-allow-methods')
    ?.split(',')
    .map((method) => method.trim().toUpperCase()) ?? [];
  if (
    !response.ok ||
    (allowedOrigin !== '*' && allowedOrigin !== corsOrigin) ||
    (!allowedMethods.includes('*') && !allowedMethods.includes('PUT'))
  ) {
    return err(probeError('storage.cors', 'The bucket CORS policy rejected the probe.'));
  }
  return ok(undefined);
};

const probeObjectUrl = (configuration: StorageConfiguration, key: string): URL => {
  const url = new URL(configuration.endpoint);
  if (configuration.provider === 'aws_s3') {
    if (!url.hostname.startsWith(`${configuration.bucket}.`)) {
      url.hostname = `${configuration.bucket}.${url.hostname}`;
    }
    url.pathname = `/${key}`;
    return url;
  }
  url.pathname = `/${configuration.bucket}/${key}`;
  return url;
};

const liveProbe = async (
  configuration: StorageConfiguration,
  fetchStorage: FetchStorage,
  now: () => Date,
  keyFactory: () => string,
  corsOrigin: string,
): Promise<Result<ProviderDiagnostic, AppError>> => {
  const key = `together-probe/${keyFactory()}.txt`;
  const url = probeObjectUrl(configuration, key);
  const expected = `together storage probe ${key}`;
  const signed = (method: 'DELETE' | 'GET' | 'PUT'): string =>
    signObjectUrl(method, url, {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
      region: configuration.region,
      expiresInSeconds: PROBE_EXPIRY_SECONDS,
    }, now);

  const cors = await verifyCors(fetchStorage, signed('PUT'), corsOrigin);
  if (!cors.ok) return cors;

  const uploaded = await sendProbeRequest(fetchStorage, signed('PUT'), {
    method: 'PUT',
    body: expected,
  });
  if (!uploaded.ok) return uploaded;

  const read = await sendProbeRequest(fetchStorage, signed('GET'), { method: 'GET' });
  const readBack = read.ok ? await read.value.text() : null;
  const removed = await sendProbeRequest(fetchStorage, signed('DELETE'), { method: 'DELETE' });

  if (!read.ok) return read;
  if (readBack !== expected) {
    return err(probeError('storage.unavailable', 'The storage probe read back different content.'));
  }
  if (!removed.ok) return removed;
  return ok({
    code: 'storage.available',
    message: 'Storage completed the write, read and delete probe.',
  });
};

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
  return ok(
    signObjectUrl(method, url, {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      region: match.groups?.['region'] ?? 'us-east-1',
      expiresInSeconds: input.expiresInSeconds,
    }, now),
  );
};

const signObjectUrl = (
  method: 'DELETE' | 'GET' | 'PUT',
  target: URL,
  input: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    expiresInSeconds: number;
  },
  now: () => Date,
): string => {
  const url = target;
  const region = input.region;
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

  return `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
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

const storedConfiguration = async (
  resolver: TenantSecretResolver,
  tenantId: string,
): Promise<Result<StorageConfiguration | null, AppError>> => {
  const stored = await resolver.resolve(tenantId, 's3.configuration');
  if (!stored.ok) return stored.error.code === 'not_found' ? ok(null) : stored;
  let decoded: unknown;
  try {
    decoded = JSON.parse(stored.value);
  } catch {
    return err(integrationNotConfigured('The stored S3 configuration is invalid.'));
  }
  const parsed = storageConfigurationSchema.safeParse(decoded);
  return parsed.success
    ? ok(parsed.data)
    : err(integrationNotConfigured('The stored S3 configuration is invalid.'));
};

/**
 * Query-parameter SigV4 signing for virtual-hosted S3 and for the path-style
 * endpoints every other S3-compatible provider exposes, hand-rolled on
 * node:crypto so no AWS SDK enters the dependency tree. Object operations take
 * credentials per call so the use-case controls which tenant secret is
 * decrypted; the diagnostics and the live probe resolve secrets themselves.
 */
export const createS3StorageProvider = (
  resolver: TenantSecretResolver,
  options: StorageProviderOptions = {},
): StorageProvider => {
  const now = options.now ?? (() => new Date());
  const fetchStorage = options.fetchStorage ?? fetch;
  const probeKey = options.probeKey ?? randomUUID;
  const corsOrigin = new URL(options.corsOrigin ?? 'http://localhost:48730').origin;
  const allowPrivateEndpoints = options.allowPrivateEndpoints ?? false;
  const probe = async (input: StorageConfiguration): Promise<Result<ProviderDiagnostic, AppError>> => {
    const target = probeObjectUrl(input, 'together-probe');
    const safeEndpoint = validateProbeEndpoint(input.endpoint, allowPrivateEndpoints);
    if (!safeEndpoint.ok) return safeEndpoint;
    const safeTarget = validateProbeEndpoint(target.origin, allowPrivateEndpoints);
    return safeTarget.ok
      ? liveProbe(input, fetchStorage, now, probeKey, corsOrigin)
      : safeTarget;
  };

  return {
    probe,
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
      const configuration = await storedConfiguration(resolver, tenantId);
      if (!configuration.ok) return configuration;
      if (configuration.value !== null) {
        return probe(configuration.value);
      }
      const checked = await checkCredentials(resolver, tenantId);
      return checked.ok
        ? ok({ code: 'storage.available', message: 'Storage credentials are available.' })
        : checked;
    },
  };
};
