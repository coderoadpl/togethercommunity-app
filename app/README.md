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
npm run db:seed      # creators, tenants, courses, tiered products, members with varied grants
npm run build:web
npm run dev:server   # API + SPA on http://localhost:48730
```

Open **http://studio.localhost:48730** and **http://acme.localhost:48730** —
sign in as `creator@together.dev` / `demo1234` on studio, or
`creator2@together.dev` / `demo1234` on acme. Each tenant domain shows its own
isolated todos (and its own accent color). Note: on `localhost` browsers reject
cross-subdomain cookies, so you sign in per tenant domain; on a real base domain
one session spans all tenant subdomains.

## Demo data

`npm run db:seed` provisions a rich, idempotent demo dataset (deterministic ids
throughout, e.g. `course-js`, `lesson-js-zmienne-1`) meant for manually testing
feature parity. Re-running the seed never duplicates anything.

**Tenants and owners** (owners sign in with password `demo1234`):

| Tenant     | Subdomain                        | Owner                     |
| ---------- | -------------------------------- | ------------------------- |
| Studio Demo | http://studio.localhost:48730   | `creator@together.dev`    |
| Acme Courses | http://acme.localhost:48730    | `creator2@together.dev`   |
| Akademia Samouka | http://akademia.localhost:48730 | `creator3@together.dev` |

**Courses**

- **Studio** — `Kurs JavaScript od podstaw` (`course-js`): 3 modules with legacy
  prefixes (`Część 1 - Podstawy` → 2 chapters, `Część 2 - DOM`, `Część 3 -
  Projekty`); `React w praktyce` (`course-react`): 2 modules. Lessons mix
  `embed` (YouTube-nocookie), `html` (Polish teaching prose), `link` and `pdf`
  blocks.
- **Akademia** — `Samodzielna nauka programowania` (`course-akademia`): 2 modules.
- **Acme** keeps its original walking-skeleton data untouched.

**Product tiers (Studio)** — all published, price in PLN grosze:

| Product                          | Price   | Access level                                    |
| -------------------------------- | ------- | ----------------------------------------------- |
| `Kurs JavaScript - pełny dostęp` | 39900   | course-level → `course-js`                      |
| `React w praktyce - pełny dostęp`| 49900   | course-level → `course-react`                   |
| `Pakiet: moduł DOM`              | 9900    | module-level → only the DOM module of `course-js` |
| `Free preview`                   | 0       | lesson-level → one lesson from every module of both courses |

Akademia offers `Akademia - dostęp roczny` (29900, course-level).

**Members** — sign in **passwordlessly via magic link** (CLI `login-magic
--email <e>`, or a checkout). Their grants exercise every access edge state:

| Member                          | Tenant   | Grant                          | What they see                                                  |
| ------------------------------- | -------- | ------------------------------ | ------------------------------------------------------------- |
| `kursant.aktywny@together.dev`  | studio   | perpetual → JS course          | `course-js` fully-accessible, partially-completed (2 lessons done + last-viewed) |
| `kursant.wygasly@together.dev`  | studio   | JS course, **expired 7d ago**  | course **absent** from `student courses`; structure `not-accessible` |
| `kursant.przyszly@together.dev` | studio   | JS course, **starts in 7d**    | course **absent** (grant not yet active); structure `not-accessible` |
| `kursant.modul@together.dev`    | studio   | active → DOM module pack        | `course-js` partially-accessible (only DOM module unlocked)   |
| `free@together.dev`             | studio   | active → Free preview           | both courses partially-accessible (one lesson per module)     |
| `kursant.akademia@together.dev` | akademia | active, expires in ~330d        | `course-akademia` fully-accessible, 1 lesson completed        |

The "absent vs. not-accessible" behaviour reflects `listMyCourses` semantics: it
lists only courses whose access status (computed from **active** grants) is not
`not-accessible`, so expired and future grants drop the course from the list
entirely, while `student structure <courseId>` still resolves it as
`not-accessible`.

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

## Realtime

In-app notifications stream over Server-Sent Events: an authenticated,
tenant-scoped `GET /api/notifications/stream` sends the unread count on
connect, then pushes each new notification for that recipient as it is
delivered (with a heartbeat comment every 25 s). The web app keeps its
TanStack Query caches fresh from this stream and never renders stream
payloads directly.

The stream requires a long-lived Node process. On serverless deployments
(function duration limits cut idle connections), the browser wrapper detects
the failing stream and transparently falls back to 30-second polling of the
same notification endpoints — no server-side configuration needed.

E-mail delivery of thread replies rides the same notification-channel port and
is toggled with `NOTIFY_EMAIL` (see `.env.example`).

## Stripe test mode

Set `PAYMENT_PROVIDER=stripe`, sign in as the tenant owner, and store that tenant's
Stripe test-mode restricted key and webhook signing secret without adding either
value to an env file or Git:

```bash
npm run --silent cli -- --tenant studio tenant-secret set stripe.restrictedKey '<restricted-test-key>'
npm run --silent cli -- --tenant studio tenant-secret set stripe.webhookSecret '<webhook-signing-secret>'
npm run --silent cli -- --tenant studio stripe test-connection
```

The restricted key needs write access to Checkout Sessions. In the Stripe
Dashboard, register `/api/webhooks/stripe/<tenant-id>` for
`checkout.session.completed`. For localhost, the Stripe CLI can forward events:

```bash
stripe listen --events checkout.session.completed --forward-to http://localhost:48730/api/webhooks/stripe/<tenant-id>
```

Store the `whsec_…` value printed by `stripe listen` as the tenant webhook
secret, open a published product's `/checkout/<product-id>` page, and pay with a
Stripe test card. The browser return page only shows status; the signed webhook
creates or renews access and sends the welcome magic link.

Checkout is one-time payment only. Recurring payments and subscriptions remain
deferred under FR-33.

## Ports

| service | port |
|---|---|
| API + SPA | 48730 |
| Vite dev | 48731 |
| Postgres (Docker) | 48912 |
