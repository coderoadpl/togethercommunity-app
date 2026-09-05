import { describe, expect, it } from 'vitest';

import { customDomainRecords, normalizeCustomDomain, tenantDomainStatus } from './custom-domain.js';

describe('normalizeCustomDomain', () => {
  it.each([
    ['  Kurs.CodeRoad.PL  ', 'kurs.coderoad.pl'],
    ['https://kurs.coderoad.pl/panel/settings', 'kurs.coderoad.pl'],
    ['http://kurs.coderoad.pl:8443', 'kurs.coderoad.pl'],
    ['kurs.coderoad.pl.', 'kurs.coderoad.pl'],
    ['xn--kurs-kva.coderoad.pl', 'xn--kurs-kva.coderoad.pl'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeCustomDomain(input, 'together.example'))
      .toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', 'an empty string'],
    ['   ', 'blank input'],
    ['localhost', 'a single label'],
    ['kurs coderoad pl', 'spaces'],
    ['-kurs.coderoad.pl', 'a leading hyphen'],
    ['kurs.coderoad.przykład', 'unicode instead of punycode'],
    ['together.example', 'the platform base domain'],
    ['acme.together.example', 'a subdomain of the platform'],
    [`${'a'.repeat(250)}.example.com`, 'more than 253 characters'],
    [`${'a'.repeat(64)}.example.com`, 'a label longer than 63 characters'],
    ['1.2.3.4', 'an IPv4 literal'],
    ['kurs.coderoad.123', 'an all-numeric top label'],
  ])('refuses %s (%s)', (input) => {
    expect(normalizeCustomDomain(input, 'together.example'))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('accepts any domain when the deployment has no base domain', () => {
    expect(normalizeCustomDomain('together.example', null))
      .toEqual({ ok: true, value: 'together.example' });
  });

  it.each([
    ['.'.repeat(10_000) + 'a', 'dots then a non-dot'],
    ['a' + '.'.repeat(10_000), 'a label then dots'],
    ['a'.repeat(10_000) + ':', 'a long label then a bare colon'],
    ['http://' + 'a.'.repeat(5000) + '-', 'a scheme then repeated labels'],
  ])('rejects a 10k-character input in under 10 ms (%#: %s)', (input) => {
    const startedAt = performance.now();
    const result = normalizeCustomDomain(input, 'together.example');
    expect(performance.now() - startedAt).toBeLessThan(10);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('customDomainRecords', () => {
  it('puts the routing CNAME before the ownership records the provider asked for', () => {
    expect(customDomainRecords({
      domain: 'kurs.coderoad.pl',
      target: 'cname.vercel-dns.com',
      verification: [{ type: 'TXT', name: '_vercel.kurs.coderoad.pl', value: 'vc-1' }],
    })).toEqual([
      { type: 'CNAME', name: 'kurs.coderoad.pl', value: 'cname.vercel-dns.com' },
      { type: 'TXT', name: '_vercel.kurs.coderoad.pl', value: 'vc-1' },
    ]);
  });
});

describe('tenantDomainStatus', () => {
  it.each([
    [{ verified: true, verification: [], lastError: 'stale' }, 'active'],
    [{ verified: false, verification: [], lastError: 'boom' }, 'error'],
    [
      {
        verified: false,
        verification: [{ type: 'TXT' as const, name: '_vercel.kurs.coderoad.pl', value: 'vc-1' }],
        lastError: null,
      },
      'provider-verification',
    ],
    [{ verified: false, verification: [], lastError: null }, 'pending-dns'],
  ])('derives %o as %s', (domain, expected) => {
    expect(tenantDomainStatus(domain)).toBe(expected);
  });
});
