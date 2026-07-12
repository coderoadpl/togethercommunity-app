# Together PoC

A proof of concept for **Together**, built on the agent-first, strictly layered
full-stack TypeScript foundation. It currently contains the **walking skeleton**:
auth, organizations (tenants), tenant resolution by domain, one demo resource
(todos) flowing through every layer, a full CLI and a web SPA.

## Quickstart (local demo)

```bash
npm install
npm run db:up        # Postgres 16 in Docker on port 48912
npm run db:migrate
npm run db:seed      # two creators + their tenants + members + todos
npm run build:web
npm run dev:server   # API + SPA on http://localhost:48730
```

Open **http://studio.localhost:48730** and **http://acme.localhost:48730** —
sign in as `creator@together.dev` / `demo1234` on studio, or
`creator2@together.dev` / `demo1234` on acme. Each tenant domain shows its own
isolated todos (and its own accent color). Note: on `localhost` browsers reject
cross-subdomain cookies, so you sign in per tenant domain; on a real base domain
one session spans all tenant subdomains.

## CLI — the agent feedback loop

```bash
npm run --silent cli -- login --email creator2@together.dev --password demo1234
npm run --silent cli -- org list
npm run --silent cli -- org switch acme
npm run --silent cli -- todo list
npm run --silent cli -- --tenant acme todo add "Something for Acme"
npm run --silent cli -- --json whoami        # single JSON document on stdout
```

Every command supports `--json` and exits with a code mapped from the error
taxonomy (`validation`=2, `unauthorized`=3, `forbidden`=4, `not_found`=5,
`conflict`=6, `tenant_not_found`=7, `internal`=10). That makes the CLI a
deterministic verification loop for AI agents — and the reference client.

## Architecture in one screen

```
core/domain     entities, Result, error taxonomy          → zod only
core/contract   API routes + schemas (single source)      → domain
core/server     use-cases + ports (interfaces)            → domain
core/client     typed HTTP client + query definitions     → contract
adapters/db     Drizzle repos, driver factory (pg|neon)   → implements ports
adapters/auth   Better Auth (server + client adapter)     → implements ports
apps/server     Hono wiring + composition root            → the only place adapters are instantiated
apps/web        React SPA (Vite, TanStack Router/Query)   → core/client only
apps/cli        commander commands                        → core/client only
```

Rules are **machine-enforced**: `eslint-plugin-boundaries` + `dependency-cruiser`
fail the build on any cross-layer import, on `@vercel/*`/`@neondatabase/*`
outside `adapters/`, and on any framework import inside `core/`. `any` and
type assertions (`as`, except `as const`) are lint errors.

```bash
npm run check   # typecheck + lint + dependency graph + tests — the static gate
npm run smoke   # runtime gate: fresh DB, real server boot, CLI roundtrip
```

## Tenant resolution

Per request: (1) exact custom-domain match in `tenant_domains`,
(2) subdomain of `APP_BASE_DOMAIN` (subdomain = org slug),
(3) `X-Tenant` header (CLI). Membership is verified in every case; every
tenant-scoped use-case takes `ctx.identity` and every repository call requires
`tenantId`.

## Ports

| service | port |
|---|---|
| API + SPA | 48730 |
| Vite dev | 48731 |
| Postgres (Docker) | 48912 |
