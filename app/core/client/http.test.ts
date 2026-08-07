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
        data: { status: 'ok', version: '0.1.0', sha: 'cafe1234', database: 'up' },
      });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.health()).resolves.toEqual({
      ok: true,
      value: { status: 'ok', version: '0.1.0', sha: 'cafe1234', database: 'up' },
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
      expiresAt: '2026-08-07T18:00:00.000Z',
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

  it('returns the contract AppError from a non-2xx envelope', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ ok: false, error: { code: 'unauthorized', message: 'Login required' } }, 401);
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.me()).resolves.toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Login required' },
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
      return jsonResponse({ ok: true, data: { status: 'ok', version: '0.1.0', database: 'up' } });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl, traceparent: () => traceparent });

    await client.health();

    expect(seen?.get('traceparent')).toBe(traceparent);
  });

  it('omits the traceparent header cleanly when no trace is active', async () => {
    let seen: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = new Headers(init?.headers);
      return jsonResponse({ ok: true, data: { status: 'ok', version: '0.1.0', database: 'up' } });
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
