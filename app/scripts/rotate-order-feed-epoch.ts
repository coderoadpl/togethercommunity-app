import { z } from 'zod';

import { createDb } from '#adapters/db/client.js';
import { rotateOrderFeedEpoch } from '#adapters/db/order-changes.js';

const environment = z.object({ DATABASE_URL: z.string().url() }).parse(process.env);
const db = createDb('node-postgres', environment.DATABASE_URL);
console.log(JSON.stringify({ epoch: await rotateOrderFeedEpoch(db) }));
