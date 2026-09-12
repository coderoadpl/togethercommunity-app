import { describe, expect, it } from 'vitest';

import { safeErrorMessage, safeLogMessage } from './log-safety.js';

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
