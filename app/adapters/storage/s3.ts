import { createHash, createHmac, randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';

import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

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
  region?: string;
  expiresInSeconds: number;
};

interface StorageResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: { cancel(): Promise<void> } | null;
  text(): Promise<string>;
}

type FetchStorage = (
  url: string,
  init: {
    method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PUT';
    body?: string;
    headers?: Record<string, string>;
    dispatcher?: Dispatcher;
    redirect?: 'error';
  },
) => Promise<StorageResponse>;

interface StorageProviderOptions {
  now?: () => Date;
  fetchStorage?: FetchStorage;
  probeKey?: () => string;
  corsOrigin?: string;
  allowPrivateEndpoints?: boolean;
  lookupAddresses?: (hostname: string) => Promise<string[]>;
}

const probeError = (
  providerCode: StorageProbeErrorCode,
  message: string,
): AppError =>
  providerCode === 'storage.credentials'
    ? integrationAuth(message, { providerCode })
    : integrationUnavailable(message, { providerCode });

const discardStorageResponseBody = async (response: StorageResponse): Promise<void> => {
  await response.body?.cancel();
};

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
  dispatcher: Dispatcher,
  readBody: boolean,
): Promise<Result<{ body: string }, AppError>> => {
  let response: StorageResponse;
  try {
    response = await fetchStorage(url, { ...init, dispatcher, redirect: 'error' });
  } catch {
    return err(probeError('storage.unavailable', 'The storage endpoint is unreachable.'));
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return err(mapStorageProbeFailure(response.status, body));
  }
  try {
    const body = readBody ? await response.text() : '';
    if (!readBody) await discardStorageResponseBody(response);
    return ok({ body });
  } catch {
    return err(probeError('storage.unavailable', 'The storage endpoint response could not be read.'));
  }
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

const validateProbeEndpoint = async (
  endpoint: string,
  allowPrivateEndpoints: boolean,
  lookupAddresses: (hostname: string) => Promise<string[]>,
): Promise<Result<{ address: string }, AppError>> => {
  const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
  if (
    !allowPrivateEndpoints &&
    (hostname === 'localhost' || hostname.endsWith('.localhost') || privateAddress(hostname))
  ) {
    return err(probeError('storage.unavailable', 'Private storage endpoints are disabled.'));
  }
  if (isIP(hostname) !== 0) return ok({ address: hostname });
  let addresses: string[];
  try {
    addresses = await lookupAddresses(hostname);
  } catch {
    return err(probeError('storage.unavailable', 'The storage endpoint hostname could not be resolved.'));
  }
  if (addresses.length === 0) {
    return err(probeError('storage.unavailable', 'The storage endpoint hostname could not be resolved.'));
  }
  if (addresses.some((address) => isIP(address) === 0)) {
    return err(probeError('storage.unavailable', 'The storage endpoint hostname could not be resolved.'));
  }
  if (!allowPrivateEndpoints && addresses.some(privateAddress)) {
    return err(probeError('storage.unavailable', 'Private storage endpoints are disabled.'));
  }
  const address = addresses[0];
  return address === undefined
    ? err(probeError('storage.unavailable', 'The storage endpoint hostname could not be resolved.'))
    : ok({ address });
};

const pinnedDispatcher = ({ address }: { address: string }): Dispatcher => {
  const family = isIP(address);
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
  return new Agent({ connect: { lookup: pinnedLookup } });
};

const verifyCors = async (
  fetchStorage: FetchStorage,
  url: string,
  corsOrigin: string,
  dispatcher: Dispatcher,
): Promise<Result<undefined, AppError>> => {
  let response: StorageResponse;
  try {
    response = await fetchStorage(url, {
      method: 'OPTIONS',
      dispatcher,
      redirect: 'error',
      headers: {
        Origin: corsOrigin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
  } catch {
    return err(probeError('storage.unavailable', 'The storage endpoint is unreachable.'));
  }
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  const allowedMethods = response.headers.get('access-control-allow-methods')
    ?.split(',')
    .map((method) => method.trim().toUpperCase()) ?? [];
  const allowedHeaders = response.headers.get('access-control-allow-headers')
    ?.split(',')
    .map((header) => header.trim().toLowerCase()) ?? [];
  try {
    await discardStorageResponseBody(response);
  } catch {
    return err(probeError('storage.unavailable', 'The storage endpoint response could not be read.'));
  }
  if (
    !response.ok ||
    (allowedOrigin !== '*' && allowedOrigin !== corsOrigin) ||
    (!allowedMethods.includes('*') && !allowedMethods.includes('PUT')) ||
    (!allowedHeaders.includes('*') && !allowedHeaders.includes('content-type'))
  ) {
    return err(probeError('storage.cors', 'The bucket CORS policy rejected the probe.'));
  }
  return ok(undefined);
};

const objectUrl = (configuration: StorageConfiguration, key: string): URL => {
  const url = new URL(configuration.endpoint);
  const keyPath = key.split('/').map(rfc3986).join('/');
  if (configuration.provider === 'aws_s3') {
    if (!url.hostname.startsWith(`${configuration.bucket}.`)) {
      url.hostname = `${configuration.bucket}.${url.hostname}`;
    }
    url.pathname = `/${keyPath}`;
    return url;
  }
  const prefix = url.pathname.replace(/\/$/, '');
  url.pathname = `${prefix}/${rfc3986(configuration.bucket)}/${keyPath}`;
  return url;
};

const liveProbe = async (
  configuration: StorageConfiguration,
  fetchStorage: FetchStorage,
  now: () => Date,
  keyFactory: () => string,
  corsOrigin: string,
  dispatcher: Dispatcher,
): Promise<Result<ProviderDiagnostic, AppError>> => {
  const key = `together-probe/${keyFactory()}.txt`;
  const url = objectUrl(configuration, key);
  const expected = `together storage probe ${key}`;
  const signed = (method: 'DELETE' | 'GET' | 'PUT'): string =>
    signObjectUrl(method, url, {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
      region: configuration.region,
      expiresInSeconds: PROBE_EXPIRY_SECONDS,
    }, now);

  const uploaded = await sendProbeRequest(fetchStorage, signed('PUT'), {
    method: 'PUT',
    body: expected,
  }, dispatcher, false);
  if (!uploaded.ok) return uploaded;

  const read = await sendProbeRequest(fetchStorage, signed('GET'), { method: 'GET' }, dispatcher, true);
  const readBack = read.ok ? read.value.body : null;
  const removed = await sendProbeRequest(fetchStorage, signed('DELETE'), { method: 'DELETE' }, dispatcher, false);

  if (!read.ok) return read;
  if (readBack !== expected) {
    return err(probeError('storage.unavailable', 'The storage probe read back different content.'));
  }
  if (!removed.ok) return removed;
  const cors = await verifyCors(fetchStorage, signed('PUT'), corsOrigin, dispatcher);
  if (!cors.ok) return cors;
  return ok({
    code: 'storage.available',
    message: 'Storage completed the write, read and delete probe.',
  });
};

const presign = (
  method: 'DELETE' | 'GET' | 'HEAD' | 'PUT',
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
  if (match === null && input.region === undefined) {
    return err(validation(`Cannot presign "${input.url}": not a virtual-hosted S3 URL`));
  }
  return ok(
    signObjectUrl(method, url, {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      region: input.region ?? match?.groups?.['region'] ?? 'us-east-1',
      expiresInSeconds: input.expiresInSeconds,
    }, now),
  );
};

const signObjectUrl = (
  method: 'DELETE' | 'GET' | 'HEAD' | 'PUT',
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
  if (!accessKeyId.ok) {
    return accessKeyId.error.code === 'not_found'
      ? err(integrationNotConfigured('Storage credentials are not configured.'))
      : accessKeyId;
  }
  if (!secretAccessKey.ok) {
    return secretAccessKey.error.code === 'not_found'
      ? err(integrationNotConfigured('Storage credentials are not configured.'))
      : secretAccessKey;
  }
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
  const fetchStorage = options.fetchStorage ?? undiciFetch;
  const probeKey = options.probeKey ?? randomUUID;
  const corsOrigin = new URL(options.corsOrigin ?? 'http://localhost:48730').origin;
  const allowPrivateEndpoints = options.allowPrivateEndpoints ?? false;
  const lookupAddresses = options.lookupAddresses ?? (async (hostname: string) =>
    (await dns.lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address));
  const sendObjectRequest = async (
    url: string,
    method: 'DELETE' | 'HEAD',
  ): Promise<Result<StorageResponse, AppError>> => {
    const safeTarget = await validateProbeEndpoint(new URL(url).origin, allowPrivateEndpoints, lookupAddresses);
    if (!safeTarget.ok) return safeTarget;
    const dispatcher = pinnedDispatcher(safeTarget.value);
    try {
      const response = await fetchStorage(url, { method, dispatcher, redirect: 'error' });
      await discardStorageResponseBody(response);
      return ok(response);
    } catch {
      return err(integrationUnavailable('Could not reach S3.'));
    } finally {
      await dispatcher.destroy();
    }
  };
  const probe = async (input: StorageConfiguration): Promise<Result<ProviderDiagnostic, AppError>> => {
    const target = objectUrl(input, 'together-probe');
    const safeTarget = await validateProbeEndpoint(target.origin, allowPrivateEndpoints, lookupAddresses);
    if (!safeTarget.ok) return safeTarget;
    const dispatcher = pinnedDispatcher(safeTarget.value);
    try {
      return await liveProbe(input, fetchStorage, now, probeKey, corsOrigin, dispatcher);
    } finally {
      await dispatcher.destroy();
    }
  };

  return {
    objectUrl,
    probe,
    presignPut: (input) => presign('PUT', input, now),
    presignGet: (input) => presign('GET', input, now),
    delete: async (input) => {
      const signed = presign('DELETE', { ...input, expiresInSeconds: 60 }, now);
      if (!signed.ok) return signed;
      const response = await sendObjectRequest(signed.value, 'DELETE');
      if (!response.ok) return response;
      return response.value.ok
        ? ok({ deleted: true })
        : err(integrationUnavailable(`S3 rejected the delete request with status ${String(response.value.status)}`));
    },
    head: async (input) => {
      const signed = presign('HEAD', { ...input, expiresInSeconds: 60 }, now);
      if (!signed.ok) return signed;
      const response = await sendObjectRequest(signed.value, 'HEAD');
      if (!response.ok) return response;
      if (!response.value.ok) {
        return err(integrationUnavailable(`S3 rejected the object metadata request with status ${String(response.value.status)}`));
      }
      const contentLength = response.value.headers.get('content-length');
      if (contentLength === null || !/^\d+$/.test(contentLength)) {
        return err(integrationUnavailable('S3 returned invalid object size metadata.'));
      }
      return ok({ sizeBytes: Number(contentLength) });
    },
    healthcheck: ({ tenantId }) => checkCredentials(resolver, tenantId),
    test: async ({ tenantId }) => {
      const configuration = await storedConfiguration(resolver, tenantId);
      if (!configuration.ok) return configuration;
      if (configuration.value !== null) {
        return probe(configuration.value);
      }
      return err(integrationNotConfigured('Storage is not configured.'));
    },
  };
};
