import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const workflowSchema = z.object({
  jobs: z.object({
    'release-tag': z.object({
      steps: z.array(z.object({ name: z.string().optional(), run: z.string().optional() })),
    }),
  }),
});
const workflow = workflowSchema.parse(parse(readFileSync(
  join(import.meta.dirname, '..', '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
)));
const script = workflow.jobs['release-tag'].steps.find(
  (step) => step.name === 'tag the promotion and publish its changelog',
)?.run;
if (script === undefined) throw new Error('Release tag step is missing');

const commitSha = '1'.repeat(40);
const otherSha = '2'.repeat(40);
const tagSha = '3'.repeat(40);
const nestedTagSha = '4'.repeat(40);
const refEndpoint = 'repos/example/repository/git/ref/tags/v0.1.0';
const tagsEndpoint = 'repos/example/repository/git/tags';

interface ApiResponse { stdout: string; status: number; }
const object = (type: string, sha: string) => JSON.stringify({ type, sha });
const refResponse = (type: string, sha: string): ApiResponse => ({
  stdout: `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"object":${object(type, sha)}}`,
  status: 0,
});
const failure = (status: number): ApiResponse => ({
  stdout: `HTTP/2.0 ${String(status)} Error\r\n\r\n{"status":"${String(status)}"}`,
  status: 1,
});

const stubs = `
gh() {
  local index response
  index="$(wc -l < "$RUNNER_TEMP/calls")"
  printf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"
  response="$(jq -ce --argjson index "$index" '.[$index]' "$RUNNER_TEMP/responses.json")" || return 99
  printf '%s\\n' "$(jq -r '.stdout' <<< "$response")"
  return "$(jq -r '.status' <<< "$response")"
}
pnpm() {
  printf '%s\\n' "$*" >> "$RUNNER_TEMP/changelog-calls"
  printf 'Release notes\\n'
}
`;

function runTagStep(responses: ApiResponse[]) {
  const directory = mkdtempSync(join(tmpdir(), 'release-tag-workflow-'));
  try {
    writeFileSync(join(directory, 'responses.json'), JSON.stringify(responses));
    writeFileSync(join(directory, 'calls'), '');
    writeFileSync(join(directory, 'changelog-calls'), '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', `${stubs}\n${script}`], {
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        RUNNER_TEMP: directory,
        GITHUB_REPOSITORY: 'example/repository',
        GITHUB_SHA: commitSha,
        VERSION: '0.1.0',
      },
    });
    if (result.error !== undefined) throw result.error;
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      calls: readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n'),
      changelogCalls: readFileSync(join(directory, 'changelog-calls'), 'utf8'),
      directory,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('release tag identity', () => {
  it('accepts a lightweight tag only at the current commit', () => {
    const result = runTagStep([refResponse('commit', commitSha)]);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain(`v0.1.0 already exists at ${commitSha}`);
    expect(result.calls).toEqual([`api --include ${refEndpoint}`]);
    expect(result.changelogCalls).toBe('');
  });

  it('dereferences nested annotated tags before accepting the commit', () => {
    const result = runTagStep([
      refResponse('tag', tagSha),
      { stdout: object('tag', nestedTagSha), status: 0 },
      { stdout: object('commit', commitSha), status: 0 },
    ]);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toEqual([
      `api --include ${refEndpoint}`,
      `api ${tagsEndpoint}/${tagSha} --jq .object`,
      `api ${tagsEndpoint}/${nestedTagSha} --jq .object`,
    ]);
    expect(result.changelogCalls).toBe('');
  });

  it.each(['commit', 'tag'])('rejects an existing %s pointing to another commit', (type) => {
    const responses = type === 'tag'
      ? [refResponse('tag', tagSha), { stdout: object('commit', otherSha), status: 0 }]
      : [refResponse('commit', otherSha)];
    const result = runTagStep(responses);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain(`resolves to commit ${otherSha}`);
    expect(result.calls).toHaveLength(responses.length);
    expect(result.changelogCalls).toBe('');
  });

  it.each(['blob', 'tree'])('rejects a %s even if the SHA matches', (type) => {
    const result = runTagStep([refResponse(type, commitSha)]);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain(`resolves to ${type}`);
    expect(result.calls).toHaveLength(1);
    expect(result.changelogCalls).toBe('');
  });

  it('creates the annotated tag and release only after a missing ref response', () => {
    const result = runTagStep([
      failure(404),
      { stdout: tagSha, status: 0 },
      { stdout: '{}', status: 0 },
      { stdout: 'Release published', status: 0 },
    ]);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toEqual([
      `api --include ${refEndpoint}`,
      `api ${tagsEndpoint} --input ${result.directory}/tag.json --jq .sha`,
      `api repos/example/repository/git/refs -f ref=refs/tags/v0.1.0 -f sha=${tagSha}`,
      `release create v0.1.0 --title v0.1.0 --notes-file ${result.directory}/CHANGELOG.md`,
    ]);
    expect(result.changelogCalls).toBe('--silent exec tsx scripts/changelog.ts --version 0.1.0\n');
  });

  it.each([401, 403, 429, 500, 503])('fails closed on HTTP %i during the ref lookup', (status) => {
    const result = runTagStep([failure(status)]);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('Could not check whether v0.1.0 exists');
    expect(result.calls).toHaveLength(1);
    expect(result.changelogCalls).toBe('');
  });

  it('does not interpret a transport failure or a body mentioning 404 as a missing ref', () => {
    const result = runTagStep([{ stdout: 'connection failed\nHTTP/2.0 404 Not Found', status: 1 }]);
    expect(result.status, result.output).not.toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.changelogCalls).toBe('');
  });

  it.each([404, 403, 500])('fails closed on HTTP %i while dereferencing an annotated tag', (status) => {
    const result = runTagStep([refResponse('tag', tagSha), failure(status)]);
    expect(result.status, result.output).not.toBe(0);
    expect(result.calls).toHaveLength(2);
    expect(result.changelogCalls).toBe('');
  });

  it.each(['{}', '{"object":{}}', 'invalid JSON'])('rejects an unreadable successful ref response: %s', (body) => {
    const result = runTagStep([{ stdout: `HTTP/2.0 200 OK\r\n\r\n${body}`, status: 0 }]);
    expect(result.status, result.output).not.toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.changelogCalls).toBe('');
  });
});
