import { pathToFileURL } from 'node:url';

import {
  envelopeSchema,
  healthOutputSchema,
  publicOfferOutputSchema,
} from '#core/contract/index.js';

export interface RemoteSmokeOptions {
  baseUrl: string;
  tenant: string;
  expectedSha?: string;
  publicPagePath: string;
}

const responseJson = async (response: Response, name: string): Promise<unknown> => {
  if (!response.ok) {
    throw new Error(`${name} returned HTTP ${String(response.status)}`);
  }
  return response.json();
};

const endpoint = (baseUrl: string, path: string): URL => new URL(path, new URL(baseUrl));

export const runRemoteSmoke = async (
  options: RemoteSmokeOptions,
  request: typeof fetch = fetch,
): Promise<void> => {
  const healthResponse = await request(endpoint(options.baseUrl, '/api/health'));
  const health = envelopeSchema(healthOutputSchema).parse(
    await responseJson(healthResponse, 'health'),
  );
  if (!health.ok) throw new Error(`health failed: ${health.error.code}`);
  if (health.data.database !== 'up') throw new Error('health reported database down');
  if (options.expectedSha !== undefined && health.data.sha !== options.expectedSha) {
    throw new Error(
      `expected SHA ${options.expectedSha}, received ${health.data.sha}`,
    );
  }

  const offerResponse = await request(endpoint(options.baseUrl, '/api/public/offer'), {
    headers: { 'x-tenant': options.tenant },
  });
  const offer = envelopeSchema(publicOfferOutputSchema).parse(
    await responseJson(offerResponse, 'public offer'),
  );
  if (!offer.ok) throw new Error(`public offer failed: ${offer.error.code}`);

  const pageResponse = await request(endpoint(options.baseUrl, options.publicPagePath));
  if (!pageResponse.ok) {
    throw new Error(`public page returned HTTP ${String(pageResponse.status)}`);
  }
  const contentType = pageResponse.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error(`public page returned unexpected content type "${contentType}"`);
  }
  await pageResponse.text();
};

const main = async (): Promise<void> => {
  const baseUrl = process.env['BASE_URL'];
  if (baseUrl === undefined) {
    process.stderr.write('smoke:remote: BASE_URL is required\n');
    process.exitCode = 2;
    return;
  }

  const startedAt = Date.now();
  try {
    await runRemoteSmoke({
      baseUrl,
      tenant: process.env['SMOKE_TENANT'] ?? 'acme',
      publicPagePath: process.env['PUBLIC_PAGE_PATH'] ?? '/',
      ...(process.env['EXPECTED_SHA'] === undefined
        ? {}
        : { expectedSha: process.env['EXPECTED_SHA'] }),
    });
    process.stdout.write(
      `smoke:remote: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)\n`,
    );
  } catch (error) {
    process.stderr.write(`smoke:remote: FAIL\n${String(error)}\n`);
    process.exitCode = 1;
  }
};

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
