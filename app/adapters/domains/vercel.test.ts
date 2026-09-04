import { describe, expect, it } from 'vitest';

import { createVercelDomainProvisioner } from './vercel.js';

interface Recorded {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

const stubFetch = (
  responses: Record<string, { status: number; payload?: unknown }>,
  recorded: Recorded[],
): typeof fetch =>
  async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    recorded.push({
      method,
      url: url.toString(),
      authorization: headers.get('authorization'),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const match = responses[`${method} ${url.pathname}`];
    if (match === undefined) throw new Error(`unstubbed ${method} ${url.pathname}`);
    return new Response(
      match.payload === undefined ? null : JSON.stringify(match.payload),
      { status: match.status, headers: { 'content-type': 'application/json' } },
    );
  };

const provisioner = (
  responses: Record<string, { status: number; payload?: unknown }>,
  recorded: Recorded[] = [],
  overrides: { teamId?: string; gitBranch?: string } = {},
) => ({
  recorded,
  subject: createVercelDomainProvisioner({
    token: 'vercel-token',
    projectId: 'prj_1',
    fetchImpl: stubFetch(responses, recorded),
    ...overrides,
  }),
});

const TXT = {
  type: 'TXT',
  domain: '_vercel.kurs.coderoad.example',
  value: 'vc-domain-verify=kurs.coderoad.example,abc',
};

describe('vercel domain provisioner', () => {
  it('adds the domain with the configured git branch and team scope', async () => {
    const { subject, recorded } = provisioner(
      { 'POST /v10/projects/prj_1/domains': { status: 200, payload: { verified: false, verification: [TXT] } } },
      [],
      { teamId: 'team_1', gitBranch: 'staging' },
    );

    const result = await subject.add('kurs.coderoad.example');

    expect(result).toEqual({
      ok: true,
      value: {
        verified: false,
        verification: [{
          type: 'TXT',
          name: '_vercel.kurs.coderoad.example',
          value: 'vc-domain-verify=kurs.coderoad.example,abc',
        }],
      },
    });
    expect(recorded).toEqual([{
      method: 'POST',
      url: 'https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1',
      authorization: 'Bearer vercel-token',
      body: { name: 'kurs.coderoad.example', gitBranch: 'staging' },
    }]);
  });

  it('lets the caller override the git branch of a single add', async () => {
    const { subject, recorded } = provisioner(
      { 'POST /v10/projects/prj_1/domains': { status: 200, payload: { verified: true, verification: [] } } },
      [],
      { gitBranch: 'staging' },
    );

    await subject.add('kurs.coderoad.example', { gitBranch: 'main' });

    expect(recorded[0]?.body).toEqual({ name: 'kurs.coderoad.example', gitBranch: 'main' });
  });

  it('reads verification records and the DNS configuration for the status', async () => {
    const { subject } = provisioner({
      'GET /v9/projects/prj_1/domains/kurs.coderoad.example': {
        status: 200,
        payload: { verified: false, verification: [TXT] },
      },
      'GET /v6/domains/kurs.coderoad.example/config': {
        status: 200,
        payload: { misconfigured: true },
      },
    });

    const result = await subject.status('kurs.coderoad.example');

    expect(result).toEqual({
      ok: true,
      value: {
        verified: false,
        misconfigured: true,
        verification: [{
          type: 'TXT',
          name: '_vercel.kurs.coderoad.example',
          value: 'vc-domain-verify=kurs.coderoad.example,abc',
        }],
      },
    });
  });

  it('triggers verification and re-reads the resulting state', async () => {
    const { subject, recorded } = provisioner({
      'POST /v9/projects/prj_1/domains/kurs.coderoad.example/verify': { status: 200, payload: { verified: true } },
      'GET /v9/projects/prj_1/domains/kurs.coderoad.example': {
        status: 200,
        payload: { verified: true, verification: [] },
      },
      'GET /v6/domains/kurs.coderoad.example/config': { status: 200, payload: { misconfigured: false } },
    });

    const result = await subject.verify('kurs.coderoad.example');

    expect(result).toEqual({ ok: true, value: { verified: true, misconfigured: false, verification: [] } });
    expect(recorded.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /v9/projects/prj_1/domains/kurs.coderoad.example/verify',
      'GET /v9/projects/prj_1/domains/kurs.coderoad.example',
      'GET /v6/domains/kurs.coderoad.example/config',
    ]);
  });

  it('treats a domain the project no longer holds as removed', async () => {
    const { subject } = provisioner({
      'DELETE /v9/projects/prj_1/domains/kurs.coderoad.example': { status: 404 },
    });

    expect(await subject.remove('kurs.coderoad.example')).toEqual({ ok: true, value: undefined });
  });

  it('reports a project the token cannot reach instead of a pending domain', async () => {
    const { subject } = provisioner({
      'POST /v10/projects/prj_1/domains': {
        status: 404,
        payload: { error: { code: 'not_found', message: 'Project not found' } },
      },
      'GET /v9/projects/prj_1/domains/kurs.coderoad.example': { status: 404 },
      'GET /v6/domains/kurs.coderoad.example/config': { status: 200, payload: { misconfigured: false } },
    });

    expect(await subject.add('kurs.coderoad.example')).toEqual({
      ok: false,
      error: { code: 'integration_unavailable', message: 'Vercel: Project not found' },
    });
    expect(await subject.status('kurs.coderoad.example')).toEqual({
      ok: false,
      error: { code: 'integration_unavailable', message: 'Vercel responded with HTTP 404.' },
    });
  });

  it('surfaces the provider message as an integration failure', async () => {
    const { subject } = provisioner({
      'POST /v10/projects/prj_1/domains': {
        status: 409,
        payload: { error: { code: 'domain_taken', message: 'Domain is already in use by another project' } },
      },
    });

    expect(await subject.add('kurs.coderoad.example')).toEqual({
      ok: false,
      error: {
        code: 'integration_unavailable',
        message: 'Vercel: Domain is already in use by another project',
      },
    });
  });

  it('hides project and team identifiers from the provider message', async () => {
    const { subject } = provisioner({
      'POST /v10/projects/prj_1/domains': {
        status: 403,
        payload: {
          error: {
            code: 'forbidden',
            message: 'Not authorized to access project prj_9aBcD under team_XyZ12',
          },
        },
      },
    });

    expect(await subject.add('kurs.coderoad.example')).toEqual({
      ok: false,
      error: {
        code: 'integration_unavailable',
        message: 'Vercel: Not authorized to access project … under …',
      },
    });
  });

  it('gives up on a call whose caller deadline has already passed', async () => {
    const subject = createVercelDomainProvisioner({
      token: 'vercel-token',
      projectId: 'prj_1',
      fetchImpl: async (_input, init) => {
        if (init?.signal?.aborted === true) throw new Error('The operation was aborted');
        return new Response('{}', { status: 200 });
      },
    });

    expect(await subject.status('kurs.coderoad.example', { signal: AbortSignal.abort() })).toEqual({
      ok: false,
      error: {
        code: 'integration_unavailable',
        message: 'Vercel is unreachable: The operation was aborted',
      },
    });
  });

  it('reports an unreachable API instead of throwing', async () => {
    const subject = createVercelDomainProvisioner({
      token: 'vercel-token',
      projectId: 'prj_1',
      fetchImpl: () => Promise.reject(new Error('ECONNRESET')),
    });

    expect(await subject.status('kurs.coderoad.example')).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable', message: 'Vercel is unreachable: ECONNRESET' },
    });
  });
});
