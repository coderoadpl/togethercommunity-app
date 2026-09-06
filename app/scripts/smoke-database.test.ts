import { beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateAndSeed, setupDatabase } from './smoke-database.js';
import { SmokeFailure } from './smoke-failure.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  run: vi.fn(),
}));
vi.mock('pg', () => ({
  default: {
    Client: class {
      connect = mocks.connect;
      query = mocks.query;
      end = mocks.end;
    },
  },
}));
vi.mock('./server-harness.js', () => ({ run: mocks.run, tsxBin: 'tsx' }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('smoke database diagnostics', () => {
  it('preserves the clean failure type and closes the connection on preparation failure', async () => {
    mocks.connect.mockRejectedValue(new Error('database unavailable'));
    const failure = setupDatabase('postgres://localhost/together');
    await expect(failure).rejects.toBeInstanceOf(SmokeFailure);
    await expect(failure).rejects.toThrow('Is the dev Postgres up (pnpm run db:up)?');
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it.each(['Migration', 'Seed'])('preserves the clean failure type for %s errors', async (stage) => {
    if (stage === 'Seed') mocks.run.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });
    mocks.run.mockResolvedValueOnce({ code: 1, stdout: 'output', stderr: 'diagnostic' });
    const failure = migrateAndSeed('postgres://localhost/together');
    await expect(failure).rejects.toBeInstanceOf(SmokeFailure);
    await expect(failure).rejects.toThrow(`${stage} failed:\noutputdiagnostic`);
    expect(mocks.run).toHaveBeenCalledTimes(stage === 'Seed' ? 2 : 1);
  });
});
