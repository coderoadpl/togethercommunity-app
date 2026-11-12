import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createDb } from '#adapters/db/client.js';
import { createTenantRepository, createTenantSecretRepository } from '#adapters/db/repositories.js';
import { createStorageReferenceRepository } from '#adapters/db/storage-references.js';
import { createS3StorageProvider } from '#adapters/storage/s3.js';
import { storageOrphanReportInputSchema } from '#core/domain/index.js';
import { reportStorageOrphans, type TenantSecretResolver } from '#core/server/index.js';

const USAGE = 'Usage: pnpm run storage:orphan-report --tenant <id-or-slug> [--grace-hours <hours>] [--json]\nReport only. No objects or database rows are deleted or changed.';

export const parseStorageReportArgs = (args: string[]) => {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      tenant: { type: 'string' },
      'grace-hours': { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { help: true } as const;
  const input = storageOrphanReportInputSchema.parse({
    tenantId: values.tenant,
    ...(values['grace-hours'] === undefined ? {} : { graceHours: Number(values['grace-hours']) }),
  });
  return { help: false, json: values.json, input } as const;
};

export const createStorageReportProvider = (secretResolver: TenantSecretResolver, env: unknown) => {
  const settings = z.object({
    STORAGE_ALLOW_PRIVATE_ENDPOINTS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  }).parse(env);
  return createS3StorageProvider(secretResolver, { allowPrivateEndpoints: settings.STORAGE_ALLOW_PRIVATE_ENDPOINTS });
};

const run = async (): Promise<void> => {
  const args = parseStorageReportArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const env = z.object({
    DATABASE_URL: z.string().url(),
    SECRETS_MASTER_KEY: z.string().min(1),
  }).safeParse(process.env);
  if (!env.success) throw new Error('DATABASE_URL and SECRETS_MASTER_KEY are required');
  const db = createDb('node-postgres', env.data.DATABASE_URL, { max: 1 });
  const tenants = createTenantRepository(db);
  const tenant = await tenants.findById(args.input.tenantId) ?? await tenants.findBySlug(args.input.tenantId);
  if (tenant === null) throw new Error('Tenant not found');
  const secretResolver = createTenantSecretResolver(
    createTenantSecretRepository(db), createSecretCrypto(env.data.SECRETS_MASTER_KEY),
  );
  const storage = createStorageReportProvider(secretResolver, process.env);
  const result = await reportStorageOrphans({ ...args.input, tenantId: tenant.id }, {
    references: createStorageReferenceRepository(db),
    storage: { list: storage.list },
    secretResolver,
    clock: { nowIso: () => new Date().toISOString() },
  });
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, error: { code: result.error.code, message: result.error.message } }));
    process.exitCode = 1;
    return;
  }
  if (args.json) console.log(JSON.stringify(result.value));
  else {
    console.log(`Storage report for ${result.value.tenantId} (${result.value.complete ? 'complete' : 'incomplete'})`);
    for (const [classification, count] of Object.entries(result.value.summary)) {
      console.log(`${classification}: ${String(count)}`);
    }
    for (const object of result.value.objects) {
      console.log(JSON.stringify(object));
    }
    for (const limitation of result.value.limitations) console.log(limitation);
  }
  if (!result.value.complete) process.exitCode = 2;
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run().catch(() => {
    console.error(`Storage report failed. Check arguments, database access, and secret configuration.\n${USAGE}`);
    process.exitCode = 1;
  });
}
