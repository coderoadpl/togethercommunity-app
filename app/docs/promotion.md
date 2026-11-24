# Production promotion

Production is promoted through a pull request from `staging` to `main`.
`promote-*` branches are no longer used.

## Runbook

0. One time, the owner marks `staging-freeze` as a required status check in the
   `staging` branch ruleset. Until that ruleset requires the check, setting
   `STAGING_FREEZE=true` only turns the check red; it does not block merges.

1. Freeze staging merges before starting the promotion:

   ```bash
   gh variable set STAGING_FREEZE --body true
   ```

2. Wait for in-flight merges to finish. Confirm `staging ci` and
   `staging-smoke` are green on the current `staging` head.

3. Open the promotion pull request from `staging` to `main`. Use a title in the
   form `promote: ...`, and include the merged pull requests since `main`, any
   migrations, and verification links in the body.

4. Let the AI promotion review and `promotion-guard` run on the promotion pull
   request.

5. The owner approves the pull request on GitHub. Merge it after that approval.

6. Confirm `prod-smoke` passes after the merge. Then clear the freeze:

   ```bash
   gh variable set STAGING_FREEZE --body false
   ```

   Clearing `STAGING_FREEZE` does not re-run existing pull request checks by
   itself. Find pull request run IDs and re-run `staging-freeze` on open pull
   requests, or push to those branches so the pull request workflow runs again:

   ```bash
   gh run list --workflow staging-freeze.yml --event pull_request
   gh run rerun <run-id>
   ```

   `repository_dispatch` always runs against the default branch (`main`), so it
   cannot refresh a failing check on an open pull request targeting `staging`.
   `repository_dispatch` is not useful for re-running this check on open
   staging pull requests. `workflow_dispatch` and `repository_dispatch` also
   require the workflow file to already exist on the default branch before they
   can be triggered through the API or CLI. During the first promotion cycle,
   before this workflow file has been promoted to `main`, the only ways to
   refresh the check on open pull requests are `gh run rerun` or pushing a new
   commit to the pull request branch.

## Promotion Guard

The `promotion-guard` workflow rejects production promotion pull requests unless
the head branch is `staging`, the head SHA still matches `origin/staging`, and
`STAGING_FREEZE=true`. For `ci.yml` and `staging-smoke.yml`, only runs started
by a `push` to `staging` count for that exact SHA, and the newest such run of
each workflow must succeed. Runs started by hand, by a schedule, or by a pull
request never count. A manual `staging-smoke` run cannot stand in for the push
run.

The guard runs when a promotion pull request is opened, reopened or receives a
new head, and again when it leaves draft. A promotion kept as a draft while
`staging` still moves is therefore judged once more at the moment it is marked
ready: freeze `staging` first, then mark the pull request ready, and the guard
re-evaluates without a manual re-run.

When the source, tip and freeze checks pass, the guard re-reads the runs every
30 seconds while waiting: up to 40 minutes if the newest push run of a required
workflow is queued or in progress, and up to 3 minutes if no push run exists
yet. The guard does not wait on a completed run, even if it failed. After the
wait it re-reads the staging tip and evaluates as before; the comment and the
failure message say how long it waited and what was still unfinished. A failed
read of the runs during the wait is logged and the next poll goes ahead while
the bound has not passed; when the last read before the bound fails, the guard
fails with a reason naming the API error and still updates its comment. A failed
first read, before any wait, fails the guard as before. The job's 50-minute
timeout covers the bound.

The guard comment inventories the merged pull requests between `main` and the
promotion head, added migrations under `app/drizzle`, changed top-level areas,
and links to the staging runs it evaluated.

`promote-*` branches are retired. Promotion pull requests come from `staging`
itself so the production candidate is the same commit that passed staging.

The owner adds `promotion-guard` to the `main` ruleset as a required check.

## Required checks

The `staging` and `main` rulesets require one CI check, `dispatch-ci`, plus
three checks that report from their own workflows. What CI runs and what blocks
a merge is decided in the repository by `app/ci/dispatch-ci.manifest.json`, so
adding, removing or relaxing a CI job never needs a ruleset edit.

### Manifest, plan and gate

The manifest is the single source of truth. It names the gate check, lists
every job of `.github/workflows/ci.yml` except the plan job and the gate, marks
each job `required` or `advisory`, carries an optional `runOn` filter by event
(`pull_request`, `push`) and target branch (`staging`, `main`) that defaults to
always, and holds the e2e suites as matrix entries (`suite` plus a `browser`
flag that installs Chrome for that leg). `afterGate` lists jobs that run only
after the gate succeeded (`release-tag`), `separateRequiredChecks` lists the
checks that stay outside the gate per branch with a reason each, and
`deletionProtectedBranches` lists the branches the drift check watches for
deletion protection. `postDeploy` is an empty slot per environment (`staging`,
`production`) reserved for jobs that will run after a deploy; nothing runs it
yet and validation keeps it empty.

`app/scripts/dispatch-ci.ts` runs with plain Node 24, without `pnpm install`,
and has two subcommands:

1. `plan` (the first job, `plan`) reads the manifest and the event, and writes
   the plan as JSON, one `run-<job>` flag per job and `matrix-<job>` for a
   matrix job. An event other than `pull_request` or `push`, or a branch other
   than `staging` or `main`, fails the plan, and with it the gate.
2. Every planned job has `needs: [plan]` and runs only when its flag is
   `true`. The e2e job takes its matrix from the plan and keeps reporting
   `e2e (<suite>)`.
3. `gate` (the last job, `dispatch-ci`, `if: always()`) matches every result
   in `needs` against the plan. It is red when the plan job did not succeed or
   its output is missing or unreadable, when any job was cancelled, when a
   required job failed, when a job planned to run and required was skipped,
   when a job the plan skipped ran anyway, or when `needs` and the plan do not
   list the same jobs. A failing advisory job never turns the gate red, and
   its own job page shows its failure.

The first line of the gate's log and of its step summary names what blocked,
for example
`dispatch-ci: RED — failed: check (step "pnpm run depcruise"), e2e (coupon) (step "Run E2E suite"); cancelled: none; skipped but required: none`.
Failures and cancellations are listed apart, so a red job is never read as a
cancellation. The step names and matrix legs come from a best-effort read of
the run's jobs API with `actions: read`; when that read fails the verdict
stands and the gate says the step names are unavailable.

The jobs that need a database (`check`, `smoke`, `e2e`, `telemetry-mongodb`)
declare no `services:`; they start Postgres or MongoDB with the composite action
`.github/actions/service-container`, which pulls the digest-pinned image with
the error patterns and bounded backoff of `app/scripts/docker-pull.ts` (six
attempts, about a minute of waiting at most), starts it on the same `localhost` port and waits for its health
check. Its step is named `<serviceContainerStepPrefix>: <service>` (manifest
field, `Start service container`). A failed docker command prints its full
output before the `::error` annotation. Only a pull that still fails after the
last retry on registry throttling or a network error is annotated as CI
infrastructure, not a test failure. A non-transient pull error (for example a
mistyped digest), a failed `docker run`, and a container that is unhealthy,
exited or never became healthy get a neutral `Service container` annotation
that names the cause and asks to check the image reference, the container
environment and the health command if the pull request changed them. The gate
shows any failure of that step as
`failed: check (service container: step "Start service container: postgres")`;
the verdict stays red.

The `check` job runs each sub-gate of `pnpm run check` as its own step named
after the command, so the gate can name the failing one. `pnpm run check`
stays the documented local static gate;
`app/config-regression/dispatch-ci-workflow.test.ts` keeps the workflow steps
equal to the script's chain, in order.

### Changing what CI runs

- Add a job: add it to `ci.yml` with `needs: [plan]` and
  `if: needs.plan.outputs.run-<job> == 'true'`, add `run-<job>` to the plan
  job's outputs, add the job to the gate's `needs`, and add it to the manifest
  `jobs`. The binding test fails until the four agree. No ruleset change.
- Make a job advisory: set `mode` to `advisory` in the manifest and
  `continue-on-error: true` on the job; the binding test keeps the two equal.
  Its failure never turns the gate red, and its own job page shows it.
- Run a job only for some events or branches: set `runOn` in the manifest.
- Add an e2e suite: add a matrix entry with its `browser` flag; the job name
  pattern `e2e (${{ matrix.suite }})` keeps the check name stable.

The plan runs in the pull request's merge context, like every other job, so a
pull request can change its own plan exactly as it can change any job today.
Nothing runs pull request code with base-branch privileges.

### Separate required checks

`ai-review` (both branches), `staging-freeze` (`staging`) and
`promotion-guard` (`main`) stay separate required checks because they run in
their own workflows on events that do not start a CI run, or are re-run on
their own; the manifest records the reason for each. The expected required
checks of a branch are the gate plus that branch's separate checks, pinned in
`app/config-regression/rulesets-required-checks.snapshot.json`, so the snapshot
test forces a reviewed change whenever the list moves.

`ungatedChecks` lists, per branch with a reason each, the checks that another
workflow reports on every pull request push but that neither the gate nor the
ruleset should cover; both lists start empty. A config-regression test fails
when any workflow file reports such a check that is not a job of the manifest,
not a separate required check and not listed in `ungatedChecks`, so a new
blocking job outside `ci.yml` cannot go unnoticed.

### Drift check

`app/scripts/rulesets-required-checks.ts` derives the produced checks, the
names a workflow reports on every push to a pull request for a branch, from
the workflow files. It resolves the plan-driven jobs and the e2e matrix through
the manifest. A workflow is left out when it cannot report on every push to a
pull request: no `pull_request` trigger for that branch, a `paths` or
`paths-ignore` filter, a `types` list without `synchronize`, or
`pull_request_target`. A job-level `continue-on-error: true` also leaves that
job out. `chromatic.yml` is an explicit exception in `IGNORED_WORKFLOW_FILES`.
A matrix or a job `name:` expression the derivation cannot resolve is a hard
error rather than a guess. A test asserts that each expected required check is
produced by exactly one job for its branch, and that only one job in
`.github/workflows` reports the gate name.

`pnpm run rulesets-drift` compares the expected and produced checks with the
live rulesets in four lists per branch:

- expected but not required: add these to the ruleset;
- required, not expected, and produced only by jobs of the manifest (legacy):
  a per-job check that now reports through the gate; remove it from the
  ruleset, but while the gate itself is still missing from that ruleset the
  report says to keep it until the gate is required there;
- required, not expected, and produced by another workflow file (ungated):
  neither the gate nor the manifest covers it; add it to
  `separateRequiredChecks` or remove it from the ruleset;
- required and produced by nothing (unknown): it blocks every pull request
  forever; remove it now.

It also checks deletion protection for every branch in
`deletionProtectedBranches`: the live branch rules must contain a `deletion`
rule from a ruleset other than the one that requires status checks, so the
branch stays undeletable while the gate ruleset is disabled. The owner creates
that as a separate ruleset with only "Restrict deletions" turned on; while
deletion is restricted only inside the gate ruleset the report lists it under
"Branch deletion protection".

Three surfaces run that comparison:

- `.github/workflows/ci.yml` runs it inside `check` on every pull request whose
  diff touches `.github/workflows/**`, `app/ci/dispatch-ci.manifest.json`,
  `app/scripts/dispatch-ci.ts`, `app/scripts/rulesets-required-checks.ts` or
  `app/scripts/rulesets-drift.ts`.
  It warns on expected, legacy, ungated and deletion-protection findings, and
  fails only on unknown checks.
- `.github/workflows/rulesets-drift.yml` runs it daily at 05:43 UTC and on
  demand, with `contents: read` + `issues: write`. It fails on any finding,
  opens one issue titled `Ruleset drift`, labelled `ruleset-drift`, updates its
  body while the drift lasts, closes it once the rulesets match, and closes any
  older duplicate carrying the same label. Do not edit that issue by hand; it is
  overwritten.
- `pnpm run rulesets-drift` locally, with `GITHUB_TOKEN` and `GITHUB_REPOSITORY`
  (or `REPO`) in the environment. It defaults to scheduled mode; pass
  `-- --mode=pull-request` to check the pull-request policy.

### Transition from per-job checks

`ci.yml` still reports every per-job check under its old name (`check`,
`visual`, `smoke`, `e2e (<suite>)`), because the live rulesets keep requiring
them until the owner swaps the list. Until then the drift report lists
`dispatch-ci` as expected and the per-job names as legacy to keep until
`dispatch-ci` is required on that branch, and the `Ruleset drift` issue stays
open. Swap order: wait until `dispatch-ci` has
reported on a run of each branch, add it to both rulesets, then remove the
legacy names, and add the separate deletion-protection ruleset.

Rollout order matters in both directions. Add a check to a ruleset only after
a run of the branch has already reported it, otherwise every open pull request
waits on a check that never arrives. When removing a check, drop it from the
ruleset first and delete the job afterwards; if a pull request deletes or
renames a still-required check, the pull-request drift gate fails because the
live ruleset would otherwise block every pull request.
