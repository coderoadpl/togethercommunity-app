import { describe, expect, it } from 'vitest';

import { createSignInClientInputSchema, isSignInClientPlatformHost, signInClientHostsSchema } from './sign-in-client.js';

const input = (redirectUris: string[]) => ({ name: 'Example application', redirectUris });
const root = 'https://client.example.org/';

const invalidUris = [
  ['relative', '/return'],
  ['scheme-relative', '//client.example.org/return'],
  ['HTTP', 'http://client.example.org/return'],
  ['uppercase scheme', 'HTTPS://client.example.org/return'],
  ['uppercase host', 'https://Client.example.org/return'],
  ['default port spelled out', 'https://client.example.org:443/return'],
  ['nondefault port', 'https://client.example.org:8443/return'],
  ['terminal dot', 'https://client.example.org./return'],
  ['Unicode host', 'https://bücher.example.org/return'],
  ['punycode host', 'https://xn--bcher-kva.example.org/return'],
  ['IPv4', 'https://192.0.2.1/return'],
  ['IPv4 alias', 'https://0xc0.0.2.1/return'],
  ['IPv6', 'https://[2001:db8::1]/return'],
  ['localhost', 'https://localhost/return'],
  ['localhost subdomain', 'https://client.localhost/return'],
  ['private-use DNS', 'https://client.internal/return'],
  ['single DNS label', 'https://client/return'],
  ['empty DNS label', 'https://client..example.org/return'],
  ['DNS label too long', `https://${'a'.repeat(64)}.example.org/return`],
  ['underscore in host', 'https://client_app.example.org/return'],
  ['leading label hyphen', 'https://-client.example.org/return'],
  ['no explicit path', 'https://client.example.org'],
  ['userinfo', 'https://user:password@client.example.org/return'],
  ['empty userinfo', 'https://@client.example.org/return'],
  ['fragment', `${root}return#section`],
  ['empty fragment', `${root}return#`],
  ['query', `${root}return?mode=test`],
  ['empty query', `${root}return?`],
  ['wildcard host', 'https://*.example.org/return'],
  ['wildcard path', `${root}return/*`],
  ['literal space', `${root}my return`],
  ['parser-stripped tab', `${root}re\tturn`],
  ['control character', `${root}return${String.fromCharCode(0)}`],
  ['backslash', `${root}return\\next`],
  ['dot segment', `${root}./return`],
  ['parent dot segment', `${root}other/../return`],
  ['encoded dot segment', `${root}other/%2E%2E/return`],
  ['encoded host label', 'https://%63lient.example.org/return'],
  ['literal non-ASCII path', `${root}café`],
  ['noncanonical escaped unreserved byte', `${root}%72eturn`],
  ['lowercase escaped byte', `${root}a%2fb`],
  ['incomplete escape', `${root}return%0`],
  ['nonhex escape', `${root}return%QQ`],
  ['escaped backslash', `${root}return%5Cnext`],
  ['escaped control', `${root}return%00`],
  ['over 2048 bytes', `${root}${'x'.repeat(2049 - root.length)}`],
];

describe('sign-in client return addresses', () => {
  it.each(invalidUris)('rejects %s', (_reason, uri) => {
    expect(createSignInClientInputSchema.safeParse(input([uri])).success).toBe(false);
  });

  it.each([
    [],
    [root, root],
    [root, 'https://other.example.org/'],
    Array.from({ length: 6 }, (_, index) => `${root}${String(index)}`),
  ].map((uris) => ({ uris })))('rejects invalid address sets: $uris', ({ uris }) => {
    expect(createSignInClientInputSchema.safeParse(input(uris)).success).toBe(false);
  });

  it('preserves exact path bytes, case, order and the 2048-byte boundary', () => {
    const uris = [root, `${root}Callback/a%2Fb`, `${root}caf%C3%A9`, `${root}a//b`, `${root}${'x'.repeat(2048 - root.length)}`];
    expect(createSignInClientInputSchema.parse(input(uris)).redirectUris).toEqual(uris);
  });

  it('compares the platform host by complete DNS suffix', () => {
    expect(isSignInClientPlatformHost('platform.example.org', 'platform.example.org')).toBe(true);
    expect(isSignInClientPlatformHost('nested.app.platform.example.org', 'PLATFORM.example.org.')).toBe(true);
    expect(isSignInClientPlatformHost('not-platform.example.org', 'platform.example.org')).toBe(false);
    expect(isSignInClientPlatformHost('platform.example.org.other.example.org', 'platform.example.org')).toBe(false);
  });

  it('refuses callers supplying identity, credentials or state', () => {
    for (const extra of [{ id: 'assigned' }, { tenantId: 'other' }, { secret: 'assigned' }, { state: 'active' }]) {
      expect(createSignInClientInputSchema.safeParse({ ...input([root]), ...extra }).success).toBe(false);
    }
  });
});

describe('sign-in client allow-list', () => {
  it('defaults empty and groups exact pairs without changing the inputs', () => {
    expect(signInClientHostsSchema.parse(undefined).size).toBe(0);
    expect(signInClientHostsSchema.parse('').size).toBe(0);
    expect(signInClientHostsSchema.parse('workspace-a=client.example.org,workspace-a=other.example.org,workspace-b=client.example.org'))
      .toEqual(new Map([
        ['workspace-a', new Set(['client.example.org', 'other.example.org'])],
        ['workspace-b', new Set(['client.example.org'])],
      ]));
  });

  it.each([
    ' ', 'workspace-a', '=client.example.org', 'workspace-a=', 'workspace-a=client.example.org=extra',
    'workspace-a=Client.example.org', 'workspace-a=https://client.example.org', 'workspace-a=client.example.org:443',
    'workspace-a=client.example.org.', 'workspace-a=client.example.org,',
    'workspace-a=client.example.org, workspace-b=other.example.org', 'workspace-a=client.example.org\n',
    'workspace-a=client.example.org,workspace-a=client.example.org',
  ])('rejects a malformed setting (%j)', (setting) => {
    const parsed = signInClientHostsSchema.safeParse(setting);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toEqual([
      { code: 'custom', path: [], message: 'Expected distinct workspace=hostname pairs' },
    ]);
  });
});
