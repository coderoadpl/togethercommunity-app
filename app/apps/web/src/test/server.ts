import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import pkg from '../../../../package.json' with { type: 'json' };

export const server = setupServer(
  http.get('*/api/health', () =>
    HttpResponse.json({
      ok: true,
      data: {
        status: 'ok',
        database: 'up',
        version: pkg.version,
        sha: 'unknown',
      },
    }),
  ),
);
