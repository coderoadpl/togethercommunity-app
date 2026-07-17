import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureWebBundleFresh } from './web-bundle-freshness.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

await ensureWebBundleFresh(rootDir);
