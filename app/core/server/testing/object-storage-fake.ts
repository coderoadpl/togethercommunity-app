import { err, integrationUnavailable, notFound, ok, validation } from '#core/domain/index.js';

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
}

export interface FakeObjectStorage {
  storage: StorageProvider;
  objects: Map<string, StoredObject>;
  calls: Array<{ method: 'head' | 'getObject' | 'putObject' | 'delete' | 'presignPut' | 'presignGet'; key: string }>;
  signedLengths: Map<string, number>;
  failPuts: (key: string) => boolean;
  failReads: (key: string) => boolean;
  failDeletes: (key: string) => boolean;
  keysUnder(prefix: string): string[];
}

const keyOf = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1));

export const createObjectStorageFake = (): FakeObjectStorage => {
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
    keysUnder: (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(),
    storage: {
      objectUrl: (_configuration, key) => new URL(`${FAKE_STORAGE_ORIGIN}/${key}`),
      head: async (input) => {
        const key = keyOf(input.url);
        calls.push({ method: 'head', key });
        if (fake.failReads(key)) return unreachable(key);
        const found = objects.get(key);
        return found === undefined ? missing(key) : ok({ sizeBytes: found.bytes.byteLength });
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
        objects.set(key, { bytes: input.body.slice(), contentType: input.contentType });
        return ok(undefined);
      },
      delete: async (input) => {
        const key = keyOf(input.url);
        calls.push({ method: 'delete', key });
        if (fake.failDeletes(key)) return unreachable(key);
        objects.delete(key);
        return ok({ deleted: true });
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
