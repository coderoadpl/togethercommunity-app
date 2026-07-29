# ADR-0003: Vercel environments and release topology

Status: accepted, 2026-07-28.

## Context

Together deploys the static web app and Hono API to Vercel. The repository
needs a named development, staging, preview, and production topology that keeps
production promotion owner-controlled and runs each deployment against the
matching database.

Runtime adapters currently require interactive database transactions.
Consequently every environment uses `DB_DRIVER=node-postgres`; the reason and
the migration path to another driver are defined in
[data-atomicity.md](../data-atomicity.md).

## Decision

| Environment | Source | Vercel deployment | Database |
|---|---|---|---|
| Development | local worktree | local Node entry | local Docker Postgres |
| Preview | pull request | automatic Preview | disposable Neon preview branch |
| Staging | `poc-together` | stable Preview alias | Neon staging branch |
| Production | `production` | Vercel Production Branch | Neon production branch |

`poc-together` is trunk and staging. A production release is an owner-approved
pull request from `poc-together` to `production`. Vercel Production Branch
Tracking must point to `production`; merges to trunk must never create a
production deployment.

The Vercel project root is `app`. `api/index.ts` delegates to
`apps/server/src/entry.vercel.ts`, while local and smoke processes keep using
`entry.node.ts`. `NODEJS_HELPERS=0` is mandatory because the Hono node-style
handler owns request-body consumption. Vercel provisions this as a project-level
environment setting through the dashboard or CLI; its per-function
`vercel.json` schema cannot express environment variables. The platform entry
maps `VERCEL_GIT_COMMIT_SHA` to the neutral `APP_COMMIT_SHA` used by health
attestation.

The build runs append-only migrations against the environment database before
building the web bundle. Preview databases are disposable. Staging and
production migrations are forward-only and use expand then contract across
separate releases. A production release containing a constraint or destructive
migration requires a recorded Neon restore point before promotion.

The function runs in Vercel `fra1`; the Neon project must remain in
`aws-eu-central-1`. Moving either side requires moving both. Deployed tenant
resolution uses `X-Tenant` until a wildcard base domain is attached.

Every environment sets `DATABASE_URL`, `DB_DRIVER=node-postgres`,
`APP_BASE_URL`, `APP_BASE_DOMAIN`, production-grade secrets, and the applicable
payment, e-mail, and KSeF configuration. Production additionally sets
`APP_ENV=production`, `NODE_ENV=production`, secure cookies, real payments,
production KSeF, and cron secrets. Preview and staging values must never reuse
production credentials.

## Verification and promotion

Run the remote gate manually against an existing deployment:

```bash
BASE_URL=https://deployment.example \
SMOKE_TENANT=acme \
EXPECTED_SHA="$(git rev-parse HEAD)" \
pnpm run smoke:remote
```

The gate checks the health/database/SHA attestation, the public offer API using
the tenant header, and the public web page. It does not mutate deployed data.
Before deployment, confirm `NODEJS_HELPERS=0` is set for every target Vercel
environment.
The first platform login, project linkage, environment provisioning, and first
deployment remain owner actions.

## Consequences

The same commit advances Preview to staging to production, while environment
data and credentials remain isolated. Production code is reviewed before the
build receives production secrets. Vercel stays confined to the platform entry
and deployment configuration; core and ordinary app modules remain
provider-neutral.
