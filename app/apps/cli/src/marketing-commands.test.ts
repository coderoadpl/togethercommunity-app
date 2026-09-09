import { writeFile, unlink } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '#core/client/index.js';

import { runMarketingCsvImport } from './marketing-commands.js';

afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });
describe('marketing CLI', () => {
  it('validates UTF-8 CSV and attestation before making network calls', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const api = createApiClient({ baseUrl: 'https://courses.example.org', fetchImpl });
    const file = `.contacts-cli-${crypto.randomUUID()}.csv`;
    const options = { delimiter: 'comma' as const, attest: false, dryRun: false, skipInvalid: false, wait: false };
    expect(await runMarketingCsvImport({ api, json: true }, file, options, 'contacts')).toMatchObject({ ok: false, error: { code: 'validation' } });
    await writeFile(file, new Uint8Array([0xff, 0xff]));
    try {
      expect(await runMarketingCsvImport({ api, json: true }, file, { ...options, dryRun: true }, 'contacts')).toMatchObject({ ok: false, error: { code: 'validation' } });
    } finally { await unlink(file); }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
