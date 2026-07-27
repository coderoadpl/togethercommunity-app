import {
  constants,
  createCipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
  X509Certificate,
} from 'node:crypto';

import { z } from 'zod';

import {
  appError,
  err,
  integrationAuth,
  integrationUnavailable,
  ok,
  validation,
  type AppError,
  type KsefEnvironment,
  type Result,
} from '@core/domain/index.js';
import type { KsefClientPort, KsefCredentials } from '@core/server/index.js';

const tokenInfoSchema = z.object({
  token: z.string(),
  validUntil: z.string(),
});
const challengeSchema = z.object({
  challenge: z.string(),
  timestampMs: z.number(),
});
const certificateSchema = z.object({
  certificate: z.string(),
  publicKeyId: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  usage: z.array(z.string()),
});
const authInitSchema = z.object({
  referenceNumber: z.string(),
  authenticationToken: tokenInfoSchema,
});
const statusSchema = z.object({
  code: z.number(),
  description: z.string(),
  details: z.array(z.string()).optional().default([]),
  extensions: z.record(z.unknown()).optional().default({}),
});
const authStatusSchema = z.object({ status: statusSchema });
const tokensSchema = z.object({
  accessToken: tokenInfoSchema,
  refreshToken: tokenInfoSchema,
});
const refreshedTokenSchema = z.object({ accessToken: tokenInfoSchema });
const openSessionSchema = z.object({
  referenceNumber: z.string(),
  validUntil: z.string(),
});
const submitSchema = z.object({ referenceNumber: z.string() });
const invoiceStatusSchema = z.object({
  invoiceNumber: z.string().optional(),
  ksefNumber: z.string().optional(),
  referenceNumber: z.string(),
  invoiceHash: z.string().optional(),
  acquisitionDate: z.string().optional(),
  invoicingDate: z.string().optional(),
  permanentStorageDate: z.string().optional(),
  status: statusSchema,
});
const sessionInvoicesSchema = z.object({
  invoices: z.array(invoiceStatusSchema),
  continuationToken: z.string().nullable().optional(),
});

interface KsefClientOptions {
  fetcher?: typeof fetch;
  baseUrls: Record<KsefEnvironment, string>;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
}

interface CachedTokens {
  accessToken: string;
  accessValidUntil: string;
  refreshToken: string;
  refreshValidUntil: string;
}

interface SessionMaterial {
  reference: string;
  validUntil: string;
  symmetricKey: Uint8Array;
  initializationVector: Uint8Array;
}

const digestHex = (content: string | Uint8Array): string =>
  createHash('sha256').update(content).digest('hex');

const digestBase64 = (content: string | Uint8Array): string =>
  createHash('sha256').update(content).digest('base64');

const encryptedForCertificate = (content: Uint8Array, certificate: string): Buffer => {
  const publicKey = new X509Certificate(Buffer.from(certificate, 'base64')).publicKey;
  return publicEncrypt({
    key: publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, content);
};

const responseError = async (response: Response): Promise<AppError> => {
  const body = await response.clone().json().catch(() => null);
  if (response.status === 401) return integrationAuth('KSeF access token was rejected');
  if (response.status === 403) return integrationAuth('KSeF token lacks InvoiceWrite permission');
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const seconds = retryAfter === null ? null : Number(retryAfter);
    return appError('rate_limited', 'KSeF rate limit reached', {
      retryAfterMs: Number.isFinite(seconds) ? Math.max(0, seconds ?? 0) * 1000 : null,
    });
  }
  if (response.status >= 500) return integrationUnavailable(`KSeF returned HTTP ${String(response.status)}`);
  return validation(`KSeF rejected the request with HTTP ${String(response.status)}`, body);
};

const sessionKey = (
  environment: KsefEnvironment,
  credentials: KsefCredentials,
): string => `${environment}:${credentials.tenantId}:${credentials.contextNip}`;

export const createKsefClient = (options: KsefClientOptions): KsefClientPort => {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? ((milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const tokens = new Map<string, CachedTokens>();
  const sessions = new Map<string, SessionMaterial>();

  const request = (
    environment: KsefEnvironment,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('X-Error-Format', 'problem-details');
    return fetcher(`${options.baseUrls[environment]}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
  };

  const publicCertificates = async (
    environment: KsefEnvironment,
  ): Promise<Result<z.infer<typeof certificateSchema>[], AppError>> => {
    try {
      const response = await request(environment, '/security/public-key-certificates');
      if (!response.ok) return err(await responseError(response));
      const parsed = z.array(certificateSchema).safeParse(await response.json());
      return parsed.success
        ? ok(parsed.data)
        : err(integrationUnavailable('KSeF returned invalid public certificates'));
    } catch {
      return err(integrationUnavailable('KSeF public certificate endpoint is unreachable'));
    }
  };

  const activeCertificate = async (
    environment: KsefEnvironment,
    usage: 'KsefTokenEncryption' | 'SymmetricKeyEncryption',
  ): Promise<Result<z.infer<typeof certificateSchema>, AppError>> => {
    const certificates = await publicCertificates(environment);
    if (!certificates.ok) return certificates;
    const timestamp = now().getTime();
    const certificate = certificates.value.find((candidate) =>
      candidate.usage.includes(usage)
      && Date.parse(candidate.validFrom) <= timestamp
      && Date.parse(candidate.validTo) > timestamp);
    return certificate === undefined
      ? err(integrationUnavailable(`KSeF has no active ${usage} certificate`))
      : ok(certificate);
  };

  const bootstrap = async (
    environment: KsefEnvironment,
    credentials: KsefCredentials,
  ): Promise<Result<CachedTokens, AppError>> => {
    try {
      const challengeResponse = await request(environment, '/auth/challenge', { method: 'POST' });
      if (!challengeResponse.ok) return err(await responseError(challengeResponse));
      const challenge = challengeSchema.safeParse(await challengeResponse.json());
      if (!challenge.success) return err(integrationUnavailable('KSeF returned an invalid auth challenge'));
      const certificate = await activeCertificate(environment, 'KsefTokenEncryption');
      if (!certificate.ok) return certificate;
      const encryptedToken = encryptedForCertificate(
        new TextEncoder().encode(`${credentials.token}|${String(challenge.data.timestampMs)}`),
        certificate.value.certificate,
      ).toString('base64');
      const initResponse = await request(environment, '/auth/ksef-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challenge: challenge.data.challenge,
          contextIdentifier: { type: 'Nip', value: credentials.contextNip },
          encryptedToken,
          publicKeyId: certificate.value.publicKeyId,
        }),
      });
      if (!initResponse.ok) return err(await responseError(initResponse));
      const initialized = authInitSchema.safeParse(await initResponse.json());
      if (!initialized.success) return err(integrationUnavailable('KSeF returned an invalid auth operation'));
      let complete = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const pollResponse = await request(
          environment,
          `/auth/${encodeURIComponent(initialized.data.referenceNumber)}`,
          { headers: { authorization: `Bearer ${initialized.data.authenticationToken.token}` } },
        );
        if (!pollResponse.ok) return err(await responseError(pollResponse));
        const polled = authStatusSchema.safeParse(await pollResponse.json());
        if (!polled.success) return err(integrationUnavailable('KSeF returned an invalid auth status'));
        if (polled.data.status.code === 200) {
          complete = true;
          break;
        }
        if (polled.data.status.code !== 100) {
          return err(integrationAuth(`KSeF authentication failed: ${polled.data.status.description}`));
        }
        await wait(500);
      }
      if (!complete) return err(integrationUnavailable('KSeF authentication did not complete in time'));
      const redeemResponse = await request(environment, '/auth/token/redeem', {
        method: 'POST',
        headers: { authorization: `Bearer ${initialized.data.authenticationToken.token}` },
      });
      if (!redeemResponse.ok) return err(await responseError(redeemResponse));
      const redeemed = tokensSchema.safeParse(await redeemResponse.json());
      if (!redeemed.success) return err(integrationUnavailable('KSeF returned invalid access tokens'));
      const cached = {
        accessToken: redeemed.data.accessToken.token,
        accessValidUntil: redeemed.data.accessToken.validUntil,
        refreshToken: redeemed.data.refreshToken.token,
        refreshValidUntil: redeemed.data.refreshToken.validUntil,
      };
      tokens.set(sessionKey(environment, credentials), cached);
      return ok(cached);
    } catch {
      return err(integrationUnavailable('KSeF authentication is unreachable'));
    }
  };

  const refresh = async (
    environment: KsefEnvironment,
    credentials: KsefCredentials,
    cached: CachedTokens,
  ): Promise<Result<CachedTokens, AppError>> => {
    try {
      const response = await request(environment, '/auth/token/refresh', {
        method: 'POST',
        headers: { authorization: `Bearer ${cached.refreshToken}` },
      });
      if (!response.ok) return bootstrap(environment, credentials);
      const parsed = refreshedTokenSchema.safeParse(await response.json());
      if (!parsed.success) return err(integrationUnavailable('KSeF returned an invalid refreshed token'));
      const refreshed = {
        ...cached,
        accessToken: parsed.data.accessToken.token,
        accessValidUntil: parsed.data.accessToken.validUntil,
      };
      tokens.set(sessionKey(environment, credentials), refreshed);
      return ok(refreshed);
    } catch {
      return err(integrationUnavailable('KSeF token refresh is unreachable'));
    }
  };

  const access = async (
    environment: KsefEnvironment,
    credentials: KsefCredentials,
  ): Promise<Result<CachedTokens, AppError>> => {
    const cached = tokens.get(sessionKey(environment, credentials));
    if (cached === undefined) return bootstrap(environment, credentials);
    if (Date.parse(cached.accessValidUntil) - now().getTime() > 30_000) return ok(cached);
    if (Date.parse(cached.refreshValidUntil) <= now().getTime()) return bootstrap(environment, credentials);
    return refresh(environment, credentials, cached);
  };

  const protectedRequest = async (
    environment: KsefEnvironment,
    credentials: KsefCredentials,
    path: string,
    init: RequestInit = {},
  ): Promise<Result<Response, AppError>> => {
    const authorized = await access(environment, credentials);
    if (!authorized.ok) return authorized;
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      return request(environment, path, { ...init, headers });
    };
    try {
      let response = await send(authorized.value.accessToken);
      if (response.status === 401) {
        const refreshed = await refresh(environment, credentials, authorized.value);
        if (!refreshed.ok) return refreshed;
        response = await send(refreshed.value.accessToken);
      }
      return response.ok ? ok(response) : err(await responseError(response));
    } catch {
      return err(integrationUnavailable('KSeF request outcome is unknown'));
    }
  };

  const parsedJson = async <T>(
    response: Result<Response, AppError>,
    schema: z.ZodType<T>,
    invalidMessage: string,
  ): Promise<Result<T, AppError>> => {
    if (!response.ok) return response;
    const parsed = schema.safeParse(await response.value.json().catch(() => null));
    return parsed.success ? ok(parsed.data) : err(integrationUnavailable(invalidMessage));
  };

  const listRaw = async (
    environment: KsefEnvironment,
    credentials: KsefCredentials,
    reference: string,
  ): Promise<Result<z.input<typeof sessionInvoicesSchema>, AppError>> => {
    const invoices: z.input<typeof invoiceStatusSchema>[] = [];
    let continuationToken: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const listed: Result<z.input<typeof sessionInvoicesSchema>, AppError> = await parsedJson(
        await protectedRequest(
          environment,
          credentials,
          `/sessions/${encodeURIComponent(reference)}/invoices?pageSize=1000`,
          continuationToken === null
            ? {}
            : { headers: { 'x-continuation-token': continuationToken } },
        ),
        sessionInvoicesSchema,
        'KSeF returned an invalid session invoice list',
      );
      if (!listed.ok) return listed;
      invoices.push(...listed.value.invoices);
      continuationToken = listed.value.continuationToken ?? null;
      if (continuationToken === null) return ok({ invoices, continuationToken: null });
    }
    return err(integrationUnavailable('KSeF session invoice listing exceeded 10000 items'));
  };

  return {
    validateCredentials: async ({ environment, credentials }) => {
      const authenticated = await access(environment, credentials);
      return authenticated.ok
        ? ok({ diagnostic: 'KSeF accepted the token for this NIP context.' })
        : authenticated;
    },
    openSession: async ({ environment, credentials }) => {
      const key = sessionKey(environment, credentials);
      const existing = sessions.get(key);
      if (existing !== undefined && Date.parse(existing.validUntil) - now().getTime() > 60_000) {
        return ok({ sessionReference: existing.reference });
      }
      const certificate = await activeCertificate(environment, 'SymmetricKeyEncryption');
      if (!certificate.ok) return certificate;
      const symmetricKey = randomBytes(32);
      const initializationVector = randomBytes(16);
      const opened = await parsedJson(
        await protectedRequest(environment, credentials, '/sessions/online', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-KSeF-Feature': 'upo-v4-3',
          },
          body: JSON.stringify({
            formCode: { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' },
            encryption: {
              encryptedSymmetricKey: encryptedForCertificate(
                symmetricKey,
                certificate.value.certificate,
              ).toString('base64'),
              initializationVector: initializationVector.toString('base64'),
              publicKeyId: certificate.value.publicKeyId,
            },
          }),
        }),
        openSessionSchema,
        'KSeF returned an invalid session reference',
      );
      if (!opened.ok) return opened;
      sessions.set(key, {
        reference: opened.value.referenceNumber,
        validUntil: opened.value.validUntil,
        symmetricKey,
        initializationVector,
      });
      return ok({ sessionReference: opened.value.referenceNumber });
    },
    submitInvoice: async ({ environment, credentials, sessionReference, xml, invoiceHashHex }) => {
      if (digestHex(xml) !== invoiceHashHex) {
        return err(validation('Frozen FA(3) hash does not match its exact bytes'));
      }
      const material = sessions.get(sessionKey(environment, credentials));
      if (material === undefined || material.reference !== sessionReference) {
        return err(integrationUnavailable('KSeF session encryption material is not available'));
      }
      const invoiceBytes = Buffer.from(xml, 'utf8');
      const cipher = createCipheriv('aes-256-cbc', material.symmetricKey, material.initializationVector);
      const encrypted = Buffer.concat([cipher.update(invoiceBytes), cipher.final()]);
      const submitted = await parsedJson(
        await protectedRequest(
          environment,
          credentials,
          `/sessions/online/${encodeURIComponent(sessionReference)}/invoices`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              invoiceHash: digestBase64(invoiceBytes),
              invoiceSize: invoiceBytes.byteLength,
              encryptedInvoiceHash: digestBase64(encrypted),
              encryptedInvoiceSize: encrypted.byteLength,
              encryptedInvoiceContent: encrypted.toString('base64'),
              offlineMode: false,
            }),
          },
        ),
        submitSchema,
        'KSeF returned an invalid invoice reference',
      );
      return submitted.ok ? ok({ invoiceReference: submitted.value.referenceNumber }) : submitted;
    },
    listSessionInvoices: async ({ environment, credentials, sessionReference }) => {
      const listed = await listRaw(environment, credentials, sessionReference);
      return listed.ok
        ? ok(listed.value.invoices.map((invoice) => ({
            invoiceReference: invoice.referenceNumber,
            invoiceHash: invoice.invoiceHash ?? '',
            status: {
              ...invoice.status,
              details: invoice.status.details ?? [],
              extensions: invoice.status.extensions ?? {},
            },
          })))
        : listed;
    },
    getInvoiceStatus: async ({ environment, credentials, sessionReference, invoiceReference }) => {
      const status = await parsedJson(
        await protectedRequest(
          environment,
          credentials,
          `/sessions/${encodeURIComponent(sessionReference)}/invoices/${encodeURIComponent(invoiceReference)}`,
        ),
        invoiceStatusSchema,
        'KSeF returned an invalid invoice status',
      );
      return status.ok
        ? ok({
            ...status.value.status,
            details: status.value.status.details ?? [],
            extensions: status.value.status.extensions ?? {},
            ksefNumber: status.value.ksefNumber ?? null,
            acquisitionAt: status.value.acquisitionDate ?? null,
            invoicingAt: status.value.invoicingDate ?? null,
            permanentStorageAt: status.value.permanentStorageDate ?? null,
          })
        : status;
    },
    downloadUpo: async ({
      environment,
      credentials,
      sessionReference,
      invoiceReference,
      ksefNumber,
    }) => {
      const suffix = invoiceReference !== null
        ? encodeURIComponent(invoiceReference)
        : `ksef/${encodeURIComponent(ksefNumber ?? '')}`;
      const downloaded = await protectedRequest(
        environment,
        credentials,
        `/sessions/${encodeURIComponent(sessionReference)}/invoices/${suffix}/upo`,
      );
      return downloaded.ok ? ok(await downloaded.value.text()) : downloaded;
    },
    verifyDuplicateOriginal: async ({
      environment,
      credentials,
      originalSessionReference,
      originalKsefNumber,
      expected,
    }) => {
      const listed = await listRaw(environment, credentials, originalSessionReference);
      if (!listed.ok) return listed;
      const original = listed.value.invoices.find((candidate) =>
        candidate.ksefNumber === originalKsefNumber);
      if (original === undefined) return ok(false);
      const expectedHashBase64 = Buffer.from(expected.invoiceHashHex, 'hex').toString('base64');
      return ok(
        originalKsefNumber.startsWith(`${expected.contextNip}-`)
        && original.invoiceNumber === expected.invoiceNumber
        && original.invoiceHash === expectedHashBase64,
      );
    },
    closeSession: async ({ environment, credentials, sessionReference }) => {
      const closed = await protectedRequest(
        environment,
        credentials,
        `/sessions/online/${encodeURIComponent(sessionReference)}/close`,
        { method: 'POST' },
      );
      if (!closed.ok) return closed;
      sessions.delete(sessionKey(environment, credentials));
      return ok(undefined);
    },
  };
};
