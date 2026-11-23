import { z } from 'zod';

import { normalizePickupPointCode, pickupPointCodeValid, storableText, type PickupPointLookup } from '#core/domain/index.js';
import type { PickupPointDirectory } from '#core/server/index.js';

const INPOST_POINTS_URL = 'https://api-shipx-pl.easypack24.net/v1/points/';

const INPOST_POINTS_TIMEOUT_MS = 3000;

const BODY_MAX_BYTES = 64 * 1024;

const wirePointSchema = z.object({
  name: z.string().refine(pickupPointCodeValid),
  status: z.string().min(1),
  type: z.array(z.string()),
  functions: z.array(z.string()),
  location_description: z.string().nullish(),
  address: z.object({ line1: z.string().nullish(), line2: z.string().nullish() }).nullish(),
});

const wireNotFoundSchema = z.object({ status: z.literal(404), key: z.literal('point_not_found') });

export interface InpostPointsDirectoryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const UNAVAILABLE: PickupPointLookup = { kind: 'unavailable' };
const NOT_FOUND: PickupPointLookup = { kind: 'not_found' };

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const readBoundedText = async (response: Response): Promise<string | null> => {
  if (Number(response.headers.get('content-length')) > BODY_MAX_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > BODY_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
};

const storableJson = (value: unknown): boolean => {
  if (typeof value === 'string') return storableText(value);
  if (Array.isArray(value)) return value.every(storableJson);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(([key, entry]) => storableText(key) && storableJson(entry));
  }
  return true;
};

const readPoint = (code: string, body: unknown): PickupPointLookup => {
  if (!storableJson(body)) return UNAVAILABLE;
  const point = wirePointSchema.safeParse(body);
  if (!point.success || normalizePickupPointCode(point.data.name) !== code) return UNAVAILABLE;
  return {
    kind: 'found',
    point: {
      name: point.data.name,
      status: point.data.status,
      types: point.data.type,
      functions: point.data.functions,
      locationDescription: point.data.location_description ?? null,
      address: point.data.address == null ? null : { line1: point.data.address.line1 ?? null, line2: point.data.address.line2 ?? null },
    },
  };
};

export const createInpostPointsDirectory = (options: InpostPointsDirectoryOptions = {}): PickupPointDirectory => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? INPOST_POINTS_TIMEOUT_MS;
  return {
    lookup: async (requested) => {
      const code = normalizePickupPointCode(requested);
      if (!pickupPointCodeValid(code)) return NOT_FOUND;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${INPOST_POINTS_URL}${encodeURIComponent(code)}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.status !== 200 && response.status !== 404) {
          await response.body?.cancel();
          return UNAVAILABLE;
        }
        const text = await readBoundedText(response);
        if (text === null) return UNAVAILABLE;
        const body = parseJson(text);
        if (wireNotFoundSchema.safeParse(body).success) return NOT_FOUND;
        return response.status === 200 ? readPoint(code, body) : UNAVAILABLE;
      } catch {
        return UNAVAILABLE;
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
