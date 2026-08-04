import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { createS3StorageProvider } from '#adapters/storage/s3.js';
import {
  err,
  notFound,
  storageConfigurationSchema,
  type AppError,
  type StorageConfiguration,
  type StorageProbeErrorCode,
} from '#core/domain/index.js';
import {
  ATTACHMENT_DOWNLOAD_TTL_SECONDS,
  ATTACHMENT_UPLOAD_TTL_SECONDS,
} from '#core/server/index.js';

import { delay, ephemeralPort, run } from './server-harness.js';

const container = `together-storage-e2e-minio-${randomUUID()}`;
const managedPort = await ephemeralPort();
const managedConfiguration: StorageConfiguration = {
  provider: 'minio',
  endpoint: `http://127.0.0.1:${String(managedPort)}`,
  region: 'us-east-1',
  bucket: 'together-storage-e2e',
  accessKeyId: 'together-e2e',
  secretAccessKey: 'together-e2e-secret',
};

const providerCodeSchema = z.object({ providerCode: z.string() });

class StorageE2eFailure extends Error {}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new StorageE2eFailure(message);
}

const configuredTarget = (): StorageConfiguration | null => {
  const endpoint = process.env['STORAGE_E2E_ENDPOINT'];
  if (endpoint === undefined) return null;
  const parsed = storageConfigurationSchema.safeParse({
    provider: process.env['STORAGE_E2E_PROVIDER'] ?? 'aws_s3',
    endpoint,
    region: process.env['STORAGE_E2E_REGION'] ?? 'us-east-1',
    bucket: process.env['STORAGE_E2E_BUCKET'],
    accessKeyId: process.env['STORAGE_E2E_ACCESS_KEY_ID'],
    secretAccessKey: process.env['STORAGE_E2E_SECRET_ACCESS_KEY'],
  });
  if (!parsed.success) {
    throw new StorageE2eFailure(
      `STORAGE_E2E_* is incomplete: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
  return parsed.data;
};

const target = configuredTarget();
const configuration = target ?? managedConfiguration;
const managesMinio = target === null;

const storage = createS3StorageProvider(
  { resolve: async () => err(notFound('The storage probe receives its credentials directly')) },
  { allowPrivateEndpoints: true },
);

const startMinio = async (): Promise<void> => {
  if (!managesMinio) return;
  await run('docker', ['rm', '-f', container]);
  const started = await run('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    container,
    '-e',
    `MINIO_ROOT_USER=${configuration.accessKeyId}`,
    '-e',
    `MINIO_ROOT_PASSWORD=${configuration.secretAccessKey}`,
    '-p',
    `${String(managedPort)}:9000`,
    'minio/minio',
    'server',
    '/data',
  ]);
  assert(
    started.code === 0,
    `Could not start the verification MinIO.\nstdout: ${started.stdout}\nstderr: ${started.stderr}`,
  );

  const deadline = Date.now() + 60000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${configuration.endpoint}/minio/health/live`);
      if (response.ok) break;
      lastError = `status ${String(response.status)}`;
    } catch (cause) {
      lastError = String(cause);
    }
    await delay(250);
  }
  assert(Date.now() < deadline, `MinIO did not become ready on port ${String(managedPort)}: ${lastError}`);

  const created = await run('docker', [
    'exec',
    container,
    'sh',
    '-c',
    `mc alias set local http://127.0.0.1:9000 ${configuration.accessKeyId} ${configuration.secretAccessKey} && mc mb --ignore-existing local/${configuration.bucket}`,
  ]);
  assert(
    created.code === 0,
    `Could not create the verification bucket.\nstdout: ${created.stdout}\nstderr: ${created.stderr}`,
  );
};

const stopMinio = async (): Promise<void> => {
  if (!managesMinio) return;
  await run('docker', ['rm', '-f', container]);
};

const probeCodeOf = (error: AppError): string => {
  const parsed = providerCodeSchema.safeParse(error.details);
  return parsed.success ? parsed.data.providerCode : `${error.code} without a provider code`;
};

const expectProbeFailure = async (
  label: string,
  input: StorageConfiguration,
  expected: StorageProbeErrorCode,
): Promise<void> => {
  const probed = await storage.probe(input);
  assert(!probed.ok, `${label}: the probe unexpectedly succeeded`);
  const actual = probeCodeOf(probed.error);
  assert(actual === expected, `${label}: expected ${expected}, got ${actual} (${probed.error.message})`);
  console.log(`storage:e2e: ${label} → ${actual}`);
};

const verifyAttachmentRoundtrip = async (): Promise<void> => {
  const storageKey = `lesson-attachments/lesson-e2e/${randomUUID()}/handout.txt`;
  const objectUrl = storage.objectUrl(configuration, storageKey).toString();
  const body = `together lesson attachment ${randomUUID()}`;

  const upload = storage.presignPut({
    url: objectUrl,
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    region: configuration.region,
    expiresInSeconds: ATTACHMENT_UPLOAD_TTL_SECONDS,
  });
  assert(upload.ok, `Could not presign the upload: ${upload.ok ? '' : upload.error.message}`);
  const uploaded = await fetch(upload.value, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body,
  });
  assert(uploaded.ok, `The presigned upload failed with HTTP ${String(uploaded.status)}`);

  const metadata = await storage.head({
    url: objectUrl,
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    region: configuration.region,
  });
  assert(metadata.ok, `Could not read attachment metadata: ${metadata.ok ? '' : metadata.error.message}`);
  assert(
    metadata.value.sizeBytes === Buffer.byteLength(body),
    `The attachment metadata reported ${String(metadata.value.sizeBytes)} bytes instead of ${String(Buffer.byteLength(body))}`,
  );

  const unsigned = await fetch(objectUrl);
  assert(!unsigned.ok, `The uploaded attachment is publicly readable (HTTP ${String(unsigned.status)})`);

  const download = storage.presignGet({
    url: objectUrl,
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    region: configuration.region,
    expiresInSeconds: ATTACHMENT_DOWNLOAD_TTL_SECONDS,
  });
  assert(download.ok, `Could not presign the download: ${download.ok ? '' : download.error.message}`);
  const downloaded = await fetch(download.value);
  assert(downloaded.ok, `The presigned download failed with HTTP ${String(downloaded.status)}`);
  const received = await downloaded.text();
  assert(received === body, `The downloaded attachment differs from the uploaded one: "${received}"`);

  const removed = await storage.delete({
    url: objectUrl,
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    region: configuration.region,
  });
  assert(removed.ok, `Could not delete the attachment: ${removed.ok ? '' : removed.error.message}`);
  console.log('storage:e2e: presigned attachment upload, private read and delete → ok');
};

const assertBucketIsEmpty = async (): Promise<void> => {
  if (!managesMinio) return;
  const listed = await run('docker', [
    'exec',
    container,
    'mc',
    'ls',
    '--recursive',
    `local/${configuration.bucket}`,
  ]);
  assert(listed.code === 0, `Could not list the verification bucket.\n${listed.stderr}`);
  assert(
    listed.stdout.trim().length === 0,
    `The probe left objects behind:\n${listed.stdout}`,
  );
};

const startedAt = Date.now();
try {
  await startMinio();
  console.log(
    `storage:e2e: probing ${configuration.provider} bucket "${configuration.bucket}" at ${configuration.endpoint}`,
  );

  const probed = await storage.probe(configuration);
  assert(
    probed.ok,
    `The live probe failed: ${probed.ok ? '' : `${probeCodeOf(probed.error)} — ${probed.error.message}`}`,
  );
  console.log(`storage:e2e: write, read and delete → ${probed.value.code}`);
  await verifyAttachmentRoundtrip();
  await assertBucketIsEmpty();

  await expectProbeFailure(
    'missing bucket',
    { ...configuration, bucket: `${configuration.bucket}-does-not-exist` },
    'storage.bucket',
  );
  await expectProbeFailure(
    'wrong secret key',
    { ...configuration, secretAccessKey: `${configuration.secretAccessKey}-wrong` },
    'storage.credentials',
  );
  await expectProbeFailure(
    'unreachable endpoint',
    { ...configuration, endpoint: 'http://127.0.0.1:1' },
    'storage.unavailable',
  );

  console.log(`\nstorage:e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`\nstorage:e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  await stopMinio();
}
