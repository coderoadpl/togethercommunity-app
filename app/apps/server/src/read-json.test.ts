import { describe, expect, it, vi } from 'vitest';

import { readJson } from './read-json.js';

describe('readJson', () => {
  it.each([
    null,
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=test',
    'application/jsonp',
    'application/json-invalid',
  ])('rejects %s before parsing the body', async (contentType) => {
    const request = new Request('https://acme.example.test/api/tenant-secrets', {
      method: 'POST',
      body: new TextEncoder().encode('{}'),
      headers: contentType === null ? {} : { 'content-type': contentType },
    });
    const parse = vi.spyOn(request, 'json');

    await expect(readJson(request)).rejects.toThrow();
    expect(parse).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON; charset=UTF-8'])(
    'accepts %s', async (contentType) => {
      const request = new Request('https://acme.example.test/api/tenant-secrets', {
        method: 'POST', headers: { 'content-type': contentType }, body: '{"value":"secret"}',
      });

      await expect(readJson(request)).resolves.toEqual({ value: 'secret' });
    },
  );

  it('returns invalid JSON to schema validation', async () => {
    const request = new Request('https://acme.example.test/api/tenant-secrets', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });

    await expect(readJson(request)).resolves.toBeNull();
  });
});
