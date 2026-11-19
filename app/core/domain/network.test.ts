import { describe, expect, it } from 'vitest';

import { privateNetworkAddress, privateNetworkHostname, secureApiBaseUrl } from './network.js';

describe('private network addresses', () => {
  it.each([
    '::', '::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001',
    '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', '0:0:0:0:0:ffff:10.0.0.1',
    '0:0:0:0:0:ffff:a9fe:a9fe', '::10.0.0.1', 'fc00::1', 'FD12:3456::1',
    'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '64:ff9b::a00:1',
    '2002:a00:1::1', '1:2:3', 'gggg::1', '1::2::3', '10.0.0.5', '127.0.0.1',
    '169.254.169.254', '192.168.1.9', '100.64.0.1',
    '::ffff:8.8.8.8', '::8.8.8.8', 'febf::1', 'feff::1',
    '12345::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8', '1:::2',
    ':1:2:3:4:5:6:7', '1:2:3:4:5:6:7:', '::ffff:256.0.0.1',
    '::ffff:1.2.3', '::ffff:01.2.3.4', '1.2.3.4::',
  ])('rejects %s', (address) => {
    expect(privateNetworkAddress(address)).toBe(true);
  });

  it.each([
    '2606:4700:4700::1111', '2a00:1450:4001:81b::200e',
    '2001:4860:4860:0:0:0:0:8888', '64:ff9b::808:808', '8.8.8.8', '93.184.216.34',
    '64:ff9b::8.8.8.8', '2002:808:808::1', 'fe7f::1',
  ])('allows %s', (address) => {
    expect(privateNetworkAddress(address)).toBe(false);
  });

  it.each([
    ['localhost', true], ['a.localhost', true], ['cluster.example.test', false],
  ] as const)('classifies hostname %s', (hostname, expected) => {
    expect(privateNetworkHostname(hostname)).toBe(expected);
  });
});

describe('secure API base URLs', () => {
  it.each([
    ['https://platform.example.test', 'https://platform.example.test'],
    ['https://platform.example.test/', 'https://platform.example.test'],
    ['https://platform.example.test/together/', 'https://platform.example.test/together'],
    ['https://platform.example.test/edge/together', 'https://platform.example.test/edge/together'],
    ['http://localhost:48730/api', 'http://localhost:48730/api'],
    ['http://acme.localhost:48730', 'http://acme.localhost:48730'],
    ['http://127.0.0.1:48730', 'http://127.0.0.1:48730'],
    ['http://[::1]:48730', 'http://[::1]:48730'],
  ])('accepts %s as %s, keeping its path prefix', (raw, baseUrl) => {
    expect(secureApiBaseUrl(raw)).toBe(baseUrl);
  });

  it.each([
    'http://platform.example.test', 'http://10.0.0.5', 'ftp://platform.example.test', 'not a url', '',
    'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'http://localhost:48730@evil.example',
    'http://[::ffff:127.0.0.1]', 'https://platform.example.test/path?q=1', 'https://platform.example.test/#fragment',
    'https://user:password@platform.example.test',
  ])('refuses %j', (raw) => {
    expect(secureApiBaseUrl(raw)).toBeNull();
  });
});
