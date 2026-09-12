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

5. The owner approves the pull request on GitHub. The agent then merges it.

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
`STAGING_FREEZE=true`. It also requires successful `ci.yml` and
`staging-smoke.yml` runs for that exact staging SHA.

The guard comment inventories the merged pull requests between `main` and the
promotion head, added migrations under `app/drizzle`, changed top-level areas,
and links to the staging runs it evaluated.

`promote-*` branches are retired. Promotion pull requests come from `staging`
itself so the production candidate is the same commit that passed staging.

The owner adds `promotion-guard` to the `main` ruleset as a required check.

## Required checks

The required branch checks for `staging` and `main` are derived from the GitHub
Actions workflow files by `app/scripts/rulesets-required-checks.ts` and pinned
in `app/config-regression/rulesets-required-checks.snapshot.json`. Changing a CI
job name or an e2e matrix suite changes the derived list, so the snapshot test
forces the ruleset update to be reviewed with the workflow change.

The derivation scans every workflow file. A workflow is left out of the derived
list when it cannot report on every push to a pull request: no `pull_request`
trigger for that branch, a `paths` filter, a `types` list without `synchronize`,
or a job-level `continue-on-error: true` (an advisory job concludes green even
when it fails, so requiring it only adds waiting time). `chromatic.yml` is an
explicit exception in `IGNORED_WORKFLOW_FILES` because every one of its jobs is
gated on an optional project token. A matrix or a job `name:` expression the
derivation cannot resolve is a hard error rather than a guess.

`pnpm run rulesets-drift` compares that derived list with the live `staging` and
`main` branch rulesets. Missing expected checks fail with the exact status-check
names to add. Extra required checks are reported as warnings so obsolete or
external checks are visible without weakening protection.

Three surfaces run that comparison:

- `.github/workflows/ci.yml` runs it inside `check` on every pull request whose
  diff touches `.github/workflows/**`, so a workflow change and its ruleset
  update land together.
- `.github/workflows/rulesets-drift.yml` runs it daily at 05:43 UTC and on
  demand, with `contents: read` + `issues: write`. It opens one issue titled
  `Ruleset drift`, labelled `ruleset-drift`, updates its body while the drift
  lasts, closes it once the rulesets match, and closes any older duplicate
  carrying the same label. Do not edit that issue by hand; it is overwritten.
- `pnpm run rulesets-drift` locally, with `GITHUB_TOKEN` and `GITHUB_REPOSITORY`
  (or `REPO`) in the environment.

Rollout order matters in both directions. Add a context to a ruleset only after
a run of the branch has already reported it, otherwise every open pull request
waits on a check that never arrives. So: merge the workflow change first, wait
for one run on the target branch, then add the context. When removing a check,
drop it from the ruleset first and delete the job afterwards.
