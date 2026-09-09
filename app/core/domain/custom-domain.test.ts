import { describe, expect, it } from 'vitest';

import { customDomainRecords, normalizeCustomDomain, tenantDomainStatus } from './custom-domain.js';

describe('normalizeCustomDomain', () => {
  it.each([
    ['  Course.Acme.PL  ', 'course.acme.pl'],
    ['https://course.acme.pl/panel/settings', 'course.acme.pl'],
    ['http://course.acme.pl:8443', 'course.acme.pl'],
    ['course.acme.pl.', 'course.acme.pl'],
    ['xn--course-kva.acme.pl', 'xn--course-kva.acme.pl'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeCustomDomain(input, 'together.example'))
      .toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', 'an empty string'],
    ['   ', 'blank input'],
    ['localhost', 'a single label'],
    ['course acme pl', 'spaces'],
    ['-course.acme.pl', 'a leading hyphen'],
    ['course.acme.exämple', 'unicode instead of punycode'],
    ['together.example', 'the platform base domain'],
    ['acme.together.example', 'a subdomain of the platform'],
    [`${'a'.repeat(250)}.example.com`, 'more than 253 characters'],
    [`${'a'.repeat(64)}.example.com`, 'a label longer than 63 characters'],
    ['1.2.3.4', 'an IPv4 literal'],
    ['course.acme.123', 'an all-numeric top label'],
  ])('refuses %s (%s)', (input) => {
    expect(normalizeCustomDomain(input, 'together.example'))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('accepts an apex domain when the deployment has an apex routing record', () => {
    expect(normalizeCustomDomain('example.org', null, '192.0.2.1'))
      .toEqual({ ok: true, value: 'example.org' });
  });

  it('rejects an apex domain with subdomain guidance when no apex routing record is configured', () => {
    expect(normalizeCustomDomain('example.org', null))
      .toMatchObject({
        ok: false,
        error: {
          code: 'validation',
          message: 'Apex domains are not supported by this deployment. Use a subdomain such as courses.example.org.',
        },
      });
  });

  it('accepts the deployment domain when it is a subdomain and no base domain is configured', () => {
    expect(normalizeCustomDomain('start.together.example', null))
      .toEqual({ ok: true, value: 'start.together.example' });
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
      domain: 'course.acme.pl',
      target: 'cname.vercel-dns.com',
      verification: [{ type: 'TXT', name: '_vercel.course.acme.pl', value: 'vc-1' }],
    })).toEqual([
      { type: 'CNAME', name: 'course.acme.pl', value: 'cname.vercel-dns.com', purpose: 'routing' },
      { type: 'TXT', name: '_vercel.course.acme.pl', value: 'vc-1', purpose: 'ownership' },
    ]);
  });

  it('uses the configured provisioner A record for an apex domain', () => {
    expect(customDomainRecords({
      domain: 'example.org',
      target: 'cname.vercel-dns.com',
      apexARecord: '192.0.2.1',
      verification: [],
    })).toEqual([
      { type: 'A', name: 'example.org', value: '192.0.2.1', purpose: 'routing' },
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
        verification: [{ type: 'TXT' as const, name: '_vercel.course.acme.pl', value: 'vc-1' }],
        lastError: null,
      },
      'provider-verification',
    ],
    [{ verified: false, verification: [], lastError: null }, 'pending-dns'],
  ])('derives %o as %s', (domain, expected) => {
    expect(tenantDomainStatus(domain)).toBe(expected);
  });
});
