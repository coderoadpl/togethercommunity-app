import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { loadEnv } from './env.js';
import { startServerObservability } from './observability.js';

startServerObservability();

const env = loadEnv();
const app = buildApp(createDeps(env));

// Same process serves the SPA build — one origin per tenant domain, no CORS.
app.use('*', serveStatic({ root: env.WEB_DIST_DIR }));
app.get('*', serveStatic({ path: `${env.WEB_DIST_DIR}/index.html` }));

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`together listening on http://localhost:${info.port}`);
});
