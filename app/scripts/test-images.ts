import { join } from 'node:path';

import { run } from './server-harness.js';

export const MINIO_RELEASE = 'RELEASE.2025-09-07T16-13-09Z';
export const MINIO_SHA256 = {
  amd64: '7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f',
  arm64: '5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d',
} as const;
export const MINIO_CLIENT_RELEASE = 'RELEASE.2025-08-13T08-35-41Z';
export const MINIO_CLIENT_SHA256 = {
  amd64: '01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891',
  arm64: '14c8c9616cfce4636add161304353244e8de383b2e2752c0e9dad01d4c27c12c',
} as const;
export const MINIO_IMAGE = `together-test-minio:${MINIO_RELEASE}`;

export const ensureMinioImage = async (): Promise<void> => {
  const existing = await run('docker', ['image', 'inspect', MINIO_IMAGE]);
  if (existing.code === 0) return;

  const built = await run('docker', [
    'build',
    '--file',
    join('scripts', 'minio', 'Dockerfile'),
    '--tag',
    MINIO_IMAGE,
    '--build-arg',
    `MINIO_RELEASE=${MINIO_RELEASE}`,
    '--build-arg',
    `MINIO_SHA256_AMD64=${MINIO_SHA256.amd64}`,
    '--build-arg',
    `MINIO_SHA256_ARM64=${MINIO_SHA256.arm64}`,
    '--build-arg',
    `MINIO_CLIENT_RELEASE=${MINIO_CLIENT_RELEASE}`,
    '--build-arg',
    `MINIO_CLIENT_SHA256_AMD64=${MINIO_CLIENT_SHA256.amd64}`,
    '--build-arg',
    `MINIO_CLIENT_SHA256_ARM64=${MINIO_CLIENT_SHA256.arm64}`,
    '.',
  ]);
  if (built.code !== 0) {
    throw new Error(`Could not build ${MINIO_IMAGE}.\nstdout: ${built.stdout}\nstderr: ${built.stderr}`);
  }
};
