import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import deployment from '../vercel.json' with { type: 'json' };

import {
  SERVER_HEADERS_TIMEOUT_MS,
  SERVER_KEEP_ALIVE_TIMEOUT_MS,
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  SHUTDOWN_RELEASE_STEP_LIMIT,
  SHUTDOWN_RELEASE_TIMEOUT_MS,
  SHUTDOWN_WORST_CASE_MS,
} from '../apps/server/src/node-server-limits.js';

const contract = readFileSync(join(import.meta.dirname, '..', 'docs', 'kubernetes.md'), 'utf8')
  .replace(/\s+/gu, ' ');
const seconds = (ms: number): string => String(ms / 1000);

describe('Node server limits', () => {
  it('drain for as long as the hosted platform lets a scheduled endpoint run', () => {
    expect(SHUTDOWN_DRAIN_TIMEOUT_MS).toBeGreaterThanOrEqual(deployment.functions['api/index.ts'].maxDuration * 1000);
  });

  it('match the shutdown numbers and the worst case the Kubernetes contract states', () => {
    expect(SHUTDOWN_WORST_CASE_MS).toBe(SHUTDOWN_DRAIN_TIMEOUT_MS + SHUTDOWN_RELEASE_STEP_LIMIT * SHUTDOWN_RELEASE_TIMEOUT_MS);
    expect(contract).toContain(`After ${seconds(SHUTDOWN_DRAIN_TIMEOUT_MS)} seconds,`);
    expect(contract).toContain(`at most ${String(SHUTDOWN_RELEASE_STEP_LIMIT)} of them, gets at most ${seconds(SHUTDOWN_RELEASE_TIMEOUT_MS)} seconds.`);
    expect(contract).toContain(`The worst case from the signal to exit is therefore ${seconds(SHUTDOWN_WORST_CASE_MS)} seconds.`);
    expect(contract).toContain(`\`terminationGracePeriodSeconds\` to at least ${seconds(SHUTDOWN_WORST_CASE_MS)} plus`);
  });

  it('size the rollout connection budget for pods that still drain', () => {
    expect(contract).toContain(`release steps finish, at most ${seconds(SHUTDOWN_WORST_CASE_MS)} seconds after the signal`);
    expect(contract).toContain('`(2 × replicas + maxSurge) × (DATABASE_POOL_MAX + 1) + 1 + reserve`');
    expect(contract).toContain('5 × 11 + 1 = 56 connections');
  });

  it('match the connection timeouts the Kubernetes contract gives the edge proxy', () => {
    expect(contract).toContain(`open for ${seconds(SERVER_KEEP_ALIVE_TIMEOUT_MS)} seconds (\`keepAliveTimeout\`)`);
    expect(contract).toContain(`wait up to ${seconds(SERVER_HEADERS_TIMEOUT_MS)} seconds for a request's headers (\`headersTimeout\`)`);
    expect(contract).toContain(`sooner than ${seconds(SERVER_KEEP_ALIVE_TIMEOUT_MS)} seconds`);
  });
});
