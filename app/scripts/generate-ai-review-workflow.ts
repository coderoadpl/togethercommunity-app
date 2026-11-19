import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AI_REVIEW_SLOT_COUNT = 6;

type Model = 'primary' | 'fallback';

type Attempt = {
  readonly id: string;
  readonly key: string;
  readonly slot: number;
  readonly model: Model;
  readonly retry: boolean;
};

const slots = Array.from({ length: AI_REVIEW_SLOT_COUNT }, (_, index) => index + 1);

const attemptFor = (slot: number, model: Model, retry: boolean): Attempt => {
  const key = `${String(slot)}${model === 'primary' ? 'p' : 'f'}${retry ? 'r' : ''}`;
  return { id: `try${key}`, key, slot, model, retry };
};

const attempts: readonly Attempt[] = (['primary', 'fallback'] as const).flatMap((model) =>
  slots.flatMap((slot) => [attemptFor(slot, model, false), attemptFor(slot, model, true)]),
);

const attemptsBySlot: readonly Attempt[] = slots.flatMap((slot) =>
  (['primary', 'fallback'] as const).flatMap((model) => [
    attemptFor(slot, model, false),
    attemptFor(slot, model, true),
  ]),
);

export const aiReviewAttemptIds: readonly string[] = attempts.map((attempt) => attempt.id);

const expression = (body: string) => `\${{ ${body} }}`;

const header = `name: ai-review

# Rendered by app/scripts/generate-ai-review-workflow.ts; edit the generator and re-run it, never this file.
# Exhaust primary-model token slots before fallback-model token slots because
# primary capacity is per account. The first valid PASS/FAIL ends the ladder;
# only PASS is green. Missing capacity, malformed output, stale metadata, drafts,
# cancellation, and preparation failures stay red.
on:
  pull_request:
    branches: [staging, main]
    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft, edited]
  workflow_dispatch:
    inputs:
      pr_number:
        description: PR number to inspect
        required: true
        type: string
      dry_run:
        description: Prepare and validate without invoking the reviewer
        required: true
        type: boolean
        default: true

concurrency:
  group: ai-review-\${{ github.event_name }}-\${{ github.event.pull_request.number || inputs.pr_number }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  ai-review:
    name: \${{ github.event_name == 'workflow_dispatch' && 'ai-review-dry-run' || 'ai-review' }}
    if: github.repository == 'coderoadpl/togethercommunity-app' && (github.event_name == 'pull_request' || github.ref == 'refs/heads/main')
    runs-on: ubuntu-24.04
    timeout-minutes: \${{ fromJSON(vars.AI_REVIEW_TIMEOUT_MINUTES || '90') }}
    permissions:
      contents: read
      pull-requests: write
    steps:`;

const targetStep = `      - name: Validate review target
        id: target
        env:
          GH_TOKEN: \${{ github.token }}
          EVENT_NAME: \${{ github.event_name }}
          EVENT_PR: \${{ github.event.pull_request.number }}
          INPUT_PR: \${{ inputs.pr_number }}
          INPUT_DRY_RUN: \${{ inputs.dry_run }}
          EVENT_BASE_SHA: \${{ github.event.pull_request.base.sha }}
          EVENT_HEAD_SHA: \${{ github.event.pull_request.head.sha }}
        run: |
          pr="$EVENT_PR"
          [ "$EVENT_NAME" = workflow_dispatch ] && pr="$INPUT_PR"
          [[ "$pr" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid PR number" >&2; exit 1; }
          metadata="$(gh api --method GET "repos/coderoadpl/togethercommunity-app/pulls/$pr")"
          base_ref="$(printf '%s' "$metadata" | jq -er 'select(.state == "open") | select(.base.repo.full_name == "coderoadpl/togethercommunity-app") | select(.base.ref == "staging" or .base.ref == "main") | .base.ref')"
          base_sha="$(printf '%s' "$metadata" | jq -er '.base.sha | select(test("^[0-9a-f]{40}$"))')"
          head_sha="$(printf '%s' "$metadata" | jq -er '.head.sha | select(test("^[0-9a-f]{40}$"))')"
          draft="$(printf '%s' "$metadata" | jq -r '.draft')"
          if [ "$EVENT_NAME" = pull_request ] && { [ "$base_sha" != "$EVENT_BASE_SHA" ] || [ "$head_sha" != "$EVENT_HEAD_SHA" ]; }; then
            echo "Event metadata is stale" >&2
            exit 1
          fi
          invoke=true
          [ "$EVENT_NAME" = workflow_dispatch ] && [ "$INPUT_DRY_RUN" = true ] && invoke=false
          printf 'pr=%s\\nbase_ref=%s\\nbase_sha=%s\\nhead_sha=%s\\ndraft=%s\\ninvoke=%s\\n'             "$pr" "$base_ref" "$base_sha" "$head_sha" "$draft" "$invoke" >> "$GITHUB_OUTPUT"`;

const checkoutStep = `      - name: Check out the trusted base
        uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955
        with:
          ref: \${{ steps.target.outputs.base_sha }}
          fetch-depth: 0
          persist-credentials: false
          submodules: false
          lfs: false`;

const trustedStep = `      - name: Verify trusted gate installation
        id: trusted
        run: |
          if [ -x .github/scripts/prepare-review.sh ] && [ -x .github/scripts/gate-review.sh ]; then
            echo "installed=true" >> "$GITHUB_OUTPUT"
          else
            echo "::error::bootstrap-not-installed: trusted AI review scripts are absent from the PR base"
            echo "installed=false" >> "$GITHUB_OUTPUT"
          fi`;

const prepareStep = `      - name: Prepare inert review inputs
        id: prepare
        if: \${{ steps.trusted.outputs.installed == 'true' && steps.target.outputs.draft == 'false' }}
        continue-on-error: true
        env:
          GH_TOKEN: \${{ github.token }}
          PR: \${{ steps.target.outputs.pr }}
          EXPECTED_BASE_SHA: \${{ steps.target.outputs.base_sha }}
          EXPECTED_HEAD_SHA: \${{ steps.target.outputs.head_sha }}
          INPUT_ROOT: \${{ runner.temp }}/ai-review-input
          TRUSTED_ROOT: \${{ github.workspace }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
          RUNNER_TEMP: \${{ runner.temp }}
          AI_REVIEW_MODEL: \${{ vars.AI_REVIEW_MODEL || 'claude-opus-5' }}
          AI_REVIEW_MODEL_MAIN: \${{ vars.AI_REVIEW_MODEL_MAIN || 'claude-fable-5-1' }}
          AI_REVIEW_MODEL_FALLBACK: \${{ vars.AI_REVIEW_MODEL_FALLBACK || 'claude-opus-5' }}
          AI_REVIEW_MAX_TURNS: \${{ vars.AI_REVIEW_MAX_TURNS || '120' }}
          AI_REVIEW_TIMEOUT_MINUTES: \${{ vars.AI_REVIEW_TIMEOUT_MINUTES || '90' }}
        run: bash "$GITHUB_WORKSPACE/.github/scripts/prepare-review.sh"`;

const preflightStep = () => [
  '      - name: Detect available token slots',
  '        id: preflight',
  '        env:',
  ...slots.map((slot) => `          SLOT${String(slot)}: ${expression(`secrets.CLAUDE_CODE_OAUTH_TOKEN_${String(slot)}`)}`),
  '        run: |',
  ...slots.map((slot) => {
    const output = `has_slot_${String(slot)}`;
    return `          [ -n "$SLOT${String(slot)}" ] && echo "${output}=true" >> "$GITHUB_OUTPUT" || echo "${output}=false" >> "$GITHUB_OUTPUT"`;
  }),
].join('\n');

const draftStep = `      - name: Report draft
        if: \${{ steps.target.outputs.draft == 'true' }}
        run: |
          echo "::notice::AI review not run for a draft PR; merge remains blocked."`;

const missingCapacityStep = () => {
  const condition = [
    "steps.target.outputs.draft == 'false'",
    "steps.target.outputs.invoke == 'true'",
    ...slots.map((slot) => `steps.preflight.outputs.has_slot_${String(slot)} == 'false'`),
  ].join(' && ');
  const names = slots.map(String).join('/');
  return [
    '      - name: Report missing review capacity',
    `        if: ${expression(condition)}`,
    '        run: |',
    `          echo "::notice::AI review not run: no CLAUDE_CODE_OAUTH_TOKEN_${names} is available; no verdict; merge remains blocked."`,
  ].join('\n');
};

const clearLogStep = `      - name: Clear the execution log
        if: \${{ steps.prepare.outputs.prepared == 'true' }}
        run: rm -f "$RUNNER_TEMP/claude-execution-output.json"`;

const label = (attempt: Attempt) =>
  `slot ${String(attempt.slot)} ${attempt.model}${attempt.retry ? ' cold-start retry' : ''}`;

const attemptCondition = (attempt: Attempt, index: number) => {
  const earlier = attempts.slice(0, index);
  const previous = earlier.at(-1);
  return [
    "steps.prepare.outputs.prepared == 'true'",
    "steps.target.outputs.draft == 'false'",
    "steps.target.outputs.invoke == 'true'",
    '!cancelled()',
    `steps.preflight.outputs.has_slot_${String(attempt.slot)} == 'true'`,
    ...earlier.flatMap((prior) => [
      `steps.classify${prior.key}.outputs.outcome != 'pass'`,
      `steps.classify${prior.key}.outputs.outcome != 'fail'`,
    ]),
    ...(attempt.retry && previous !== undefined
      ? [`steps.classify${previous.key}.outputs.cold_start == 'true'`]
      : []),
  ].join(' && ');
};

const attemptSteps = (attempt: Attempt, index: number) => `      - name: AI review — ${label(attempt)}
        id: ${attempt.id}
        if: ${expression(attemptCondition(attempt, index))}
        continue-on-error: true
        timeout-minutes: \${{ fromJSON(vars.AI_REVIEW_TIMEOUT_MINUTES || '90') }}
        uses: anthropics/claude-code-action/base-action@1d6de8cb0c237e7c15e9e1bdf973826ebae490cc
        env:
          CLAUDE_WORKING_DIR: \${{ runner.temp }}/ai-review-input
          AI_REVIEW_INPUT_ROOT: \${{ runner.temp }}/ai-review-input
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN_${String(attempt.slot)} }}
          prompt: \${{ steps.prepare.outputs.prompt }}
          settings: \${{ steps.prepare.outputs.settings_file }}
          show_full_output: false
          use_node_cache: false
          plugins: ''
          plugin_marketplaces: ''
          claude_args: >-
            --model \${{ steps.prepare.outputs.${attempt.model}_model }}
            --max-turns \${{ steps.prepare.outputs.max_turns }}
            --tools "Read,Grep,Glob"
            --allowedTools "Read,Grep,Glob"
            --setting-sources ""
            --strict-mcp-config
            --mcp-config '{"mcpServers":{}}'
            --no-session-persistence
            --json-schema '{"type":"object","properties":{"verdict":{"type":"string","enum":["PASS","FAIL"]},"summary":{"type":"string"},"tldr":{"type":"string"},"blocking_issues":{"type":"array","items":{"type":"string"}},"safe_to_merge":{"type":"boolean"},"blast_radius":{"type":"object","properties":{"scope":{"type":"string","enum":["isolated","contained","broad"]},"note":{"type":"string"}},"required":["scope","note"]}},"required":["verdict","summary","safe_to_merge","blast_radius"]}'

      - name: Classify ${label(attempt)}
        id: classify${attempt.key}
        if: \${{ always() }}
        env:
          RAW: \${{ steps.${attempt.id}.outputs.structured_output }}
          TRY_OUTCOME: \${{ steps.${attempt.id}.outcome }}
          OUTPUT_EXEC_FILE: \${{ steps.${attempt.id}.outputs.execution_file }}
          REVIEW_MODE: \${{ steps.prepare.outputs.review_mode }}
          DEST_LOG: \${{ runner.temp }}/ai-review-${attempt.id}.json
        run: |
          rm -f "$DEST_LOG"
          source_file="$OUTPUT_EXEC_FILE"
          if [ -z "$source_file" ] || [ ! -s "$source_file" ]; then
            source_file="$RUNNER_TEMP/claude-execution-output.json"
          fi
          if [ -s "$source_file" ]; then
            cp -- "$source_file" "$DEST_LOG"
            echo "log=$DEST_LOG" >> "$GITHUB_OUTPUT"
            export EXEC_LOG="$DEST_LOG"
          else
            echo "log=" >> "$GITHUB_OUTPUT"
            export EXEC_LOG=""
          fi
          rm -f "$RUNNER_TEMP/claude-execution-output.json"
          if [ -z "\${RAW//[[:space:]]/}" ] && [ -n "$EXEC_LOG" ]; then
            RAW="$(jq -crs '
              [ .[] | if type == "array" then .[] else . end ]
              | last | select(type == "object")
              | select(.type == "result" and .is_error != true
                  and (.subtype == null or .subtype == "success"))
              | .structured_output | select(type == "object")
            ' "$EXEC_LOG" 2>/dev/null || true)"
          fi
          export RAW
          bash "$GITHUB_WORKSPACE/.github/scripts/classify-review.sh"
          raw_json="$(printf '%s' "$RAW" | jq -cse 'select(length == 1) | .[0]' 2>/dev/null || true)"
          printf 'raw=%s\\n' "$raw_json" >> "$GITHUB_OUTPUT"

      - name: Diagnose ${label(attempt)}
        if: \${{ steps.classify${attempt.key}.outputs.outcome == 'infra' }}
        continue-on-error: true
        env:
          EXEC_LOG: \${{ steps.classify${attempt.key}.outputs.log }}
          MODEL: \${{ steps.prepare.outputs.${attempt.model}_model }}
          SLOT: '${String(attempt.slot)}'
          ATTEMPT: ${attempt.id}
          REASON: \${{ steps.classify${attempt.key}.outputs.reason }}
          MAX_TURNS: \${{ steps.prepare.outputs.max_turns }}
        run: bash "$GITHUB_WORKSPACE/.github/scripts/failure-reason.sh"`;

const revalidateStep = `      - name: Revalidate the pinned target
        id: current
        if: \${{ always() && steps.prepare.outputs.prepared == 'true' && !cancelled() }}
        continue-on-error: true
        env:
          GH_TOKEN: \${{ github.token }}
          PR: \${{ steps.target.outputs.pr }}
          PREPARE_MODE: revalidate
          BASE_SHA: \${{ steps.prepare.outputs.base_sha }}
          HEAD_SHA: \${{ steps.prepare.outputs.head_sha }}
          BASE_REF: \${{ steps.prepare.outputs.base_ref }}
        run: bash "$GITHUB_WORKSPACE/.github/scripts/prepare-review.sh"`;

const envName = (prefix: string, attempt: Attempt) => `${prefix}_${attempt.key.toUpperCase()}`;

const postStep = () => [
  `      - name: Post the review verdict
        if: \${{ always() && github.event_name == 'pull_request' && (steps.current.outputs.current == 'true' || steps.prepare.outputs.reason == 'base_moved') && !cancelled() }}
        continue-on-error: true
        env:
          GH_TOKEN: \${{ github.token }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          EVENT_NAME: \${{ github.event_name }}
          PR: \${{ steps.target.outputs.pr }}
          CURRENT: \${{ steps.current.outputs.current }}
          PREPARE_REASON: \${{ steps.prepare.outputs.reason }}
          BASE_SHA: \${{ steps.prepare.outputs.base_sha || steps.target.outputs.base_sha }}
          HEAD_SHA: \${{ steps.prepare.outputs.head_sha || steps.target.outputs.head_sha }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
          MAX_TURNS: \${{ steps.prepare.outputs.max_turns }}
          AI_REVIEW_ATTEMPTS: ${aiReviewAttemptIds.join(' ')}`,
  ...attemptsBySlot.flatMap((attempt) => [
    `          ${envName('O', attempt)}: ${expression(`steps.classify${attempt.key}.outputs.outcome`)}`,
    `          ${envName('R', attempt)}: ${expression(`steps.classify${attempt.key}.outputs.reason`)}`,
    `          ${envName('RAW', attempt)}: ${expression(`steps.classify${attempt.key}.outputs.raw`)}`,
    `          ${envName('LOG', attempt)}: ${expression(`steps.classify${attempt.key}.outputs.log`)}`,
    `          ${envName('MODEL', attempt)}: ${expression(`steps.prepare.outputs.${attempt.model}_model`)}`,
  ]),
  '        run: bash "$GITHUB_WORKSPACE/.github/scripts/post-review.sh"',
].join('\n');

const dryRunStep = `      - name: Summarize dry run
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}
        run: echo "DRY RUN — NO AI VERDICT — DOES NOT SATISFY ai-review" >> "$GITHUB_STEP_SUMMARY"`;

const gateStep = () => [
  `      - name: Gate — fail-closed verdict
        if: \${{ always() && !(github.event_name == 'workflow_dispatch' && inputs.dry_run) }}
        env:
          TRUSTED_INSTALLED: \${{ steps.trusted.outputs.installed }}
          PREPARED: \${{ steps.prepare.outputs.prepared }}
          PREPARE_REASON: \${{ steps.prepare.outputs.reason }}
          CURRENT: \${{ steps.current.outputs.current }}
          DRAFT: \${{ steps.target.outputs.draft }}
          AI_REVIEW_ATTEMPTS: ${aiReviewAttemptIds.join(' ')}`,
  ...attemptsBySlot.map((attempt) =>
    `          ${envName('O', attempt)}: ${expression(`steps.classify${attempt.key}.outputs.outcome`)}`),
  `        run: |
          if [ "$PREPARE_REASON" = base_moved ]; then
            exec bash "$GITHUB_WORKSPACE/.github/scripts/gate-review.sh"
          fi
          if [ "$TRUSTED_INSTALLED" != true ]; then
            echo "bootstrap-not-installed: trusted AI review gate is unavailable"
            exit 1
          fi
          bash "$GITHUB_WORKSPACE/.github/scripts/gate-review.sh"`,
].join('\n');

export const renderAiReviewWorkflow = () => `${header}
${[
  targetStep,
  checkoutStep,
  trustedStep,
  prepareStep,
  preflightStep(),
  draftStep,
  missingCapacityStep(),
  clearLogStep,
  ...attempts.map(attemptSteps),
  revalidateStep,
  postStep(),
  dryRunStep,
  gateStep(),
].join('\n\n')}
`;

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(
    join(import.meta.dirname, '..', '..', '.github', 'workflows', 'ai-review.yml'),
    renderAiReviewWorkflow(),
  );
}
