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
