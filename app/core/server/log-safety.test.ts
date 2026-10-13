import { describe, expect, it } from 'vitest';

import { safeErrorMessage, safeLogMessage, serializeErrorChain } from './log-safety.js';

describe('safeErrorMessage', () => {
  it('keeps the Drizzle SQL text while removing query parameters', () => {
    const error = new Error(
      'Failed query: insert into "session" ("token") values ($1)\nparams: session-secret',
    );

    expect(safeErrorMessage(error)).toBe(
      'Failed query: insert into "session" ("token") values ($1)',
    );
  });

  it('keeps a plain error message', () => {
    expect(safeErrorMessage(new Error('Database unavailable'))).toBe('Database unavailable');
  });

  it.each(['secret string', undefined])('hides non-Error values', (value) => {
    expect(safeErrorMessage(value)).toBe('Unknown error');
  });

  it('removes parameters from an included nested cause message', () => {
    const cause = new Error(
      'Failed query: insert into "verification" ("value") values ($1)\nparams: verification-secret',
    );
    const error = new Error(`Could not create verification: ${cause.message}`, { cause });

    expect(safeErrorMessage(error)).toBe(
      'Could not create verification: Failed query: insert into "verification" ("value") values ($1)',
    );
  });
});

describe('safeLogMessage', () => {
  it('removes query parameters from an already formatted message', () => {
    expect(safeLogMessage(
      '[email-outbox] failed: Failed query: insert into "email_outbox" values ($1)\nparams: magic-link',
    )).toBe('[email-outbox] failed: Failed query: insert into "email_outbox" values ($1)');
  });

  it('keeps a message without query parameters', () => {
    expect(safeLogMessage('[email-outbox] failed: timeout')).toBe('[email-outbox] failed: timeout');
  });
});

describe('serializeErrorChain', () => {
  it('preserves nested Postgres diagnostics while removing query parameters', () => {
    const postgres = Object.assign(new Error('Connection terminated'), {
      code: '57P01', detail: 'Server shut down', routine: 'ProcessInterrupts',
    });
    const query = new Error('Failed query: select id from tenant_domains\nparams: private-value', { cause: postgres });
    const serialized = serializeErrorChain(new Error('Enrollment failed', { cause: query }));
    expect(JSON.parse(serialized)).toEqual([
      { name: 'Error', message: 'Enrollment failed' },
      { name: 'Error', message: 'Failed query: select id from tenant_domains' },
      { name: 'Error', message: 'Connection terminated', code: '57P01', routine: 'ProcessInterrupts' },
    ]);
    expect(serialized).not.toContain('private-value');
  });

  it.each([
    {
      message: 'duplicate key value violates unique constraint "members_tenant_email_key"',
      code: '23505',
      detail: 'Key (tenant_id, email)=(tenant-acme, buyer@example.com) already exists.',
      routine: '_bt_check_unique',
    },
    {
      message: 'new row for relation "email_outbox" violates check constraint "payload_check"',
      code: '23514',
      detail: 'Failing row contains (buyer@example.com, Billing address, https://acme.example.com/sign-in?token=private-token).',
      routine: 'ExecConstraints',
    },
  ])('omits row values from PostgreSQL $code details in nested causes', ({ message, code, detail, routine }) => {
    const postgres = Object.assign(new Error(message), { code, detail, routine });
    const serialized = serializeErrorChain(new Error('Enrollment failed', { cause: postgres }));

    expect(JSON.parse(serialized)).toEqual([
      { name: 'Error', message: 'Enrollment failed' },
      { name: 'Error', message, code, routine },
    ]);
    expect(serialized).not.toContain(detail);
    expect(serialized).not.toContain('buyer@example.com');
    expect(serialized).not.toContain('Billing address');
    expect(serialized).not.toContain('private-token');
  });

  it('terminates circular causes and handles unknown values', () => {
    const error = new Error('Cycle');
    error.cause = error;
    expect(JSON.parse(serializeErrorChain(error))).toEqual([
      { name: 'Error', message: 'Cycle' }, { message: 'Circular error cause' },
    ]);
    expect(serializeErrorChain('private-value')).toBe('[{"message":"Unknown error"}]');
  });
});
