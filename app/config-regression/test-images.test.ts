import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import {
  MINIO_CLIENT_RELEASE,
  MINIO_CLIENT_SHA256,
  MINIO_IMAGE,
  MINIO_RELEASE,
  MINIO_SHA256,
} from '../scripts/test-images.js';

const dockerfile = readFileSync(new URL('../scripts/minio/Dockerfile', import.meta.url), 'utf8');

const ciSchema = z.object({
  jobs: z.record(z.object({
    steps: z.array(z.object({
      uses: z.string().optional(),
      with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    })),
  }).passthrough()),
});
const ci = ciSchema.parse(parse(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')));
const ciServiceImages = Object.values(ci.jobs)
  .flatMap((job) => job.steps)
  .filter((step) => step.uses === './.github/actions/service-container')
  .map((step) => String(step.with?.['image']));

describe('test container images', () => {
  it('pins the in-repository MinIO image inputs', () => {
    expect(MINIO_RELEASE).toBe('RELEASE.2025-09-07T16-13-09Z');
    expect(MINIO_SHA256).toEqual({
      amd64: '7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f',
      arm64: '5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d',
    });
    expect(MINIO_CLIENT_RELEASE).toBe('RELEASE.2025-08-13T08-35-41Z');
    expect(MINIO_CLIENT_SHA256).toEqual({
      amd64: '01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891',
      arm64: '14c8c9616cfce4636add161304353244e8de383b2e2752c0e9dad01d4c27c12c',
    });
    expect(MINIO_IMAGE).toBe(`together-test-minio:${MINIO_RELEASE}`);
  });

  it('pins every MinIO test-image base by digest', () => {
    const baseImages = dockerfile.match(/^FROM .+$/gm) ?? [];
    expect(baseImages).toHaveLength(2);
    expect(baseImages.every((line) => /@sha256:[0-9a-f]{64}(?: AS \w+)?$/.test(line))).toBe(true);
  });

  it('pins every CI service container image by digest', () => {
    expect([...new Set(ciServiceImages)].sort()).toEqual([
      'public.ecr.aws/docker/library/mongo:8.0.32@sha256:d0d926f94df099bff534b7ee5b5986458131a22489dfff8664509af0c1e2ca9c',
      'public.ecr.aws/docker/library/postgres:16@sha256:33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20',
    ]);
    expect(ciServiceImages).toHaveLength(4);
    expect(ciServiceImages.every((image) => /@sha256:[0-9a-f]{64}$/.test(image))).toBe(true);
  });
});
