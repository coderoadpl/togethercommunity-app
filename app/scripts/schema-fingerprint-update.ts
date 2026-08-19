import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  canonicalJson,
  fingerprintHash,
  introspectSchema,
  shortFingerprint,
} from '#adapters/db/schema-fingerprint.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const target = join(import.meta.dirname, '..', 'drizzle', 'meta', 'schema-fingerprint.json');

const { db, close } = await createTestDatabase('together_fingerprint', baseDatabaseUrl);

try {
  const snapshot = await introspectSchema(db);
  const hash = fingerprintHash(snapshot);
  const schema: unknown = JSON.parse(canonicalJson(snapshot));
  writeFileSync(target, `${JSON.stringify({ hash, shortId: shortFingerprint(hash), schema }, null, 2)}\n`);
  process.stdout.write(`schema-fingerprint: ${shortFingerprint(hash)} (${hash})\n`);
} finally {
  await close();
}
