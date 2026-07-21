# together — rules for agents

Together PoC on the strictly layered full-stack TypeScript foundation (§3 of the
architecture spec is normative).

## The two gates

- `npm run check` = typecheck + ESLint (boundaries) + dependency-cruiser +
  vitest — the **static** gate.
- `npm run smoke` = the **runtime** gate: it verifies the installed dependency
  tree matches `package-lock.json`, drops+recreates an isolated
  `together_smoke` database (never touches your dev-seeded data), migrates
  and seeds it, boots the real server (`entry.node.ts`) on an ephemeral port and
  drives health → sign-in → products → simulated purchase → magic-link sign-in
  through the CLI, asserting taxonomy exit codes (including unauthorized =
  exit 3). Assumes `npm run db:up`. Runs in ~5s.

**Done = `check` green AND `smoke` green.** Static-green is not done; the app
must actually run. Do not weaken lint rules to make either green.

## Licensing & IP policy (owner decision 2026-07-21 — HARD RULES)

- Together targets a Fair Source license (FSL/BSL family). 100% copyright
  ownership of this codebase: NO third-party copyleft (GPL/AGPL) code may
  enter the repo — including "translated" or ported code.
- Dependencies: permissive licenses only (MIT / Apache-2.0 / BSD / ISC).
  CHECK THE LICENSE of every new dependency before adding it; if it is not
  clearly permissive, do not add it — flag to the owner instead.
- Clean-room discipline for AGPL inspiration sources (inventory in the owner's private materials):
  reading agents produce behavioral specs in their own words; implementing
  agents work from specs only and never open those sources. No a-prior-art-tool-like
  naming.

## Layer rules (enforced, but know them anyway)

- `core/**` is pure TypeScript: no hono, react, drizzle, better-auth, pg, commander.
- `core/domain` depends on zod only. `core/server` = use-cases + ports.
  `core/contract` = the only bridge between server and clients.
  `core/client` = the only way any client talks HTTP.
- `adapters/**` implement ports; only `apps/server/src/composition.ts` instantiates them.
- `apps/web` and `apps/cli` import `core/client` (+ auth client adapter), never
  `core/server`, never `adapters/db`.
- `@vercel/*` / `@neondatabase/*` only inside `adapters/` (and `entry.vercel.ts`).
- No `any`. No `as` (except `as const`). Parse with zod at every boundary.
- Use-cases return `Result<T, AppError>`; never throw across a boundary.
  New error kinds go into `ERROR_CODES` in `core/domain/errors.ts` and get an
  HTTP status + exit code mapping in `core/contract/http-status.ts` (exhaustive).
- Every tenant-scoped use-case takes `ctx: { identity }` first; every
  tenant-scoped repository method requires `tenantId`.

## Verify features through the CLI first

```bash
npm run db:up && npm run db:migrate && npm run db:seed
npm run dev:server &          # port 48730
npm run --silent cli -- --json health
npm run --silent cli -- login --email creator2@together.dev --password demo1234
npm run --silent cli -- --tenant acme product list
```

`--json` prints exactly one JSON envelope on stdout; exit codes come from
`EXIT_CODE_BY_ERROR_CODE`. Adding a resource = domain schema → contract route →
port + use-case → adapter repo → server route → `core/client` method →
CLI command → web page, in that order, with tests at the core layer.

## Dev notes

- Ports: API 48730, Vite dev 48731, Postgres 48912 (never 3000/8080/5432).
- Tenants live on subdomains: `acme.localhost:48730`. Browsers reject
  `Domain=.localhost` cookies → per-subdomain login in dev only.
- Better Auth CSRF requires an `Origin` header on auth POSTs (CLI sends its API URL).
- Seed is idempotent; demo credentials `creator@together.dev` (studio) and
  `creator2@together.dev` (acme), both `demo1234`.
