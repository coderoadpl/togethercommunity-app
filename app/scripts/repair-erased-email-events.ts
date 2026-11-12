import { parseArgs } from 'node:util';
import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { createEmailHmac } from '#adapters/crypto/email-hmac.js';
import { createDb } from '#adapters/db/client.js';
import { repairErasedEmailEvents } from '#adapters/db/email-event-erasure.js';
import { tenants } from '#adapters/db/schema.js';

const { values } = parseArgs({ options: { tenant: { type: 'string' }, apply: { type: 'boolean', default: false } } });
const options = z.object({ tenant: z.string().min(1), apply: z.boolean() }).parse(values);
const environment = z.object({ DATABASE_URL: z.string().url(), SECRETS_MASTER_KEY: z.string().min(1) }).parse(process.env);
const db = createDb('node-postgres', environment.DATABASE_URL);
const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, options.tenant)).limit(1);
if (tenant === undefined) throw new Error('Tenant id was not found');
const result = await repairErasedEmailEvents(db, tenant.id, createEmailHmac(environment.SECRETS_MASTER_KEY), options.apply);
console.log(JSON.stringify({ tenantId: tenant.id, mode: options.apply ? 'apply' : 'dry-run', ...result }));
