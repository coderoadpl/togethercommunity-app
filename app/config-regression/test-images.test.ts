import { describe, expect, it } from 'vitest';

import { MINIO_IMAGE } from '../scripts/test-images.js';

describe('test container images', () => {
  it('keeps the MinIO e2e image pinned by tag and digest', () => {
    expect(MINIO_IMAGE).toBe(
      'docker.io/tobi312/minio:RELEASE.2025-09-07T16-13-09Z@sha256:e2226dea4b9aef896db02f7396102d48eb58cd339d930332e3d8bdac80012a78',
    );
  });
});
