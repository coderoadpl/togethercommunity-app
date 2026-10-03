import dns, { type LookupAddress, type LookupAllOptions } from 'node:dns';
import { Collection, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { createMongoTelemetryFactory } from './store.js';

const open = (connectionString: string) => createMongoTelemetryFactory().open('tenant', connectionString);

describe('MongoDB telemetry connection strings', () => {
  it('rejects private and loopback hosts', () => {
    expect(() => open('mongodb://user:pass@10.0.0.5:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@127.0.0.1:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@[::1]:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@[0:0:0:0:0:0:0:1]:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@[0:0:0:0:0:ffff:7f00:1]:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@[0:0:0:0:0:ffff:10.0.0.1]:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@localhost:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@cluster.example.test:27017,192.168.1.9:27017/analytics')).toThrow('private MongoDB hosts');
  });
  it('does not connect or clean up a probe after the host guard rejects', async () => {
    const resolver: { lookup: (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]> } = dns.promises;
    const lookup = vi.spyOn(resolver, 'lookup').mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const connect = vi.spyOn(MongoClient.prototype, 'connect').mockRejectedValue(new Error('Unexpected connection'));
    const deleteOne = vi.spyOn(Collection.prototype, 'deleteOne').mockRejectedValue(new Error('Unexpected deletion'));
    try {
      const store = open('mongodb://user:pass@private.example.test/analytics');
      try {
        expect(await store.probe('tenant')).toMatchObject({ ok: false, error: { code: 'validation' } });
        expect(connect).not.toHaveBeenCalled();
        expect(deleteOne).not.toHaveBeenCalled();
      } finally {
        await store.close('tenant');
      }
    } finally {
      lookup.mockRestore();
      connect.mockRestore();
      deleteOne.mockRestore();
    }
  });

  it('rejects driver options the client does not override', async () => {
    expect(() => open('mongodb://user:pass@cluster.example.test/analytics?proxyHost=10.0.0.5&proxyPort=1080')).toThrow('unsupported connection options');
    expect(() => open('mongodb://user:pass@cluster.example.test/analytics?directConnection=true')).toThrow('unsupported connection options');
    expect(() => open('mongodb://user:pass@cluster.example.test/analytics?tls=false')).toThrow('unsupported connection options');
    const store = open('mongodb://user:pass@cluster.example.test/analytics?retryWrites=true&authSource=admin');
    await store.close('tenant');
  });
  it('requires a dedicated database and scoped credentials', () => {
    expect(() => open('mongodb://user:pass@cluster.example.test/admin')).toThrow('dedicated database');
    expect(() => open('mongodb://user:pass@cluster.example.test/')).toThrow('dedicated database');
    expect(() => open('mongodb://cluster.example.test/analytics')).toThrow('scoped credentials');
    expect(() => open('mongodb+srv://user:pass@cluster.example.test:27017/analytics')).toThrow('single seed host');
  });
});
