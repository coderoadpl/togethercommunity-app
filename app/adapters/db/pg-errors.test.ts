import { describe, expect, it } from 'vitest';

import { queryCanceled, uniqueViolation, uniqueViolationIn } from './pg-errors.js';

describe('queryCanceled', () => {
  it.each([
    { name: 'a driver error', cause: { code: '57014' } },
    { name: 'a wrapped driver error', cause: { cause: { code: '57014' } } },
  ])('recognizes $name', ({ cause }) => {
    expect(queryCanceled(cause)).toBe(true);
  });

  it.each([
    { name: 'another driver code', cause: { code: '23505' } },
    { name: 'a plain error', cause: new Error('canceling statement due to statement timeout') },
    { name: 'a nullish cause', cause: null },
  ])('rejects $name', ({ cause }) => {
    expect(queryCanceled(cause)).toBe(false);
  });
});

describe('uniqueViolation', () => {
  it.each([
    { name: 'any constraint', cause: { code: '23505', constraint: 'members_pkey' }, constraint: undefined, expected: true },
    { name: 'the named constraint', cause: { code: '23505', constraint: 'members_pkey' }, constraint: 'members_pkey', expected: true },
    { name: 'another constraint', cause: { code: '23505', constraint: 'members_pkey' }, constraint: 'members_email_key', expected: false },
    { name: 'another driver code', cause: { code: '57014' }, constraint: undefined, expected: false },
  ])('matches $name', ({ cause, constraint, expected }) => {
    expect(uniqueViolation(cause, constraint)).toBe(expected);
  });
});

describe('uniqueViolationIn', () => {
  it.each([
    { name: 'a listed constraint', cause: { cause: { code: '23505', constraint: 'members_email_key' } }, expected: true },
    { name: 'an unlisted constraint', cause: { code: '23505', constraint: 'members_pkey' }, expected: false },
    { name: 'a missing constraint', cause: { code: '23505' }, expected: false },
  ])('matches $name', ({ cause, expected }) => {
    expect(uniqueViolationIn(cause, ['members_email_key'])).toBe(expected);
  });
});
