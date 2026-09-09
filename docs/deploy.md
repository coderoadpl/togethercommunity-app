# Deploying prebuilt output

[The deploy workflow](../.github/workflows/deploy.yml) builds on GitHub's Ubuntu
runners and uploads the output with `vercel deploy --prebuilt`. Pushes to `staging`
create Preview deployments, pushes to `main` create Production deployments, and
promotion stays a pull request from `staging` to `main`. Deploys do not wait for CI,
matching the Git integration they replace. `workflow_dispatch` accepts those two
branches only. Pull request events cannot start this workflow.

`staging-smoke` and `prod-smoke` listen for successful completion of `deploy` on
their respective branches, including manual deploys. They attest against
`github.event.workflow_run.head_sha`, not the default branch SHA of the smoke run.
Staging's 45 × 20-second alias poll starts after build, migration, upload, deployment
and every alias update finish; environment approval waits do not consume that
budget. Failed or cancelled deploys do not launch a post-deploy smoke: inspect the
failed `deploy` run. Staging retains its daily and manual smoke, and production
retains the Git integration's `deployment_status` / `Production` trigger for
transition and rollback. During overlap production may smoke twice. See
[observability](../app/docs/observability.md#post-deploy-remote-smoke).

## Build job

`build` uses `staging-build` or `production-build`. It installs the app with pnpm,
installs the pinned Vercel CLI with `--ignore-scripts`, and writes
`.vercel/project.json` from `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. It runs
`vercel build` (`--prod` on `main`). It has no Vercel token and does not run
`vercel pull`. Local project settings mirror `app/vercel.json`: no framework
preset, no root directory because the job runs inside `app/`, Node 24, and the
configured build and output paths. Routes, headers and crons travel in the build
output. Deployment uses `--regions fra1` explicitly.

The job supplies build-time commit/branch metadata, environment identity and the
inputs listed below. `NODEJS_HELPERS=0` is a **build-time** requirement: the Node
builder bakes helper use into each function. The Hono node-style handler must own
request-body consumption. Setting this only in Vercel's project environment does
not configure a GitHub prebuild.

The build stamps the version, migrates the database, optionally seeds empty staging,
and builds the web bundle before uploading the artifact. Repository code can access
`DATABASE_URL`. `app/vercel.json` pins the reset function's 300-second limit as an
additional declaration alongside `export const maxDuration = 300`; the Node builder
reads that export through static configuration. The shared API retains its 60-second
limit. The build script ends with `build:web`; typecheck stays in `pnpm run build`
for local use and in CI.

## Deploy job and secret boundary

`deploy` uses `staging-deploy` or `production-deploy`, on a separate runner, with no
checkout, repository action or app install. It installs the pinned CLI with lifecycle
scripts disabled, extracts the artifact through a path/link filter, and replaces the
project link with trusted environment variables. It creates a minimal
`app/vercel.json` because Vercel's project has `rootDirectory: app` and the CLI checks
that directory and reads configuration there, even for prebuilt uploads. There is
no root-level config or custom regions field in the project link.

Only the final CLI deploy/alias step receives `VERCEL_TOKEN`. Store that secret only
in the two `*-deploy` environments, and `DATABASE_URL` only in the two `*-build`
environments; neither belongs in repository or organization secrets. Referencing
`secrets.VERCEL_TOKEN` from the current build environment cannot retrieve the deploy
environment's token. Owner review must still protect changes that select another
environment or add executable steps to the deploy job.

The build environment uses `deployment: false`: it exposes its own secrets and
retains branch restrictions and required reviewers without adding a deployment
record. Only the deploy job creates a record in this workflow, with a URL. Custom
GitHub App deployment protection rules are incompatible with `deployment: false`;
use branch policies and built-in required reviewers on build environments.
See [GitHub's environment configuration](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments#using-environments-without-deployments).

`build` cancels superseded runs for the same ref; `deploy` never cancels a running
deployment. GitHub may replace a pending deployment with a newer one. A cancelled
build may already have migrated, and an older deployment can still serve while a
new schema is applied: keep migrations compatible with the currently serving code.
Artifacts and logs of a public repository are public; keep secrets out of both.

## Owner setup

1. In the intended Vercel project, open **Settings → General → Project ID** and copy
   that exact ID into `VERCEL_PROJECT_ID`. The usage CSV's `prj_IsLx…` and the local
   `.vercel/repo.json` value `prj_TAWz…` disagree; neither is authoritative. Verify the
   project's domains and its `app` root directory in the dashboard. Copy the owning
   team's ID from **Team Settings → General** into `VERCEL_ORG_ID`.
2. Create four GitHub environments. Restrict `staging-build` and `staging-deploy` to
   the branch `staging`, and `production-build` and `production-deploy` to the branch
   `main`, with no tags allowed. Configure required owner approval as appropriate.
   Remove hosting and database credentials from the former shared `staging` and
   `production` environments and from repository/organization scope.
3. Before adding secrets, require owner review of `.github/workflows/**` and protect
   CODEOWNERS itself. Require code-owner review on both branches, dismiss stale
   approvals, and reserve direct pushes and bypass for the owner. Branch policies
   alone cannot stop a workflow edit that changes which environment a job selects.
4. Create an expiring Vercel access token scoped to the intended team. Store it as
   `VERCEL_TOKEN` only in `staging-deploy` and `production-deploy`; rotate before expiry.
5. Set the following values from Vercel Production and the effective Preview values
   for branch `staging` (including branch overrides and shared/team variables):

| Name | GitHub location | Value / purpose |
| --- | --- | --- |
| `VERCEL_TOKEN` | secret, both `*-deploy` environments | Team hosting token |
| `DATABASE_URL` | secret, each `*-build` environment | Matching staging or production database |
| `VERCEL_ORG_ID` | variable, all four environments | Verified team ID |
| `VERCEL_PROJECT_ID` | variable, all four environments | Verified project ID |
| `APP_BASE_DOMAIN` | variable, each `*-build` environment | Matching public base domain |
| `PRODUCTION_DATABASE_FINGERPRINT` | variable, both `*-build` environments | Production database hostname hash |
| `VITE_SENTRY_DSN` | variable, each `*-build` environment | Matching public browser DSN, optional |
| `VERCEL_API_FUNCTION_BUNDLING` | variable, each `*-build` environment | Exact configured builder switch, or absent if absent in Vercel |
| `STAGING_ALIASES` | variable, `staging-deploy` | Every current staging hostname, one per line |

6. The fingerprint is the first 12 hexadecimal characters of SHA-256 of the
   production database URL's **hostname**, not the whole URL. The workflow requires
   it for both builds. Confirm the runners can reach the matching databases.
7. Complete the environment audit below before the first deployment. Runtime-only
   values remain in Vercel, including Preview branch overrides. A variable's Vercel
   project scope does not establish whether it is needed at build time.
8. Inventory **Settings → Domains** and set `STAGING_ALIASES` to every existing
   staging tenant host and the staging platform host, one bare hostname per line,
   without schemes, paths or commas. Include both hosts pinned by `staging-links.yml`
   and the host resolved by `STAGING_HOST` in `staging-smoke.yml`. Put the team's
   preferred entry host first; it becomes the Actions deployment URL. Add future
   staging hosts to this list. Existing explicit aliases must all move, even if a
   wildcard is attached to the project. Missing or malformed lists fail before
   deployment; failure to update any alias fails the deploy run.
9. Ensure these smoke workflow changes are on the default branch before testing:
   `workflow_run` only fires for workflows present there. Run a deploy on each
   branch. Verify the version and full `/api/health` SHA, database migration log,
   reset function limit, `fra1`, headers/rewrites, cron list, and **every** staging
   hostname. Confirm the corresponding smoke run uses the deployed SHA and that the
   existing reseed, checks and SMS alert gate run normally.
10. In **Vercel → Settings → Git**, disconnect the Git integration after the first
    successful prebuilt deployments. Alternatively keep the association and make
    the Ignored Build Step return `exit 0` for both `main` and `staging` while
    validating the first prebuilt deploy, then disconnect. Until Git builds are
    skipped or disconnected, both systems can deploy and migrate. Once disconnected,
    the Ignored Build Step is irrelevant; CLI metadata does not assign branch domains.
11. Confirm compilation logs are in GitHub and Vercel Build CPU usage drops. Vercel
    still hosts functions and serves traffic. Revisit the builder audit when the
    pinned CLI version changes.

## Required environment audit before cutover

In Vercel **Settings → Environment Variables**, inventory the effective **Production**
and **Preview / staging** lists separately, including shared/integration variables
and branch overrides. Compare every name with the `Build prebuilt deployment` step's
`env` and its shell handling. Record one row per actual variable in a private owner
checklist: **name, scope/override, build consumer, GitHub source or deliberate
omission, runtime retained, verified**. Record absent builder switches as absent,
not as an empty string. Do not put secret values or exports in this public repo,
logs or artifacts. This repository does not contain the live lists; this audit is
an outstanding owner cutover gate, not a claim that all project variables were checked.

Use these verdicts for the known inputs and resolve every additional name before
cutover; an unclassified variable blocks the switch:

| Variable | Build consumer and verdict |
| --- | --- |
| `NODEJS_HELPERS` | Node builder; fixed to `0` in both GitHub builds. Keep `0` in Vercel for Git-build rollback. |
| `VERCEL_API_FUNCTION_BUNDLING` | Node builder; copy each scope's exact value into its build environment variable. The shell unsets an empty GitHub value to preserve the builder default when absent. |
| `DATABASE_URL` | Migration and staging seed; copy the matching credential into the build environment secret and retain in Vercel for runtime. |
| `PRODUCTION_DATABASE_FINGERPRINT` | Migration/seed guard; supply the production hostname fingerprint in both build environments and retain runtime guards in Vercel. |
| `APP_BASE_DOMAIN` | Vite config; copy the scope's public base domain and retain for runtime. |
| `VITE_APP_BASE_DOMAIN` | Browser build; supplied by Vite's `define` from `APP_BASE_DOMAIN`. Verify equivalence and resolve any conflicting Vercel value; do not configure a second source. |
| `VITE_SENTRY_DSN` | Browser build; copy the public DSN if configured. Absence disables browser Sentry. |
| Every other `VITE_*` name | Vite can bake these into browser output. Inventory each separately, identify its consumer, and add explicit public build input wiring if needed; omit only with a recorded reason. Never put secrets under this prefix. |
| `APP_COMMIT_SHA`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF` | Build stamp/seed identity; supplied from the triggering GitHub commit and branch. Runtime Vercel Git identity comes from CLI commit metadata. |
| `APP_ENV`, `VERCEL_ENV` | Migration/seed posture; workflow sets `staging`/`preview` or `production`/`production`. Keep the matching runtime `APP_ENV` in Vercel. |
| `NODE_ENV` | Build-tool mode; no project override is copied. Vite builds in production mode; verify any project override and retain runtime production mode. |
| `VERCEL_TELEMETRY_DISABLED`, `NODE_OPTIONS` | GitHub-only tooling inputs: `1` and the 6 GiB Node heap limit. |
| `BETTER_AUTH_SECRET` | Read by staging's seed auth instance. Deliberately omitted: the current seed uses its local fallback for an auth instance that hashes passwords and writes users, without issuing deployed sessions. Keep the deployed secret in Vercel; re-audit if the seed starts issuing sessions. |
| `SEED_BASE_TIME` | Seed fixture clock; if configured, document whether that override must be preserved and wire it explicitly before first empty-staging build. |
| `DB_DRIVER`, `APP_BASE_URL`, auth/cookie, payment, e-mail, KSeF, storage, cron and operator settings | Runtime candidates, not an automatic exemption. For each actual name, check the migration, seed and Vite dependency paths plus builder consumers. Retain in Vercel; copy only proven build requirements into the build environment. |

## Manual deploy and rollback

Actions → **deploy** → **Run workflow** → `staging` or `main` rebuilds and migrates
that branch; from a shell, `gh workflow run deploy.yml --ref staging`.

Stop new Actions deployments before rollback. For production, use Vercel's rollback
control or `vercel promote <known-good-production-url>` as the owner. For staging,
run `vercel alias set <known-good-preview-url> <hostname>` for **every** entry in
`STAGING_ALIASES`, then attest all hosts and dispatch the smoke with the rollback
SHA. Alias updates are sequential, so a failure can leave hosts on mixed versions;
retry or roll back the entire list.

To return builds to Vercel, disable `deploy.yml` in GitHub Actions, reconnect the
repository in **Vercel → Settings → Git**, set the Production Branch to `main`, and
remove the always-skip Ignored Build Step. Verify project build/runtime variables
(including `NODEJS_HELPERS=0`), staging branch database overrides and every domain
assignment before triggering a Git build. Vercel production deployment events resume
the legacy production smoke; dispatch staging smoke after Git deployments because
its automatic post-deploy trigger now follows Actions `deploy`. Re-enable a Git
trigger for staging smoke if this rollback becomes permanent. A rollback never
undoes migrations: use compatible code and a deliberate database restore if needed.

References: [vercel build](https://vercel.com/docs/cli/build),
[prebuilt deployments and regions](https://vercel.com/docs/cli/deploy),
[branch metadata and domains](https://vercel.com/kb/guide/branch-variables-and-domains-not-linked-to-cli-deployments),
[vercel alias](https://vercel.com/docs/cli/alias),
[vercel promote](https://vercel.com/docs/cli/promote).
