import type { IncomingMessage, ServerResponse } from 'node:http';

import { getRequestListener } from '@hono/node-server';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { loadEnv } from './env.js';
import { startServerObservability } from './observability.js';

process.env.APP_COMMIT_SHA ??= process.env.VERCEL_GIT_COMMIT_SHA;

const flush = startServerObservability();
const app = buildApp(createDeps(loadEnv()));
const handler = getRequestListener(app.fetch);

export default async function vercelHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    await handler(request, response);
  } finally {
    if (flush !== undefined) await flush();
  }
}
