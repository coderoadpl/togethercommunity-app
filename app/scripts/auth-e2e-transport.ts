import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { AuthE2eTransport } from '#adapters/auth/e2e-http.js';

export const createAuthE2eTransport = (connectUrl: string, origin: string): AuthE2eTransport & { request: typeof fetch } => ({
  connectUrl,
  origin,
  request: async (input, init) => {
    const source = new Request(input, init);
    const url = new URL(source.url);
    const body = source.body === null ? undefined : await source.text();
    // Node fetch ignores Host overrides, but loopback connections must retain the browser's authority.
    const headers = { ...Object.fromEntries(source.headers), host: new URL(origin).host };
    return new Promise<Response>((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = send(url, { method: source.method, headers }, (response) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) for (const entry of value) responseHeaders.append(name, entry);
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { responseBody += chunk; });
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode ?? 500;
          resolve(new Response([204, 205, 304].includes(status) ? null : responseBody, { status, headers: responseHeaders }));
        });
      });
      request.on('error', reject);
      request.end(body);
    });
  },
});
