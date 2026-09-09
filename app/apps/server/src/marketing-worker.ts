import { createDeps } from './composition.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const deps = createDeps(env);
let stopped = false;
process.once('SIGTERM', () => { stopped = true; });
process.once('SIGINT', () => { stopped = true; });
while (!stopped) {
  const startedAt = Date.now();
  const result = await deps.marketing?.dispatchScheduledMarketing('manual');
  if (result !== undefined && !result.ok) process.stderr.write(`${result.error.message}\n`);
  if (stopped) break;
  const delay = Math.max(0, env.MARKETING_WORKER_INTERVAL_MS - (Date.now() - startedAt));
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
process.exit(0);
