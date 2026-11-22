import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveProposedFile } from './proposal-file-download.js';

const URL_WITH_SIGNATURE = 'https://storage.example.test/acme/file?X-Amz-Signature=secret-signature';
const link = { url: URL_WITH_SIGNATURE, fileName: 'workbook.pdf', sizeBytes: 6 };

let directory: string;
let out: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'proposal-file-'));
  out = join(directory, 'review.pdf');
});

afterEach(async () => {
  await rm(directory, { recursive: true });
});

describe('saving a proposed file', () => {
  it('streams the body to a new file and checks its size', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode('%PDF'));
        controller.enqueue(new TextEncoder().encode('-1'));
        controller.close();
      },
    })));
    expect(await saveProposedFile(link, out, false, fetchImpl)).toEqual({ ok: true, value: { fileName: 'workbook.pdf', sizeBytes: 6, out } });
    expect(await readFile(out, 'utf8')).toBe('%PDF-1');
  });

  it('answers not found for a file the storage no longer holds and writes nothing', async () => {
    const result = await saveProposedFile(link, out, false, async () => new Response(null, { status: 404 }));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(readFile(out)).rejects.toThrow();
  });

  it('never repeats the signed address in a failure', async () => {
    const thrown = await saveProposedFile(link, out, false, async () => { throw new Error(`fetch failed for ${URL_WITH_SIGNATURE}`); });
    const refused = await saveProposedFile(link, out, false, async () => new Response('denied', { status: 403 }));
    for (const result of [thrown, refused]) {
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('secret-signature');
    }
  });

  it('removes the partial file when the body breaks off', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode('%PDF'));
        controller.error(new Error('connection reset'));
      },
    })));
    expect(await saveProposedFile(link, out, false, fetchImpl)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    await expect(readFile(out)).rejects.toThrow();
  });
});
