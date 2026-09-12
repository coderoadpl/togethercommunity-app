import { describe, expect, it } from 'vitest';

import { MINIO_IMAGE } from '../scripts/test-images.js';

describe('test container images', () => {
  it('keeps the MinIO e2e image registry-qualified and pinned', () => {
    expect(MINIO_IMAGE).toMatch(/^(?:localhost(?::[0-9]+)?|[a-z0-9.-]+\.[a-z0-9.-]+(?::[0-9]+)?|[a-z0-9.-]+:[0-9]+)\/[^:]+:[^:]+$/u);
    expect(MINIO_IMAGE).not.toMatch(/:latest$/u);
  });
});
