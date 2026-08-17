import { z } from 'zod';

import { err, integrationAuth, integrationUnavailable, ok } from '#core/domain/index.js';
import type { VideoLibraryPort } from '#core/server/index.js';

const BUNNY_STREAM_BASE_URL = 'https://video.bunnycdn.com';

const bunnyVideoListSchema = z.object({
  totalItems: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      guid: z.string().min(1),
      title: z.string().nullish(),
      length: z.number().nonnegative(),
      dateUploaded: z.string(),
    }),
  ),
});

export const createBunnyVideoLibrary = (fetchImpl: typeof fetch = fetch): VideoLibraryPort => ({
  listVideos: async (input) => {
    const url = new URL(`${BUNNY_STREAM_BASE_URL}/library/${encodeURIComponent(input.libraryId)}/videos`);
    url.searchParams.set('page', String(input.page));
    url.searchParams.set('itemsPerPage', String(input.perPage));
    url.searchParams.set('orderBy', 'date');
    if (input.search !== null && input.search.length > 0) url.searchParams.set('search', input.search);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { AccessKey: input.apiKey, accept: 'application/json' },
      });
    } catch (cause) {
      return err(
        integrationUnavailable(
          `Bunny Stream is unreachable: ${cause instanceof Error ? cause.message : String(cause)}. Check your network and try again.`,
        ),
      );
    }
    if (response.status === 401 || response.status === 403) {
      return err(integrationAuth('Bunny Stream rejected the API key. Save a valid Stream API key in Integrations → Video.'));
    }
    if (response.status === 404) {
      return err(
        integrationAuth(
          `Bunny Stream has no library "${input.libraryId}" for this API key. Check the library id in Integrations → Video.`,
        ),
      );
    }
    if (!response.ok) {
      return err(integrationUnavailable(`Bunny Stream responded with HTTP ${response.status}. Try again in a moment.`));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return err(integrationUnavailable('Bunny Stream returned a non-JSON response. Try again in a moment.'));
    }
    const parsed = bunnyVideoListSchema.safeParse(payload);
    if (!parsed.success) {
      return err(integrationUnavailable('Bunny Stream returned an unexpected response shape.'));
    }
    return ok({
      totalItems: parsed.data.totalItems,
      videos: parsed.data.items.map((item) => ({
        id: item.guid,
        title: item.title ?? '(untitled)',
        lengthSeconds: Math.round(item.length),
        uploadedAt: item.dateUploaded,
      })),
    });
  },
});
