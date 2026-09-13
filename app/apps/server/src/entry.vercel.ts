import type { IncomingMessage, ServerResponse } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import { getDeadline, waitUntil } from '@vercel/functions';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { loadEnv } from './env.js';
import { startServerObservability } from './observability.js';

process.env.APP_COMMIT_SHA ??= process.env.VERCEL_GIT_COMMIT_SHA;

export const keepAlive = (task: Promise<unknown>): void => {
  if (process.env.VERCEL === undefined && process.env.VERCEL_URL === undefined) return;
  try {
    waitUntil(task);
  } catch {
    return;
  }
};

const flush = startServerObservability();
const deps = createDeps(loadEnv(), { keepAlive });
const app = buildApp(deps);
const handler = getRequestListener(app.fetch);

const AUTH_EMAIL_DRAIN_CEILING_MS = 25_000;
const OBSERVABILITY_FLUSH_BUDGET_MS = 2_000;

const authEmailDrainCeilingMs = (): number => {
  const deadline = getDeadline();
  if (deadline === undefined) return AUTH_EMAIL_DRAIN_CEILING_MS;
  const remaining = deadline.getTime() - Date.now() - OBSERVABILITY_FLUSH_BUDGET_MS;
  return Math.max(0, Math.min(AUTH_EMAIL_DRAIN_CEILING_MS, remaining));
};

const flushAuthEmails = async (): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deps.auth.flushAuthEmails(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, authEmailDrainCeilingMs());
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export default async function vercelHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    await handler(request, response);
  } finally {
    await flushAuthEmails();
    if (flush !== undefined) await flush();
  }
}
