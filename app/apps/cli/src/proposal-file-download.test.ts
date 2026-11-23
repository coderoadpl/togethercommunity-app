import { mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveProposedFile, type ProposedFileSystem } from './proposal-file-download.js';

const URL_WITH_SIGNATURE = 'https://storage.example.test/acme/file?X-Amz-Signature=secret-signature';
const link = { url: URL_WITH_SIGNATURE, fileName: 'workbook.pdf', sizeBytes: 6 };

const body = (...parts: string[]): typeof fetch => vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
  start: (controller) => {
    for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  },
})));

const brokenBody = (part: string): typeof fetch => vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
  start: (controller) => {
    controller.enqueue(new TextEncoder().encode(part));
    controller.error(new Error('connection reset'));
  },
})));

const nodeFiles = (writesAtMost: (call: number) => number, written: { bytes: number } = { bytes: 0 }): ProposedFileSystem => ({
  exists: async (path) => readFile(path).then(() => true, () => false),
  openExclusive: async (path) => {
    const handle = await open(path, 'wx');
    let calls = 0;
    return {
      write: async (buffer, offset, length) => {
        calls += 1;
        const result = await handle.write(buffer, offset, Math.min(length, writesAtMost(calls)));
        written.bytes += result.bytesWritten;
        return result;
      },
      close: () => handle.close(),
    };
  },
  linkNew: async (from, to) => { await writeFile(to, await readFile(from), { flag: 'wx' }); },
  replace: async (from, to) => { await writeFile(to, await readFile(from)); },
  remove: (path) => rm(path, { force: true }),
});

const leftovers = async (): Promise<string[]> => (await readdir(directory)).filter((name) => name !== 'review.pdf');

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
    expect(await saveProposedFile(link, out, false, body('%PDF', '-1'))).toEqual({ ok: true, value: { fileName: 'workbook.pdf', sizeBytes: 6, out } });
    expect(await readFile(out, 'utf8')).toBe('%PDF-1');
    expect(await leftovers()).toEqual([]);
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

  it('writes nothing under the target name when the body breaks off', async () => {
    expect(await saveProposedFile(link, out, false, brokenBody('%PDF'))).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    await expect(readFile(out)).rejects.toThrow();
    expect(await leftovers()).toEqual([]);
  });

  it('keeps writing a chunk the file system took only in part, until every byte is on disk', async () => {
    expect(await saveProposedFile(link, out, false, body('%PDF-1'), nodeFiles(() => 2))).toMatchObject({ ok: true, value: { sizeBytes: 6 } });
    expect(await readFile(out, 'utf8')).toBe('%PDF-1');
    expect(await leftovers()).toEqual([]);
  });

  it('fails a write that makes no progress and keeps no short file', async () => {
    const result = await saveProposedFile(link, out, false, body('%PDF-1'), nodeFiles((call) => call === 1 ? 4 : 0));
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    await expect(readFile(out)).rejects.toThrow();
    expect(await leftovers()).toEqual([]);
  });

  it('with --force keeps the existing file untouched when the connection drops', async () => {
    await writeFile(out, 'reviewed earlier');
    expect(await saveProposedFile(link, out, true, brokenBody('%PDF'))).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await readFile(out, 'utf8')).toBe('reviewed earlier');
    expect(await leftovers()).toEqual([]);
  });

  it('keeps the existing file when the storage sent another size, and replaces it with --force only once the size matches', async () => {
    await writeFile(out, 'reviewed earlier');
    expect(await saveProposedFile(link, out, true, body('%PDF'))).toMatchObject({ ok: false, error: { code: 'unavailable', message: expect.stringContaining('4 bytes instead of 6') } });
    expect(await readFile(out, 'utf8')).toBe('reviewed earlier');
    expect(await saveProposedFile(link, out, true, body('%PDF-1'))).toMatchObject({ ok: true });
    expect(await readFile(out, 'utf8')).toBe('%PDF-1');
    expect(await leftovers()).toEqual([]);
  });

  it('keeps the partial and the saved file readable by the owner only, also when --force replaces an owner-only file', async () => {
    const modeOf = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;
    const partialModes: number[] = [];
    const parts = ['%PDF', '-1'];
    const watched: typeof fetch = async () => new Response(new ReadableStream({
      pull: async (controller) => {
        const part = parts.shift();
        if (part === undefined) {
          for (const name of (await readdir(directory)).filter((entry) => entry.includes('.partial-'))) partialModes.push(await modeOf(join(directory, name)));
          controller.close();
          return;
        }
        controller.enqueue(new TextEncoder().encode(part));
      },
    }));
    expect(await saveProposedFile(link, out, false, watched)).toMatchObject({ ok: true });
    expect(partialModes).toEqual([0o600]);
    expect(await modeOf(out)).toBe(0o600);

    const ownerOnly = join(directory, 'owner-only.pdf');
    await writeFile(ownerOnly, 'reviewed earlier', { mode: 0o600 });
    expect(await saveProposedFile(link, ownerOnly, true, body('%PDF-1'))).toMatchObject({ ok: true });
    expect(await readFile(ownerOnly, 'utf8')).toBe('%PDF-1');
    expect(await modeOf(ownerOnly)).toBe(0o600);
  });

  it.each([
    ['a chunk that crosses the size', '%PDF', 4],
    ['a first chunk larger than the size', '%PDF-1.7', 0],
  ])('stops reading and writes nothing more once the storage sends more bytes than announced, with %s', async (_label, chunk, bytesOnDisk) => {
    let pulls = 0;
    let cancelled = false;
    const endless: typeof fetch = async () => new Response(new ReadableStream({
      pull: (controller) => {
        pulls += 1;
        if (pulls > 1_000) throw new Error('The download kept reading past the announced size');
        controller.enqueue(new TextEncoder().encode(chunk));
      },
      cancel: () => { cancelled = true; },
    }));
    const written = { bytes: 0 };
    await writeFile(out, 'reviewed earlier');
    expect(await saveProposedFile(link, out, true, endless, nodeFiles(() => Number.POSITIVE_INFINITY, written))).toMatchObject({
      ok: false, error: { code: 'unavailable', message: `The storage sent more than 6 bytes; ${out} was not changed` },
    });
    expect(written.bytes).toBe(bytesOnDisk);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(5);
    expect(await readFile(out, 'utf8')).toBe('reviewed earlier');
    expect(await leftovers()).toEqual([]);
  });

  it('refuses an existing target without --force, also when it appears during the download', async () => {
    await writeFile(out, 'reviewed earlier');
    expect(await saveProposedFile(link, out, false, body('%PDF-1'))).toMatchObject({ ok: false, error: { code: 'conflict' } });
    await rm(out);
    const appearing = vi.fn<typeof fetch>(async () => {
      await writeFile(out, 'written meanwhile');
      return new Response('%PDF-1');
    });
    expect(await saveProposedFile(link, out, false, appearing)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await readFile(out, 'utf8')).toBe('written meanwhile');
    expect(await leftovers()).toEqual([]);
  });
});
