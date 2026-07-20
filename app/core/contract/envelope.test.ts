import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { err, ok } from '@core/domain/index.js';

import { envelopeSchema, looseEnvelopeSchema, toEnvelope } from './envelope.js';

describe('toEnvelope', () => {
  it('wraps an ok result as { ok: true, data }', () => {
    expect(toEnvelope(ok({ id: 'p1' }))).toEqual({ ok: true, data: { id: 'p1' } });
  });

  it('wraps an err result as { ok: false, error }', () => {
    const error = { code: 'not_found', message: 'nope' } as const;
    expect(toEnvelope(err(error))).toEqual({ ok: false, error });
  });
});

describe('envelopeSchema', () => {
  const schema = envelopeSchema(z.object({ count: z.number() }));

  it('accepts a well-formed success envelope', () => {
    expect(schema.parse({ ok: true, data: { count: 3 } })).toEqual({ ok: true, data: { count: 3 } });
  });

  it('accepts a well-formed error envelope', () => {
    const parsed = schema.parse({ ok: false, error: { code: 'validation', message: 'bad' } });
    expect(parsed).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects a success envelope whose data violates the route schema', () => {
    expect(schema.safeParse({ ok: true, data: { count: 'x' } }).success).toBe(false);
  });

  it('rejects an error envelope with an unknown error code', () => {
    expect(schema.safeParse({ ok: false, error: { code: 'nope', message: 'x' } }).success).toBe(false);
  });
});

describe('looseEnvelopeSchema', () => {
  it('leaves success data unparsed for a later route-schema step', () => {
    const parsed = looseEnvelopeSchema.parse({ ok: true, data: { anything: [1, 2, 3] } });
    expect(parsed).toEqual({ ok: true, data: { anything: [1, 2, 3] } });
  });

  it('still validates the error shape', () => {
    expect(looseEnvelopeSchema.safeParse({ ok: false, error: { message: 'no code' } }).success).toBe(false);
  });
});
