import { describe, expect, it } from 'vitest';

import { twoFactorChallengeUrl } from '../adapters/auth/two-factor-challenge.js';
import { safeReturnTo } from '../apps/web/src/lib/auth-return.js';

const challengeReturnTo = (value: string | null): string | null => {
  const continuation = new URLSearchParams();
  if (value !== null) continuation.set('returnTo', value);
  return new URL(twoFactorChallengeUrl('https://challenge.example', continuation)).searchParams.get('returnTo');
};

const corpus: (string | null)[] = [
  null,
  '',
  '/',
  '/my',
  '/my/courses/course-acme/lessons/lesson-acme-intro',
  '/account?tab=security',
  '/my/course?tab=1#notes',
  '/search?q=a%20b',
  'my/courses',
  '?returnTo=/my',
  '#/my',
  '//evil.example',
  '//evil.example/my',
  '///evil.example',
  '/\\evil.example',
  '\\\\evil.example',
  '/my\\path',
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r\n/evil.example',
  '\t//evil.example',
  '/ /evil.example',
  '/%2F/evil.example',
  '/%2f%2fevil.example',
  '%2F%2Fevil.example',
  '/%5Cevil.example',
  '/%09/evil.example',
  'https://evil.example/my',
  'http:evil.example',
  'https:/evil.example',
  'javascript:alert(1)',
  'data:text/html,x',
];

describe('safeReturnTo copies', () => {
  it.each(corpus.map((value) => [JSON.stringify(value), value] as const))(
    'the two-factor challenge keeps the same returnTo as the web login for %s',
    (_label, value) => {
      expect(challengeReturnTo(value)).toBe(safeReturnTo(value));
    },
  );

  it('accepts and rejects entries of the corpus', () => {
    const results = corpus.map((value) => safeReturnTo(value));
    expect(results).toContain('/my');
    expect(results).toContain(null);
  });
});
