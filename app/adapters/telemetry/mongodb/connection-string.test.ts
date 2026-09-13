import { describe, expect, it } from 'vitest';

import { createMongoTelemetryFactory } from './store.js';

const open = (connectionString: string) => createMongoTelemetryFactory().open('tenant', connectionString);

describe('MongoDB telemetry connection strings', () => {
  it('rejects private and loopback hosts', () => {
    expect(() => open('mongodb://user:pass@10.0.0.5:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@127.0.0.1:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@[::1]:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@localhost:27017/analytics')).toThrow('private MongoDB hosts');
    expect(() => open('mongodb://user:pass@cluster.example.test:27017,192.168.1.9:27017/analytics')).toThrow('private MongoDB hosts');
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
