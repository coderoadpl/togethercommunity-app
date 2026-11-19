import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const workflowSchema = z.object({
  jobs: z.object({
    probe: z.object({
      steps: z.array(z.object({
        name: z.string().optional(),
        id: z.string().optional(),
        run: z.string().optional(),
      })),
    }),
  }),
});

const workflow = workflowSchema.parse(parse(readFileSync(
  join(import.meta.dirname, '..', '..', '.github', 'workflows', 'prod-health.yml'),
  'utf8',
)));
const script = workflow.jobs.probe.steps.find(
  (step) => step.id === 'probe' && step.name === 'Probe production health',
)?.run;
if (script === undefined) throw new Error('Probe production health step is missing');

const curlStub = `#!/bin/bash
outfile=""
prev=""
url=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    outfile="$arg"
  fi
  case "$arg" in
    https://*) url="$arg" ;;
  esac
  prev="$arg"
done
case "$url" in
  */api/health/deep)
    printf '%s\\n' '{"ok":true}' > "\${outfile:-deep.json}"
    printf '200'
    ;;
  */api/health)
    printf '%s' "$HEALTH_BODY"
    ;;
  *)
    printf 'unexpected curl url: %s\\n' "$url" >&2
    exit 1
    ;;
esac
`;

const healthBody = (fingerprint: 'false' | 'true' | 'absent') => {
  const fingerprintField = fingerprint === 'absent'
    ? ''
    : `,"schemaFingerprintMatch":${fingerprint}`;
  return `{"ok":true,"data":{"database":"up","schemaCurrent":true${fingerprintField}}}`;
};

function probe(fingerprint: 'false' | 'true' | 'absent') {
  const directory = mkdtempSync(join(tmpdir(), 'prod-health-workflow-'));
  try {
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'curl'), curlStub, { mode: 0o755 });
    const output = join(directory, 'github-output');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        PROD_HEALTH_HOST: 'acme.togethercommunity.app',
        GITHUB_OUTPUT: output,
        HEALTH_BODY: healthBody(fingerprint),
      },
    });
    if (result.error !== undefined) throw result.error;
    return {
      status: result.status,
      stderr: result.stderr,
      outputs: readFileSync(output, 'utf8'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('prod-health workflow', () => {
  it('alerts when the schema fingerprint does not match', () => {
    const result = probe('false');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.outputs).toMatch(/^failing=health$/m);
    expect(result.outputs).toContain('fingerprintMatch=false');
  });

  it('stays green when the schema fingerprint matches', () => {
    const result = probe('true');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.outputs).toMatch(/^failing=$/m);
  });

  it('tolerates a missing schema fingerprint', () => {
    const result = probe('absent');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.outputs).toMatch(/^failing=$/m);
  });
});
