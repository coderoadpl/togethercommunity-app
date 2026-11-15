import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { strictInput } from './strict-input.js';

const tolerant = z.object({
  name: z.string(),
  nested: z.object({ count: z.number() }),
  list: z.array(z.object({ label: z.string() })).optional(),
  maybe: z.object({ note: z.string() }).nullable().optional(),
  choice: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string() }),
    z.object({ kind: z.literal('empty') }),
  ]).optional(),
  either: z.union([z.object({ value: z.string() }), z.string()]).optional(),
  refined: z.object({ amount: z.number() }).refine((value) => value.amount > 0, 'Amount must be positive').optional(),
  withDefault: z.object({ mode: z.string() }).default({ mode: 'standard' }),
});

const strict = strictInput(tolerant);
const valid = { name: 'Acme', nested: { count: 1 } };

const unknownKeyPaths = (value: unknown): string[] => {
  const result = strict.safeParse(value);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.code === 'unrecognized_keys')
    .map((issue) => issue.path.join('.'));
};

describe('strictInput', () => {
  it('parses a valid value exactly like the original schema, defaults included', () => {
    const value = {
      ...valid,
      list: [{ label: 'a' }],
      maybe: null,
      choice: { kind: 'text', text: 'hello' },
      either: 'plain',
      refined: { amount: 2 },
    };
    expect(strict.parse(value)).toEqual(tolerant.parse(value));
    expect(strict.parse(valid)).toMatchObject({ withDefault: { mode: 'standard' } });
  });

  it.each([
    ['the top level', { ...valid, extra: true }, ''],
    ['a nested object', { ...valid, nested: { count: 1, extra: true } }, 'nested'],
    ['an array element', { ...valid, list: [{ label: 'a', extra: true }] }, 'list.0'],
    ['a nullable optional object', { ...valid, maybe: { note: 'n', extra: true } }, 'maybe'],
    ['a discriminated union option', { ...valid, choice: { kind: 'empty', extra: true } }, 'choice'],
    ['a refined object', { ...valid, refined: { amount: 2, extra: true } }, 'refined'],
    ['an object with a default', { ...valid, withDefault: { mode: 'x', extra: true } }, 'withDefault'],
  ])('rejects an unknown field in %s', (_label, value, path) => {
    expect(unknownKeyPaths(value)).toEqual([path]);
  });

  it('rejects an unknown field inside a union option', () => {
    const result = strict.safeParse({ ...valid, either: { value: 'v', extra: true } });
    expect(result.success).toBe(false);
    expect(tolerant.safeParse({ ...valid, either: { value: 'v', extra: true } }).success).toBe(true);
  });

  it('reports unknown fields together with the other validation failures', () => {
    const result = strict.safeParse({ ...valid, name: 1, extra: true });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.code).sort()).toEqual(['invalid_type', 'unrecognized_keys']);
  });

  it('leaves the original schema tolerant of unknown fields', () => {
    expect(tolerant.parse({ ...valid, extra: true, nested: { count: 1, extra: true } })).not.toHaveProperty('extra');
  });

  it('keeps a passthrough object tolerant', () => {
    const open = strictInput(z.object({ name: z.string() }).passthrough());
    expect(open.parse({ name: 'a', extra: true })).toEqual({ name: 'a', extra: true });
  });
});
