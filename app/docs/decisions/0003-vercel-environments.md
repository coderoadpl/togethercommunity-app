# ADR-0003: Vercel environments and release topology

Status: accepted, 2026-07-28. Amended 2026-08-04 to add the deployment-risk
profile and distinguish the target production topology from its outstanding
owner actions and adopt the platform-default branch model. Amended 2026-09-08
to build on GitHub Actions and deploy prebuilt output with isolated credentials.

## Context

Together deploys the static web app and Hono API to Vercel. The repository
needs a named development, staging, preview, and production topology that keeps
production promotion owner-controlled and runs each deployment against the
matching database.

The internal [deployment-risk classification](../deployment-risk-classes.md)
selects a SIL-3-shaped posture for Together's commercial hosted production.

Runtime adapters currently require interactive database transactions.
Consequently every environment uses `DB_DRIVER=node-postgres`; the reason and
the migration path to another driver are defined in
[data-atomicity.md](../data-atomicity.md).

## Decision

| Environment | Source | Vercel deployment | Database |
|---|---|---|---|
| Development | local worktree | local Node entry | local Docker Postgres |
| Preview | pull request to `staging` | no deployment from the prebuilt workflow | disposable database for separately provisioned previews |
| Staging | push to `staging` | Actions prebuilt Preview, all stable staging aliases | existing Neon staging branch |
| Production | push to `main` | Actions prebuilt Production (`--prod`) | Neon production branch |

This table is the target release topology, not evidence of live configuration.
Earlier on 2026-08-04, the remote had no `production` branch and no
ruleset; that was
a recorded launch blocker under the former topology. Later that day, the
model
was switched to the platform's default convention because the inverted model
(`main` as staging and `production` as production) fought the hosting and
database integrations, which assume that the default branch is production.

`main` is now the default and production branch. `staging` is the integration
trunk where feature pull requests merge, and a production release is an
owner-approved pull request from `staging` to `main`. The `deploy` workflow builds
on GitHub runners and uploads prebuilt output; `main` uses `--prod` and `staging`
uses Preview plus an explicit list of all staging aliases. The existing staging
database remains separate from production; verify its URL and branch overrides
before disconnecting the Git integration. Pull requests receive neither database
nor hosting secrets and do not create deployments through this workflow. Vercel
Production Branch Tracking points to `main` if the Git integration is restored.
The legacy `production` branch is not a deployment or promotion target.

GitHub environments isolate credentials: `staging-build` / `production-build`
contain database credentials, and `staging-deploy` / `production-deploy` contain
the hosting token. Both pairs restrict branches to `staging` / `main` respectively.
Build environments disable deployment records; only the deploy job records a
deployment. The deploy job runs no repository code. See the
[prebuilt deployment runbook](../../../docs/deploy.md) for owner setup, the required
per-variable build environment audit, domain inventory, cutover and Git rollback.

GitHub enforces rulesets and branch protection on public repositories on the
Free plan, but repository files cannot prove that the live approval wall is
configured. Creation of `staging` and the rulesets, verification of the hosting
boundary, and manual SHA attestation are tracked in items 16–18 of the
[go-live checklist](../go-live-checklist.md#16-production-branch-and-approval-wall).

The Vercel project root is `app`. `api/index.ts` delegates to
`apps/server/src/entry.vercel.ts`, while local and smoke processes keep using
`entry.node.ts`. `NODEJS_HELPERS=0` is mandatory because the Hono node-style
handler owns request-body consumption. This is a build-time Node builder switch:
the GitHub build step explicitly sets it to `0`. Keep the Vercel project-level
setting at `0` for Git-build rollback; that setting alone cannot affect a GitHub
prebuild. The per-function `vercel.json` schema cannot express environment
variables. The platform entry
maps `VERCEL_GIT_COMMIT_SHA` to the neutral `APP_COMMIT_SHA` used by health
attestation.

A serverless function does not survive between requests, so the platform entry
carries none of the in-process tickers that `entry.node.ts` runs. Every queue
that a long-running Node deployment drains on an interval therefore needs a
`vercel.json` cron entry: marketing scheduling, KSeF submission, and the
transactional e-mail outbox (`GET /api/internal/dispatch-email`). The scheduler
GET variants authenticate with `Authorization: Bearer $CRON_SECRET`, the header
Vercel attaches to its own cron invocations.

The build runs append-only migrations against the environment database before
building the web bundle. Preview databases are disposable. Staging and
production migrations are forward-only and use expand then contract across
separate releases. A production release containing a constraint or destructive
migration requires a recorded Neon restore point before promotion.

Before it migrates or reseeds, the build compares the `DATABASE_URL` host
fingerprint with `PRODUCTION_DATABASE_FINGERPRINT`. A deployment that is not
production — `VERCEL_ENV` other than `production`, or an `APP_ENV` naming a
disposable environment — and whose database fingerprint equals the production
one fails the build instead of migrating. An absent `VERCEL_ENV` names no slot:
on Vercel (`VERCEL` or `VERCEL_URL` set) the build is treated as
non-production, off Vercel the posture falls back to `APP_ENV` and `NODE_ENV`,
and either way the build log carries a warning line that the slot was unnamed.
A non-production build with the fingerprint variable unset only prints a
warning, so an environment that has not been configured yet still deploys; so
does a build with no `DATABASE_URL`, which leaves the guard nothing to compare.
Set `PRODUCTION_DATABASE_FINGERPRINT` in the Preview and Staging scopes to the
`databaseFingerprint` that production's `/api/health` reports; production
does not need it for that guard, but the GitHub workflow requires it in both build
environments. `db:migrate` logs
`Migrating database <fingerprint> (environment <VERCEL_ENV|APP_ENV>)`, so every
build log names the database it touched.

Staging and preview data is seeded from the deployed code rather than copied
from production. The staging Vercel Preview deployment migrates its database,
checks for the smoke seed markers, and runs `pnpm run db:seed` only when those
markers are absent. A platform owner listed in `PLATFORM_OWNER_EMAILS` gets a
"Reset data" action on the platform host that wipes the demo tenants and
re-seeds them inside the request; `POST /api/platform/data-reset` is registered
only when `APP_ENV` is `staging` or `preview`, so every other deployment answers
404 for every caller and role. The route has its own Vercel function,
`api/platform-reset.ts`, whose exported `maxDuration` of 300 s is read by the Node
builder through static configuration. `app/vercel.json` repeats that 300 s limit
as an additional declaration, without raising the shared `api/index.ts` ceiling
of 60 s.
The action is offered and the capability granted only to a platform owner whose
e-mail address is verified. Every attempt that reaches the reseed is recorded in
`platform_audit_events`, a platform-scoped table the wipe never touches.

The reseed itself refuses to run when the deployment identity reports production
or when the fingerprint of the `DATABASE_URL` host equals
`PRODUCTION_DATABASE_FINGERPRINT`. That refusal lives in the reseed entry point,
so it covers the in-request use-case and `pnpm run db:reseed`. The wipe and the
seed share one transaction and an advisory lock, so overlapping resets queue
instead of interleaving.

A successful reset reports through a snackbar. A failure keeps the confirmation
dialog open and shows the refusal inline rather than as a toast, so the owner can
correct the confirmation and retry without reopening the dialog.

The function runs in Vercel `fra1`; the Neon project must remain in
`aws-eu-central-1`. Moving either side requires moving both. Deployed tenant
resolution uses `X-Tenant` until a wildcard base domain is attached.

Every environment sets `DATABASE_URL`, `DB_DRIVER=node-postgres`,
`APP_BASE_URL`, `APP_BASE_DOMAIN`,
`AUTH_TRUSTED_PROXY_HEADER=x-vercel-forwarded-for`, production-grade secrets,
and the applicable payment, e-mail, and KSeF configuration. Production
additionally sets `APP_ENV=production`, `NODE_ENV=production`, secure cookies,
real payments, production KSeF, and cron secrets. Preview and staging values
must never reuse production credentials.

Vercel sets `NODE_ENV=production` on Preview deployments as well, so `NODE_ENV`
cannot decide the boot posture on its own. `APP_ENV` names the environment:
`preview` and `staging` are the only values that relax the production
validations, and any other value — including an absent one — keeps the strict
posture. Preview and staging must therefore set `APP_ENV` explicitly, or they
boot as production and are held to production KSeF and production secrets.

A preview deployment answers on a generated URL that no project-level
`APP_BASE_URL` can name, so browser requests to it carry an origin the auth
provider would reject. Outside production the platform-provided `VERCEL_URL`
and `VERCEL_BRANCH_URL` therefore join the trusted auth origins as HTTPS
origins. Production keeps the configured origins only.

## Verification and promotion

Run the remote attestation manually against an existing deployment. Supplying
`EXPECTED_SHA` is mandatory for promotion even though the script accepts an
omitted value:

```bash
BASE_URL=https://deployment.example \
SMOKE_TENANT=acme \
EXPECTED_SHA="$(git rev-parse HEAD)" \
pnpm run smoke:remote
```

The command checks the health/database/SHA attestation, the public offer API
using the tenant header, and the public web page. It does not mutate deployed
data. After a successful Actions `deploy`, production and staging smoke workflows
attest the deployed commit from `workflow_run.head_sha`. Production also retains
the Git integration's successful `Production` deployment trigger. The workflows
perform their existing reseeds before checks and retain SMS alert gating; see
[observability](../observability.md#post-deploy-remote-smoke). These are post-deploy
checks, not a gate before traffic switches.
Before deployment, confirm `NODEJS_HELPERS=0` reaches the GitHub build and remains
set for every target Vercel environment for rollback.
The first platform login, project linkage, environment provisioning, and first
deployment remain owner actions.

## Consequences

The same commit advances Preview to staging to production, while environment
data and credentials remain isolated. Production code is reviewed before the
build receives production secrets. Vercel stays confined to the platform entry
and deployment configuration; core and ordinary app modules remain
provider-neutral.
