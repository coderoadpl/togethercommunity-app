import { createHash, createHmac, randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';

import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

import {
  err,
  integrationAuth,
  integrationNotConfigured,
  integrationUnavailable,
  notFound,
  ok,
  storageConfigurationSchema,
  storageListInputSchema,
  validation,
  type AppError,
  type ProviderDiagnostic,
  type Result,
  type StorageConfiguration,
  type StorageCorsProbeResult,
  type StorageProbeErrorCode,
} from '#core/domain/index.js';
import { privateNetworkAddress, privateNetworkHostname } from '#core/domain/network.js';
import type { StorageProvider, TenantSecretResolver } from '#core/server/index.js';

import { parseListObjectsPage } from './list-objects.js';

const S3_HOST_PATTERN =
  /^(?<bucket>[a-z0-9][a-z0-9.-]*)\.s3(?:[.-](?<region>[a-z0-9-]+))?\.amazonaws\.com$/;

const PROBE_EXPIRY_SECONDS = 60;
const CORS_PROBE_TIMEOUT_MS = 5_000;
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const PROBE_REQUEST_TIMEOUT_MS = 10_000;
const PROBE_ERROR_BODY_MAX_BYTES = 8 * 1024;
const HEAD_DEADLINE_MS = 5_000;
const DELETE_DEADLINE_MS = 10_000;

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
  contentLength?: number;
};

interface StorageResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: {
    cancel(): Promise<void>;
    getReader?(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    };
  } | null;
  text(): Promise<string>;
}

type FetchStorage = (
  url: string,
  init: {
    method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PUT';
    body?: string | Uint8Array;
    headers?: Record<string, string>;
    dispatcher?: Dispatcher;
    redirect?: 'error';
    signal?: AbortSignal;
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
  details: { corsOrigin?: string } = {},
): AppError =>
  providerCode === 'storage.credentials'
    ? integrationAuth(message, { providerCode, ...details })
    : integrationUnavailable(message, { providerCode, ...details });

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

const abortable = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(new Error('The storage probe deadline passed.')); };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort); });
  });

const withDeadline = async <T>(
  deadlineMs: number,
  work: (signal: AbortSignal) => Promise<Result<T, AppError>>,
  failure: string,
): Promise<Result<T, AppError>> => {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) return err(validation('Invalid storage request deadline'));
  const deadline = new AbortController();
  const timer = setTimeout(() => { deadline.abort(); }, deadlineMs);
  try {
    return await work(deadline.signal);
  } catch {
    return err(integrationUnavailable(deadline.signal.aborted ? `${failure}: the storage request deadline passed` : failure));
  } finally {
    clearTimeout(timer);
  }
};

const copySource = (bucket: string, key: string): string =>
  `/${rfc3986(bucket)}/${key.split('/').map(rfc3986).join('/')}`;

const unreadableProbeResponse = (): AppError =>
  probeError('storage.unavailable', 'The storage endpoint response could not be read.');

const readProbeBody = async (
  response: StorageResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Result<string, AppError>> => {
  if (response.body === null) return ok('');
  if (response.body.getReader === undefined) {
    await abortable(discardStorageResponseBody(response), signal).catch(() => undefined);
    return err(unreadableProbeResponse());
  }
  const reader = response.body.getReader();
  const stop = (error: AppError): Result<string, AppError> => {
    void reader.cancel().catch(() => undefined);
    return err(error);
  };
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) return ok(text + decoder.decode());
      if (chunk.value === undefined) return stop(unreadableProbeResponse());
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        return stop(probeError('storage.unavailable', 'The storage endpoint response exceeds the probe byte ceiling.'));
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return stop(unreadableProbeResponse());
  } finally {
    reader.releaseLock();
  }
};

const sendProbeRequest = async (
  fetchStorage: FetchStorage,
  url: string,
  init: { method: 'DELETE' | 'GET' | 'PUT'; body?: string },
  dispatcher: Dispatcher,
  maxBodyBytes: number | null,
): Promise<Result<{ body: string }, AppError>> => {
  const deadline = new AbortController();
  const { signal } = deadline;
  const timer = setTimeout(() => { deadline.abort(); }, PROBE_REQUEST_TIMEOUT_MS);
  try {
    let response: StorageResponse;
    try {
      response = await abortable(fetchStorage(url, { ...init, dispatcher, redirect: 'error', signal }), signal);
    } catch {
      return err(probeError('storage.unavailable', 'The storage endpoint is unreachable.'));
    }
    if (!response.ok) {
      const body = await readProbeBody(response, PROBE_ERROR_BODY_MAX_BYTES, signal);
      return err(mapStorageProbeFailure(response.status, body.ok ? body.value : ''));
    }
    if (maxBodyBytes === null) {
      try {
        await abortable(discardStorageResponseBody(response), signal);
        return ok({ body: '' });
      } catch {
        return err(unreadableProbeResponse());
      }
    }
    const body = await readProbeBody(response, maxBodyBytes, signal);
    return body.ok ? ok({ body: body.value }) : body;
  } finally {
    clearTimeout(timer);
  }
};

const validateProbeEndpoint = async (
  endpoint: string,
  allowPrivateEndpoints: boolean,
  lookupAddresses: (hostname: string) => Promise<string[]>,
): Promise<Result<{ address: string }, AppError>> => {
  const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivateEndpoints && privateNetworkHostname(hostname)) {
    return err(probeError('storage.unavailable', 'Private storage endpoints are disabled.'));
  }
  if (isIP(hostname) !== 0) return ok({ address: hostname });
  let addresses: string[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookupAddresses(hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('DNS lookup timed out')); }, DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return err(probeError('storage.unavailable', 'The storage endpoint hostname could not be resolved.'));
  } finally {
    clearTimeout(timer);
  }
  if (addresses.length === 0) {
    return err(probeError('storage.unavailable', 'The storage endpoint hostname could not be resolved.'));
  }
  if (addresses.some((address) => isIP(address) === 0)) {
    return err(probeError('storage.unavailable', 'The storage endpoint hostname could not be resolved.'));
  }
  if (!allowPrivateEndpoints && addresses.some(privateNetworkAddress)) {
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
      signal: AbortSignal.timeout(CORS_PROBE_TIMEOUT_MS),
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
    return err(probeError(
      'storage.cors',
      `The bucket CORS policy rejected origin ${corsOrigin}.`,
      { corsOrigin },
    ));
  }
  return ok(undefined);
};

const storageCorsProbeStatus = (result: Result<undefined, AppError>): StorageCorsProbeResult['status'] => {
  if (result.ok) return 'ok';
  const details = result.error.details;
  return typeof details === 'object' &&
    details !== null &&
    'providerCode' in details &&
    details.providerCode === 'storage.cors'
    ? 'blocked'
    : 'unknown';
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
  corsOrigins: string[],
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
  }, dispatcher, null);
  if (!uploaded.ok) return uploaded;

  const read = await sendProbeRequest(
    fetchStorage,
    signed('GET'),
    { method: 'GET' },
    dispatcher,
    new TextEncoder().encode(expected).byteLength,
  );
  const readBack = read.ok ? read.value.body : null;
  const removed = await sendProbeRequest(fetchStorage, signed('DELETE'), { method: 'DELETE' }, dispatcher, null);

  if (!read.ok) return read;
  if (readBack !== expected) {
    return err(probeError('storage.unavailable', 'The storage probe read back different content.'));
  }
  if (!removed.ok) return removed;
  for (const origin of corsOrigins) {
    const cors = await verifyCors(fetchStorage, signed('PUT'), origin, dispatcher);
    if (!cors.ok) return cors;
  }
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
  if (input.contentLength !== undefined && (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0)) {
    return err(validation(`Cannot presign "${input.url}": invalid content length`));
  }
  return ok(
    signObjectUrl(method, url, {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      region: input.region ?? match?.groups?.['region'] ?? 'us-east-1',
      expiresInSeconds: input.expiresInSeconds,
    }, now, input.contentLength === undefined ? {} : { 'content-length': String(input.contentLength) }),
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
  extraSignedHeaders: Readonly<Record<string, string>> = {},
): string => {
  const url = target;
  const region = input.region;
  const at = now();
  const amzDate = `${at.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const headers = Object.entries({ ...extraSignedHeaders, host: url.host }).sort(([a], [b]) => byCodePoint(a, b));
  const signedHeaders = headers.map(([name]) => name).join(';');
  const query: [string, string][] = [
    ...url.searchParams.entries(),
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresInSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
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
    ...headers.map(([name, value]) => `${name}:${value}`),
    '',
    signedHeaders,
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
    deadlineMs: number,
  ): Promise<Result<StorageResponse, AppError>> => withDeadline(deadlineMs, async (signal) => {
    const safeTarget = await abortable(validateProbeEndpoint(new URL(url).origin, allowPrivateEndpoints, lookupAddresses), signal);
    if (!safeTarget.ok) return safeTarget;
    const dispatcher = pinnedDispatcher(safeTarget.value);
    try {
      const response = await abortable(fetchStorage(url, { method, dispatcher, redirect: 'error', signal }), signal);
      await abortable(discardStorageResponseBody(response), signal);
      return ok(response);
    } finally {
      await dispatcher.destroy();
    }
  }, 'Could not reach S3.');
  const copyObject: StorageProvider['copyObject'] = async ({ configuration, sourceKey, key, deadlineMs }) => {
    const target = objectUrl(configuration, key);
    const headers = {
      'cache-control': 'no-store',
      'content-disposition': 'attachment',
      'content-type': 'application/octet-stream',
      'x-amz-copy-source': copySource(configuration.bucket, sourceKey),
      'x-amz-metadata-directive': 'REPLACE',
    };
    const signed = signObjectUrl('PUT', target, { ...configuration, expiresInSeconds: 60 }, now, headers);
    return withDeadline(deadlineMs, async (signal) => {
      const safeTarget = await abortable(validateProbeEndpoint(target.origin, allowPrivateEndpoints, lookupAddresses), signal);
      if (!safeTarget.ok) return safeTarget;
      const dispatcher = pinnedDispatcher(safeTarget.value);
      try {
        const response = await abortable(fetchStorage(signed, { method: 'PUT', dispatcher, redirect: 'error', signal, headers }), signal);
        const body = await readProbeBody(response, PROBE_ERROR_BODY_MAX_BYTES, signal);
        if (response.status === 404) return err(notFound('No storage object at the copy source'));
        // A copy can fail after S3 has already answered 200, and then the error is in the body.
        if (!response.ok || !body.ok || /<Error>/u.test(body.value)) {
          return err(integrationUnavailable(`S3 rejected the copy request with status ${String(response.status)}`));
        }
        return ok(undefined);
      } finally {
        await dispatcher.destroy();
      }
    }, 'Could not copy the storage object');
  };
  const digestObject: StorageProvider['digestObject'] = async (input, { maxBytes, headBytes }) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(headBytes) || headBytes < 0) {
      return err(validation('Invalid object byte ceiling'));
    }
    const signed = presign('GET', { ...input, expiresInSeconds: 60 }, now);
    if (!signed.ok) return signed;
    return withDeadline(input.deadlineMs, async (signal) => {
      const safeTarget = await abortable(validateProbeEndpoint(new URL(signed.value).origin, allowPrivateEndpoints, lookupAddresses), signal);
      if (!safeTarget.ok) return safeTarget;
      const dispatcher = pinnedDispatcher(safeTarget.value);
      try {
        const response = await abortable(fetchStorage(signed.value, {
          method: 'GET', dispatcher, redirect: 'error', signal, headers: { 'Accept-Encoding': 'identity' },
        }), signal);
        if (response.status === 404) {
          await abortable(discardStorageResponseBody(response), signal);
          return err(notFound('No storage object at this key'));
        }
        const length = response.headers.get('content-length');
        const size = length !== null && /^\d+$/.test(length) ? Number(length) : NaN;
        if (!response.ok || !Number.isSafeInteger(size) || size < 1 || size > maxBytes ||
          (response.headers.get('content-encoding') ?? 'identity') !== 'identity' || !response.body?.getReader) {
          await abortable(discardStorageResponseBody(response), signal);
          return err(integrationUnavailable('Object is unavailable or exceeds the byte ceiling'));
        }
        const reader = response.body.getReader();
        try {
          const hash = createHash('sha256');
          const head = new Uint8Array(Math.min(headBytes, size));
          let offset = 0;
          for (;;) {
            const chunk = await abortable(reader.read(), signal);
            if (chunk.done) break;
            if (chunk.value === undefined || offset + chunk.value.byteLength > size) {
              void reader.cancel().catch(() => undefined);
              return err(integrationUnavailable('Object exceeds its declared size'));
            }
            if (offset < head.byteLength) head.set(chunk.value.subarray(0, head.byteLength - offset), offset);
            hash.update(chunk.value);
            offset += chunk.value.byteLength;
          }
          return offset === size
            ? ok({ sha256: hash.digest('hex'), sizeBytes: size, head })
            : err(integrationUnavailable('Object size does not match its metadata'));
        } finally {
          reader.releaseLock();
        }
      } finally {
        await dispatcher.destroy();
      }
    }, 'Could not read the storage object');
  };
  const probeOrigins = (corsOrigins: string[] | undefined): string[] =>
    corsOrigins === undefined || corsOrigins.length === 0
      ? [corsOrigin]
      : [...new Set(corsOrigins.map((origin) => new URL(origin).origin))];
  const probe = async (
    input: StorageConfiguration,
    corsOrigins?: string[],
  ): Promise<Result<ProviderDiagnostic, AppError>> => {
    const target = objectUrl(input, 'together-probe');
    const safeTarget = await validateProbeEndpoint(target.origin, allowPrivateEndpoints, lookupAddresses);
    if (!safeTarget.ok) return safeTarget;
    const dispatcher = pinnedDispatcher(safeTarget.value);
    try {
      return await liveProbe(input, fetchStorage, now, probeKey, probeOrigins(corsOrigins), dispatcher);
    } finally {
      await dispatcher.destroy();
    }
  };
  const probeCors = async (
    input: StorageConfiguration,
    origins: string[],
  ): Promise<StorageCorsProbeResult[]> => {
    const normalizedOrigins = probeOrigins(origins);
    const target = objectUrl(input, 'together-cors-probe');
    const safeTarget = await validateProbeEndpoint(target.origin, allowPrivateEndpoints, lookupAddresses);
    if (!safeTarget.ok) {
      return normalizedOrigins.map((origin) => ({ origin, status: 'unknown' }));
    }
    const signed = signObjectUrl('PUT', target, {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      region: input.region,
      expiresInSeconds: PROBE_EXPIRY_SECONDS,
    }, now);
    const dispatcher = pinnedDispatcher(safeTarget.value);
    try {
      return await Promise.all(normalizedOrigins.map(async (origin) => {
        const result = await verifyCors(fetchStorage, signed, origin, dispatcher);
        return { origin, status: storageCorsProbeStatus(result) };
      }));
    } finally {
      await dispatcher.destroy();
    }
  };

  return {
    list: async (input) => {
      const parsed = storageListInputSchema.safeParse(input);
      if (!parsed.success) return err(validation('Invalid storage listing request'));
      const { configuration, prefix, continuationToken, limit } = parsed.data;
      const target = objectUrl(configuration, '');
      target.searchParams.set('list-type', '2');
      target.searchParams.set('encoding-type', 'url');
      target.searchParams.set('prefix', prefix);
      target.searchParams.set('max-keys', String(limit));
      if (continuationToken !== null) target.searchParams.set('continuation-token', continuationToken);
      const safeTarget = await validateProbeEndpoint(target.origin, allowPrivateEndpoints, lookupAddresses);
      if (!safeTarget.ok) return safeTarget;
      const signed = signObjectUrl('GET', target, { ...configuration, expiresInSeconds: 60 }, now);
      const dispatcher = pinnedDispatcher(safeTarget.value);
      try {
        const response = await fetchStorage(signed, {
          method: 'GET', dispatcher, redirect: 'error', signal: AbortSignal.timeout(30_000),
          headers: { 'Accept-Encoding': 'identity' },
        });
        if (!response.ok || !response.body?.getReader
          || (response.headers.get('content-encoding') ?? 'identity') !== 'identity') {
          await discardStorageResponseBody(response);
          return err(integrationUnavailable('S3 object listing is unavailable.'));
        }
        const reader = response.body.getReader();
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          let bytes = 0;
          let xml = '';
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value?.byteLength ?? 0;
            if (chunk.value === undefined || bytes > 2 * 1024 * 1024) {
              await reader.cancel();
              return err(integrationUnavailable('S3 object listing exceeds the byte ceiling.'));
            }
            xml += decoder.decode(chunk.value, { stream: true });
          }
          xml += decoder.decode();
          const page = parseListObjectsPage(xml);
          if (page.ok && (page.value.objects.length > limit
            || page.value.objects.some((object) => !object.key.startsWith(prefix)))) {
            return err(integrationUnavailable('S3 returned objects outside the requested listing.'));
          }
          return page;
        } finally {
          reader.releaseLock();
        }
      } catch {
        return err(integrationUnavailable('Could not read the S3 object listing.'));
      } finally {
        await dispatcher.destroy();
      }
    },
    objectUrl,
    probe,
    probeCors,
    presignPut: (input) => presign('PUT', input, now),
    presignGet: (input) => presign('GET', input, now),
    copyObject,
    digestObject,
    delete: async (input) => {
      const signed = presign('DELETE', { ...input, expiresInSeconds: 60 }, now);
      if (!signed.ok) return signed;
      const response = await sendObjectRequest(signed.value, 'DELETE', input.deadlineMs ?? DELETE_DEADLINE_MS);
      if (!response.ok) return response;
      return response.value.ok
        ? ok({ deleted: true })
        : err(integrationUnavailable(`S3 rejected the delete request with status ${String(response.value.status)}`));
    },
    head: async (input) => {
      const signed = presign('HEAD', { ...input, expiresInSeconds: 60 }, now);
      if (!signed.ok) return signed;
      const response = await sendObjectRequest(signed.value, 'HEAD', input.deadlineMs ?? HEAD_DEADLINE_MS);
      if (!response.ok) return response;
      if (response.value.status === 404) return err(notFound('No storage object at this key'));
      if (!response.value.ok) {
        return err(integrationUnavailable(`S3 rejected the object metadata request with status ${String(response.value.status)}`));
      }
      const contentLength = response.value.headers.get('content-length');
      if (contentLength === null || !/^\d+$/.test(contentLength)) {
        return err(integrationUnavailable('S3 returned invalid object size metadata.'));
      }
      return ok({ sizeBytes: Number(contentLength) });
    },
    putObject: async (input) => {
      const signed = presign('PUT', { ...input, expiresInSeconds: 60 }, now);
      if (!signed.ok) return signed;
      const safeTarget = await validateProbeEndpoint(new URL(signed.value).origin, allowPrivateEndpoints, lookupAddresses);
      if (!safeTarget.ok) return safeTarget;
      const dispatcher = pinnedDispatcher(safeTarget.value);
      try {
        const response = await fetchStorage(signed.value, {
          method: 'PUT', dispatcher, redirect: 'error', signal: AbortSignal.timeout(30_000),
          headers: { 'content-type': input.contentType }, body: input.body,
        });
        await discardStorageResponseBody(response);
        return response.ok ? ok(undefined) : err(integrationUnavailable('S3 rejected the published image'));
      } catch {
        return err(integrationUnavailable('Could not store the published image'));
      } finally {
        await dispatcher.destroy();
      }
    },
    getObject: async (input, { maxBytes, range = false }) => {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return err(validation('Invalid object byte ceiling'));
      const signed = presign('GET', { ...input, expiresInSeconds: 60 }, now);
      if (!signed.ok) return signed;
      const safeTarget = await validateProbeEndpoint(new URL(signed.value).origin, allowPrivateEndpoints, lookupAddresses);
      if (!safeTarget.ok) return safeTarget;
      const dispatcher = pinnedDispatcher(safeTarget.value);
      try {
        const response = await fetchStorage(signed.value, {
          method: 'GET', dispatcher, redirect: 'error', signal: AbortSignal.timeout(30_000),
          headers: { 'Accept-Encoding': 'identity', ...(range ? { Range: `bytes=0-${String(maxBytes)}` } : {}) },
        });
        if (response.status === 404) {
          await discardStorageResponseBody(response);
          return err(notFound('No storage object at this key'));
        }
        const length = response.headers.get('content-length');
        const size = length !== null && /^\d+$/.test(length) ? Number(length) : NaN;
        const contentRange = response.headers.get('content-range');
        const rangeMatch = contentRange === null ? null : /^bytes 0-(\d+)\/(\d+)$/u.exec(contentRange);
        if (range && (size > maxBytes || (rangeMatch !== null && Number(rangeMatch[2]) > maxBytes))) {
          await discardStorageResponseBody(response);
          return err(validation('Object exceeds the byte ceiling'));
        }
        if (range && response.status === 206 && (rangeMatch === null
          || Number(rangeMatch[1]) + 1 !== size || Number(rangeMatch[2]) !== size)) {
          await discardStorageResponseBody(response);
          return err(integrationUnavailable('S3 returned an incomplete object range'));
        }
        if (!response.ok || !Number.isSafeInteger(size) || size < 1 || size > maxBytes ||
          (response.headers.get('content-encoding') ?? 'identity') !== 'identity' || !response.body?.getReader) {
          await discardStorageResponseBody(response);
          return err(integrationUnavailable('Object is unavailable or exceeds the byte ceiling'));
        }
        const reader = response.body.getReader();
        try {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (chunk.value === undefined || offset + chunk.value.byteLength > size) {
              await reader.cancel();
              return err(integrationUnavailable('Object exceeds its declared size'));
            }
            bytes.set(chunk.value, offset);
            offset += chunk.value.byteLength;
          }
          return offset === size ? ok(bytes) : err(integrationUnavailable('Object size does not match its metadata'));
        } finally {
          reader.releaseLock();
        }
      } catch {
        return err(integrationUnavailable('Could not read the bounded storage object'));
      } finally {
        await dispatcher.destroy();
      }
    },
    healthcheck: ({ tenantId }) => checkCredentials(resolver, tenantId),
    test: async ({ tenantId, corsOrigins }) => {
      const configuration = await storedConfiguration(resolver, tenantId);
      if (!configuration.ok) return configuration;
      if (configuration.value !== null) {
        return probe(configuration.value, corsOrigins);
      }
      return err(integrationNotConfigured('Storage is not configured.'));
    },
  };
};
