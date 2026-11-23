import { describe, expect, it, vi } from 'vitest';

import { fetchProposedFile } from './proposal-files.js';

const URL_WITH_SIGNATURE = 'https://storage.example.test/acme/file?X-Amz-Signature=secret-signature';

const read = async (stream: ReadableStream<Uint8Array>): Promise<string> => new Response(stream).text();

describe('fetching a proposed file from its signed link', () => {
  it('sends no credential, refuses a redirect and answers the body as a stream', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('%PDF-1'));
    const fetched = await fetchProposedFile(URL_WITH_SIGNATURE, fetchImpl);
    if (!fetched.ok) throw new Error(fetched.error.message);
    expect(await read(fetched.value)).toBe('%PDF-1');
    expect(fetchImpl).toHaveBeenCalledWith(URL_WITH_SIGNATURE, { redirect: 'error', credentials: 'omit' });
  });

  it('answers not found for a file the storage no longer holds', async () => {
    expect(await fetchProposedFile(URL_WITH_SIGNATURE, async () => new Response(null, { status: 404 })))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('never repeats the signed address in a failure', async () => {
    const failures = [
      await fetchProposedFile(URL_WITH_SIGNATURE, async () => { throw new Error(`fetch failed for ${URL_WITH_SIGNATURE}`); }),
      await fetchProposedFile(URL_WITH_SIGNATURE, async () => new Response('denied', { status: 403 })),
      await fetchProposedFile(URL_WITH_SIGNATURE, async () => new Response(null, { status: 200 })),
    ];
    for (const result of failures) {
      expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
      expect(JSON.stringify(result)).not.toContain('secret-signature');
    }
  });
});
