import { ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_VERSION } from './version.js';

const harness = vi.hoisted(() => ({
  resourceFromAttributes: vi.fn((attributes: Record<string, unknown>) => attributes),
  register: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn(),
}));
vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: harness.resourceFromAttributes,
}));
vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: vi.fn(),
}));
vi.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: vi.fn(() => ({
    register: harness.register,
    shutdown: harness.shutdown,
  })),
}));

const strictSemVer =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example';
});

afterEach(() => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
});

describe('application version', () => {
  it('uses strict SemVer syntax', () => {
    expect(APP_VERSION).toMatch(strictSemVer);
  });

  it('identifies the observability service resource', async () => {
    const { startServerObservability } = await import('./observability.js');

    startServerObservability();

    expect(harness.resourceFromAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ [ATTR_SERVICE_VERSION]: APP_VERSION }),
    );
  });
});
