import { err, integrationUnavailable, notFound, ok, storageDefiniteFailure, validation } from '#core/domain/index.js';

import type { StorageProvider } from '../ports.js';
import { createMemoryStorageList } from './storage-list.js';

const FAKE_STORAGE_ORIGIN = 'https://storage.example.test';

export const fakeStorageSecrets = {
  resolve: async () => ok(JSON.stringify({
    provider: 'aws_s3', endpoint: FAKE_STORAGE_ORIGIN, bucket: 'assets', region: 'auto', accessKeyId: 'a', secretAccessKey: 's',
  })),
};

interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
  contentDisposition?: string;
}

export interface FakeObjectStorage {
  storage: StorageProvider;
  objects: Map<string, StoredObject>;
  calls: Array<{ method: 'head' | 'getObject' | 'putObject' | 'delete' | 'presignPut' | 'presignGet' | 'copyObject' | 'digestObject'; key: string }>;
  signedLengths: Map<string, number>;
  failPuts: (key: string) => boolean;
  failReads: (key: string) => boolean;
  failDeletes: (key: string) => boolean;
  failCopies: (key: string) => boolean;
  /** Runs before a copy writes its destination, so a test can interleave work with a copy in flight. */
  beforeCopy: (key: string) => Promise<void>;
  keysUnder(prefix: string): string[];
}

const placeholderDigest = (bytes: Uint8Array): string => {
  let state = 0x811c9dc5;
  for (const byte of bytes) state = Math.imul(state ^ byte, 0x01000193) >>> 0;
  return state.toString(16).padStart(8, '0').repeat(8);
};

const keyOf = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1));

export const createObjectStorageFake = (options: { sha256?: (bytes: Uint8Array) => string } = {}): FakeObjectStorage => {
  const digest = options.sha256 ?? placeholderDigest;
  const objects = new Map<string, StoredObject>();
  const calls: FakeObjectStorage['calls'] = [];
  const missing = (key: string) => err(notFound(`No stored object at ${key}`));
  const unreachable = (key: string) => err(integrationUnavailable(`Storage did not answer for ${key}`));
  const refuse = () => Promise.reject(new Error('Not part of the object storage fake'));
  const fake: FakeObjectStorage = {
    objects,
    calls,
    signedLengths: new Map(),
    failPuts: () => false,
    failReads: () => false,
    failDeletes: () => false,
    failCopies: () => false,
    beforeCopy: async () => undefined,
    keysUnder: (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(),
    storage: {
      objectUrl: (_configuration, key) => new URL(`${FAKE_STORAGE_ORIGIN}/${key}`),
      head: async (input) => {
        const key = keyOf(input.url);
        calls.push({ method: 'head', key });
        if (fake.failReads(key)) return unreachable(key);
        const found = objects.get(key);
        return found === undefined ? missing(key) : ok({ sizeBytes: found.bytes.byteLength, etag: `"${placeholderDigest(found.bytes).slice(0, 32)}"` });
      },
      getObject: async (input, options) => {
        const key = keyOf(input.url);
        calls.push({ method: 'getObject', key });
        if (fake.failReads(key)) return unreachable(key);
        const found = objects.get(key);
        if (found === undefined) return missing(key);
        if (found.bytes.byteLength > options.maxBytes) return err(validation('Object exceeds the byte ceiling'));
        return ok(found.bytes.slice());
      },
      putObject: async (input) => {
        const key = keyOf(input.url);
        calls.push({ method: 'putObject', key });
        if (fake.failPuts(key)) return err(integrationUnavailable(`Storage refused the write of ${key}`));
        objects.set(key, {
          bytes: input.body.slice(),
          contentType: input.contentType,
          ...(input.contentDisposition === undefined ? {} : { contentDisposition: input.contentDisposition }),
        });
        return ok(undefined);
      },
      delete: async (input) => {
        const key = keyOf(input.url);
        calls.push({ method: 'delete', key });
        if (fake.failDeletes(key)) return unreachable(key);
        objects.delete(key);
        return ok({ deleted: true });
      },
      copyObject: async ({ sourceKey, key }) => {
        calls.push({ method: 'copyObject', key });
        if (fake.failCopies(key)) return unreachable(key);
        const found = objects.get(sourceKey);
        if (found === undefined) return missing(sourceKey);
        await fake.beforeCopy(key);
        objects.set(key, { bytes: found.bytes.slice(), contentType: 'application/octet-stream' });
        return ok(undefined);
      },
      digestObject: async (input, { maxBytes, headBytes }) => {
        const key = keyOf(input.url);
        calls.push({ method: 'digestObject', key });
        if (fake.failReads(key)) return unreachable(key);
        const found = objects.get(key);
        if (found === undefined) return missing(key);
        if (found.bytes.byteLength > maxBytes) return err(storageDefiniteFailure('Object is empty or exceeds the byte ceiling'));
        return ok({ sha256: digest(found.bytes), sizeBytes: found.bytes.byteLength, head: found.bytes.slice(0, headBytes) });
      },
      presignPut: (input) => {
        calls.push({ method: 'presignPut', key: keyOf(input.url) });
        if (input.contentLength !== undefined) fake.signedLengths.set(keyOf(input.url), input.contentLength);
        return ok(`${input.url}?signed=put`);
      },
      presignGet: (input) => {
        calls.push({ method: 'presignGet', key: keyOf(input.url) });
        return ok(`${input.url}${input.url.includes('?') ? '&' : '?'}signed=get`);
      },
      list: (input) => createMemoryStorageList([...objects.entries()].map(([key, object]) => ({
        key, sizeBytes: object.bytes.byteLength, lastModified: '2026-01-01T00:00:00.000Z',
      })))(input),
      probe: refuse,
      probeCors: refuse,
      healthcheck: refuse,
      test: refuse,
    },
  };
  return fake;
};
