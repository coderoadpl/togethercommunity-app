import { describe, expect, it } from 'vitest';

import { createBunnyVideoLibrary } from './bunny.js';

const listInput = {
  apiKey: 'key-1234',
  libraryId: 'lib-42',
  search: 'intro',
  page: 2,
  perPage: 24,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createBunnyVideoLibrary', () => {
  it('calls the Bunny videos endpoint with the AccessKey header and maps the items', async () => {
    const requests: Array<{ url: string; accessKey: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), accessKey: headers.get('AccessKey') });
      return jsonResponse({
        totalItems: 51,
        items: [
          { guid: 'v-1', title: 'Intro', length: 61.4, dateUploaded: '2026-07-01T10:00:00Z' },
          { guid: 'v-2', title: null, length: 0, dateUploaded: '2026-07-02T10:00:00Z' },
        ],
      });
    };

    const result = await createBunnyVideoLibrary(fetchImpl).listVideos(listInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalItems).toBe(51);
    expect(result.value.videos).toEqual([
      { id: 'v-1', title: 'Intro', lengthSeconds: 61, uploadedAt: '2026-07-01T10:00:00Z' },
      { id: 'v-2', title: '(untitled)', lengthSeconds: 0, uploadedAt: '2026-07-02T10:00:00Z' },
    ]);
    const request = requests[0];
    expect(request?.accessKey).toBe('key-1234');
    const url = new URL(request?.url ?? '');
    expect(url.origin).toBe('https://video.bunnycdn.com');
    expect(url.pathname).toBe('/library/lib-42/videos');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('itemsPerPage')).toBe('24');
    expect(url.searchParams.get('search')).toBe('intro');
  });

  it('maps a 401 to integration_auth', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ message: 'nope' }, 401);
    const result = await createBunnyVideoLibrary(fetchImpl).listVideos(listInput);
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_auth' } });
  });

  it('maps a network failure to integration_unavailable', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND video.bunnycdn.com');
    };
    const result = await createBunnyVideoLibrary(fetchImpl).listVideos(listInput);
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  });

  it('maps a 5xx to integration_unavailable', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ message: 'boom' }, 503);
    const result = await createBunnyVideoLibrary(fetchImpl).listVideos(listInput);
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  });
});
