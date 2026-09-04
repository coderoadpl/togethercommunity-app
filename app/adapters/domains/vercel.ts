import { z } from 'zod';

import {
  err,
  integrationUnavailable,
  ok,
  type AppError,
  type DnsRecord,
  type Result,
} from '#core/domain/index.js';
import type { DomainProvisionState, DomainProvisioner } from '#core/server/index.js';

const VERCEL_API_BASE_URL = 'https://api.vercel.com';
/** Caps a single hop; the caller's deadline is what bounds a whole multi-call operation. */
const VERCEL_REQUEST_TIMEOUT_MS = 5_000;

export interface VercelDomainProvisionerConfig {
  token: string;
  projectId: string;
  teamId?: string | undefined;
  gitBranch?: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const verificationRecordSchema = z.object({
  type: z.string(),
  domain: z.string(),
  value: z.string(),
});

const projectDomainSchema = z.object({
  verified: z.boolean().default(false),
  verification: z.array(verificationRecordSchema).default([]),
});

const domainConfigSchema = z.object({
  misconfigured: z.boolean().default(false),
});

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
  }),
});

const RECORD_TYPES: Readonly<Record<string, DnsRecord['type']>> = {
  TXT: 'TXT',
  CNAME: 'CNAME',
  A: 'A',
};

const toDnsRecords = (
  records: z.infer<typeof verificationRecordSchema>[],
): DnsRecord[] =>
  records.flatMap((record) => {
    const type = RECORD_TYPES[record.type.toUpperCase()];
    return type === undefined ? [] : [{ type, name: record.domain, value: record.value }];
  });

/** Provider messages quote project and team ids, which the owner must never see. */
const withoutProviderIds = (message: string): string =>
  message.replace(/\b(?:prj|team|acct|dpl)_[A-Za-z0-9]+/g, '…');

const describeFailure = async (response: Response): Promise<AppError> => {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = errorEnvelopeSchema.safeParse(payload);
  const message = parsed.success ? parsed.data.error.message ?? parsed.data.error.code : undefined;
  return integrationUnavailable(
    message === undefined
      ? `Vercel responded with HTTP ${String(response.status)}.`
      : `Vercel: ${withoutProviderIds(message)}`,
  );
};

const requestSignal = (deadline: AbortSignal | undefined): AbortSignal => {
  const hop = AbortSignal.timeout(VERCEL_REQUEST_TIMEOUT_MS);
  return deadline === undefined ? hop : AbortSignal.any([deadline, hop]);
};

export const createVercelDomainProvisioner = (
  config: VercelDomainProvisionerConfig,
): DomainProvisioner => {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? VERCEL_API_BASE_URL;
  const project = encodeURIComponent(config.projectId);

  const endpoint = (path: string): URL => {
    const url = new URL(path, baseUrl);
    if (config.teamId !== undefined) url.searchParams.set('teamId', config.teamId);
    return url;
  };

  const call = async (
    path: string,
    init: {
      method: string;
      body?: unknown;
      missingIsOk?: boolean;
      unmetChallengeIsOk?: boolean;
      deadline?: AbortSignal | undefined;
    },
  ): Promise<Result<unknown, AppError>> => {
    let response: Response;
    try {
      response = await fetchImpl(endpoint(path), {
        method: init.method,
        signal: requestSignal(init.deadline),
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: 'application/json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (cause) {
      return err(integrationUnavailable(withoutProviderIds(
        `Vercel is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
      )));
    }
    if (response.status === 404 && init.missingIsOk === true) return ok(null);
    if (response.status === 400 && init.unmetChallengeIsOk === true) return ok(null);
    if (!response.ok) return err(await describeFailure(response));
    const payload: unknown = await response.json().catch(() => null);
    return ok(payload);
  };

  const readProjectDomain = async (
    domain: string,
    deadline: AbortSignal | undefined,
  ): Promise<Result<{ verified: boolean; verification: DnsRecord[] }, AppError>> => {
    const payload = await call(`/v9/projects/${project}/domains/${encodeURIComponent(domain)}`, {
      method: 'GET',
      deadline,
    });
    if (!payload.ok) return payload;
    const parsed = projectDomainSchema.safeParse(payload.value);
    return parsed.success
      ? ok({
        verified: parsed.data.verified,
        verification: toDnsRecords(parsed.data.verification),
      })
      : ok({ verified: false, verification: [] });
  };

  const readMisconfigured = async (
    domain: string,
    deadline: AbortSignal | undefined,
  ): Promise<Result<boolean, AppError>> => {
    const payload = await call(`/v6/domains/${encodeURIComponent(domain)}/config`, {
      method: 'GET',
      deadline,
    });
    if (!payload.ok) return payload;
    const parsed = domainConfigSchema.safeParse(payload.value);
    return ok(parsed.success ? parsed.data.misconfigured : true);
  };

  const readState = async (
    domain: string,
    deadline: AbortSignal | undefined,
  ): Promise<Result<DomainProvisionState, AppError>> => {
    const projectDomain = await readProjectDomain(domain, deadline);
    if (!projectDomain.ok) return projectDomain;
    const misconfigured = await readMisconfigured(domain, deadline);
    if (!misconfigured.ok) return misconfigured;
    return ok({ ...projectDomain.value, misconfigured: misconfigured.value });
  };

  return {
    provider: 'vercel',
    add: async (domain, options) => {
      const gitBranch = options?.gitBranch ?? config.gitBranch;
      const created = await call(`/v10/projects/${project}/domains`, {
        method: 'POST',
        body: { name: domain, ...(gitBranch === undefined ? {} : { gitBranch }) },
        deadline: options?.signal,
      });
      if (!created.ok) return created;
      const parsed = projectDomainSchema.safeParse(created.value);
      if (parsed.success) {
        return ok({
          verified: parsed.data.verified,
          verification: toDnsRecords(parsed.data.verification),
        });
      }
      return readProjectDomain(domain, options?.signal);
    },
    status: async (domain, options) => readState(domain, options?.signal),
    verify: async (domain, options) => {
      // A missing, mismatched or foreign TXT challenge answers 400, which is where an
      // unverified domain sits until its owner publishes the record — not an outage,
      // so the state read below decides what the workspace is told.
      const verified = await call(
        `/v9/projects/${project}/domains/${encodeURIComponent(domain)}/verify`,
        { method: 'POST', unmetChallengeIsOk: true, deadline: options?.signal },
      );
      if (!verified.ok) return verified;
      return readState(domain, options?.signal);
    },
    remove: async (domain, options) => {
      const deleted = await call(
        `/v9/projects/${project}/domains/${encodeURIComponent(domain)}`,
        { method: 'DELETE', missingIsOk: true, deadline: options?.signal },
      );
      return deleted.ok ? ok(undefined) : deleted;
    },
  };
};
