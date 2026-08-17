import { describe, expect, it } from 'vitest';

import {
  lessonPlaybackVideoSchema,
  type LessonPlaybackVideo,
  type StudentLessonPlaybackOutput,
} from '#core/contract/index.js';
import { ok, type AppError, type Result } from '#core/domain/index.js';

import { ApiError, createApiClient, unwrap } from './http.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createApiClient', () => {
  it('parses a successful envelope through the route output schema', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('https://api.example.test/api/health');
      expect(init).toMatchObject({ method: 'GET', credentials: 'include' });

      return jsonResponse({
        ok: true,
        data: {
          status: 'ok',
          version: '0.1.0',
          sha: 'cafe1234',
          database: 'up',
          environment: 'production',
          production: true,
          commit: 'cafe1234',
          databaseFingerprint: 'b1bfbb98b4f7',
          expectedMigrations: 82,
          appliedMigrations: 82,
          schemaCurrent: true,
        },
      });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.health()).resolves.toEqual({
      ok: true,
      value: {
        status: 'ok',
        version: '0.1.0',
        sha: 'cafe1234',
        database: 'up',
        environment: 'production',
        production: true,
        commit: 'cafe1234',
        databaseFingerprint: 'b1bfbb98b4f7',
        expectedMigrations: 82,
        appliedMigrations: 82,
        schemaCurrent: true,
      },
    });
  });

  it('requests and parses signed student lesson playback', async () => {
    const video: LessonPlaybackVideo = {
      kind: 'bunny',
      storageKey: 'videos/one',
      videoId: 'video-1',
      libraryId: 'library-1',
      embedUrl: 'https://iframe.mediadelivery.net/embed/library-1/video-1',
      hlsUrl: 'https://vz-demo.b-cdn.net/video-1/playlist.m3u8',
      signed: true,
    };
    const output: StudentLessonPlaybackOutput = {
      lessonId: 'lesson/one',
      expiresAt: '1998-08-07T18:00:00.000Z',
      videos: [lessonPlaybackVideoSchema.parse(video)],
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('https://api.example.test/api/student/lessons/lesson%2Fone/playback');
      expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
      return jsonResponse({ ok: true, data: output });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.studentLessonPlayback('lesson/one')).resolves.toEqual(ok(output));
  });

  it('sends the shared secret header and parses the dispatch envelope', async () => {
    let seen: Headers | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('https://api.example.test/api/internal/dispatch-email');
      expect(init).toMatchObject({ method: 'POST' });
      seen = new Headers(init?.headers);
      return jsonResponse({ ok: true, data: { attemptsMade: 3, sentCount: 2, failedCount: 1 } });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.dispatchEmail('shhh')).resolves.toEqual({
      ok: true,
      value: { attemptsMade: 3, sentCount: 2, failedCount: 1 },
    });
    expect(seen?.get('x-email-dispatch-secret')).toBe('shhh');
  });

  it('sends the scheduler operator secret on bodyless GET requests', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeNull();
      expect(new Headers(init?.headers).get('x-scheduler-operator-secret')).toBe('operator-secret');
      return jsonResponse({ ok: true, data: { runs: [], nextCursor: null } });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.listGlobalSchedulerRuns({}, 'operator-secret')).resolves.toEqual({
      ok: true,
      value: { runs: [], nextCursor: null },
    });
  });

  it('preserves source-app and transport filters in send-log exports', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe(
        'https://api.example.test/api/marketing/sends/export?format=csv&kind=transactional&transport=smtp&sourceApp=orders-app',
      );
      expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
      return jsonResponse({
        ok: true,
        data: {
          filename: 'email-sends-alpha.csv',
          mimeType: 'text/csv; charset=utf-8',
          content: 'source_app\norders-app',
        },
      });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.exportEmailSends({
      format: 'csv',
      kind: 'transactional',
      transport: 'smtp',
      sourceApp: 'orders-app',
    })).resolves.toMatchObject({ ok: true, value: { filename: 'email-sends-alpha.csv' } });
  });

  it('serializes both lesson and space filters on post search', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(input).toBe(
        'https://api.example.test/api/posts/search?query=silnik&limit=5&lessonId=l1&spaceId=s1&spaceId=s2',
      );
      return jsonResponse({ ok: true, data: { hits: [] } });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.searchPosts({
      query: 'silnik',
      limit: 5,
      lessonIds: ['l1'],
      spaceIds: ['s1', 's2'],
    })).resolves.toEqual({ ok: true, value: { hits: [] } });
  });

  it('returns the contract AppError from a non-2xx envelope', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ ok: false, error: { code: 'unauthorized', message: 'Login required' } }, 401);
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.me()).resolves.toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Login required' },
    });
  });

  it('uploads an image asset through begin, storage PUT, and complete', async () => {
    const requests: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET', body: init?.body });
      if (url.endsWith('/api/image-assets/branding/upload')) {
        return jsonResponse({
          ok: true,
          data: {
            key: 'image-assets/tenant-1/logo/00000000-0000-4000-8000-000000000001.png',
            servePath: '/api/public/assets/logo/00000000-0000-4000-8000-000000000001.png',
            upload: {
              url: 'https://storage.example.test/signed-put',
              headers: { 'content-type': 'image/png' },
              expiresAt: '2026-08-16T12:15:00.000Z',
            },
          },
        });
      }
      if (url === 'https://storage.example.test/signed-put') {
        expect(new Headers(init?.headers).get('content-type')).toBe('image/png');
        return new Response(null, { status: 200 });
      }
      return jsonResponse({
        ok: true,
        data: { url: '/api/public/assets/logo/00000000-0000-4000-8000-000000000001.png' },
      });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    const result = await client.uploadBrandingAsset({
      kind: 'logo',
      fileName: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 5,
      body: new Blob(['image'], { type: 'image/png' }),
    });

    expect(result).toEqual(ok({
      url: '/api/public/assets/logo/00000000-0000-4000-8000-000000000001.png',
    }));
    expect(requests.map(({ url, method }) => ({ url, method }))).toEqual([
      { url: 'https://api.example.test/api/image-assets/branding/upload', method: 'POST' },
      { url: 'https://storage.example.test/signed-put', method: 'PUT' },
      { url: 'https://api.example.test/api/image-assets/branding/complete', method: 'POST' },
    ]);
    expect(JSON.parse(String(requests[2]?.body))).toEqual({
      key: 'image-assets/tenant-1/logo/00000000-0000-4000-8000-000000000001.png',
    });
  });

  it('turns malformed envelopes into failures', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ data: { status: 'ok' } });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.health()).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('turns invalid response data into failures', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ ok: true, data: { status: 'ok', version: '0.1.0', database: 'unknown' } });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.health()).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('injects the W3C traceparent header when a trace is active', async () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    let seen: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = new Headers(init?.headers);
      return jsonResponse({
        ok: true,
        data: {
          status: 'ok',
          version: '0.1.0',
          sha: 'test-sha',
          database: 'up',
          environment: 'test',
          production: false,
          commit: null,
          databaseFingerprint: null,
          expectedMigrations: 82,
          appliedMigrations: 82,
          schemaCurrent: true,
        },
      });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl, traceparent: () => traceparent });

    await client.health();

    expect(seen?.get('traceparent')).toBe(traceparent);
  });

  it('omits the traceparent header cleanly when no trace is active', async () => {
    let seen: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = new Headers(init?.headers);
      return jsonResponse({
        ok: true,
        data: {
          status: 'ok',
          version: '0.1.0',
          sha: 'test-sha',
          database: 'up',
          environment: 'test',
          production: false,
          commit: null,
          databaseFingerprint: null,
          expectedMigrations: 82,
          appliedMigrations: 82,
          schemaCurrent: true,
        },
      });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl, traceparent: () => undefined });

    await client.health();

    expect(seen?.has('traceparent')).toBe(false);
  });
});

describe('unwrap', () => {
  it('throws ApiError carrying the AppError', () => {
    const appError: AppError = { code: 'conflict', message: 'Already exists' };
    const result: Result<string, AppError> = { ok: false, error: appError };

    expect(() => unwrap(result)).toThrow(ApiError);

    try {
      unwrap(result);
      throw new Error('Expected unwrap to throw');
    } catch (error) {
      if (error instanceof ApiError) {
        expect(error.appError).toBe(appError);
        return;
      }

      throw error;
    }
  });
});
