import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createS3StorageProvider } from '../adapters/storage/s3.js';
import { err, notFound, ok, type StorageConfiguration } from '../core/domain/index.js';

const resolver = {
  resolve: async (_tenantId: string, key: string) =>
    key === 's3.configuration' ? err(notFound('not configured')) : ok('configured'),
};

const configuration: StorageConfiguration = {
  provider: 'minio',
  endpoint: 'http://127.0.0.1:19000',
  region: 'us-east-1',
  bucket: 'together-test',
  accessKeyId: 'minio-access',
  secretAccessKey: 'minio-secret',
};

describe('storage response lifecycle', () => {
  it.each(['delete', 'head', 'probe'] as const)(
    'returns from %s when the endpoint sends a large error body',
    async (operation) => {
      const errorBody = Buffer.alloc(1_500_000, 'x');
      const server = createServer((request, response) => {
        if (operation === 'probe' && request.method === 'PUT') {
          response.writeHead(200);
          response.end();
          return;
        }
        if (operation === 'probe' && request.method === 'GET') {
          response.writeHead(200);
          response.end('together storage probe together-probe/large-body.txt');
          return;
        }
        if (operation === 'probe' && request.method === 'DELETE') {
          response.writeHead(204);
          response.end();
          return;
        }
        response.writeHead(403, {
          'content-length': String(errorBody.byteLength),
          'content-type': 'application/xml',
        });
        response.end(errorBody);
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });

      try {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          throw new Error('Storage regression server did not bind to a TCP port.');
        }
        const endpoint = `http://127.0.0.1:${String(address.port)}`;
        const storage = createS3StorageProvider(resolver, {
          allowPrivateEndpoints: true,
          probeKey: () => 'large-body',
        });
        const input = {
          url: `${endpoint}/together-test/object.pdf`,
          accessKeyId: configuration.accessKeyId,
          secretAccessKey: configuration.secretAccessKey,
          region: configuration.region,
        };
        const result = operation === 'delete'
          ? await storage.delete(input)
          : operation === 'head'
            ? await storage.head(input)
            : await storage.probe({ ...configuration, endpoint });

        expect(result).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error === undefined ? resolve() : reject(error));
          server.closeAllConnections();
        });
      }
    },
    10_000,
  );
});
