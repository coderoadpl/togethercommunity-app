# ADR-0013: BYO database direction

Status: proposed, 2026-08-03. Design only, explicitly not scheduled.

## Context

Together already sells data ownership: bring your own storage, bring your own
Stripe. The database is the remaining lock-in. The owner's direction of
2026-07-28 is that a tenant's course and member data may live in the tenant's
own Postgres.

The current shape is one process holding exactly one database:

- `createDeps` calls `createDb(env.DB_DRIVER, env.DATABASE_URL)` once at boot
  and binds every repository to that single connection. Tenant identity is
  resolved per request from the host or the tenant header, which happens after
  the repositories already exist.
- `DB_DRIVER` is pinned to `node-postgres` by the environment schema.
  `neon-http` is refused at boot because runtime adapters need interactive
  transactions ([data-atomicity](../data-atomicity.md)).
- Application and Better Auth tables share one schema and one linear Drizzle
  journal, applied by `adapters/db/migrate.ts` against `DATABASE_URL`.
- Only `tenants`, `scheduler_runs`, the two development sinks, and the Better
  Auth identity tables carry no `tenant_id`. Every other application table
  references `tenants` with `on delete cascade`.

## Decision

The direction is adopted as a design target, not as work. Tenant product data
may live in a tenant-owned Postgres while the platform keeps a platform
database. This becomes a candidate only after the first production deploys and
only once the seams below are answered. Nothing here is scheduled, and no code
changes on the strength of this ADR.

### Platform tables versus tenant tables

This is a split, not a move. The platform database keeps identity (`user`,
`session`, `account`, `verification`, `passkey`, `two_factor`), `tenants`,
`tenant_domains`, `tenant_admins`, `tenant_secrets`, `tenant_api_keys`, and
`scheduler_runs`. Identity is cross-tenant by construction: one `user` holds
`members` rows in several tenants and `tenant_admins` rows in others, so
identity cannot live in any single tenant database without breaking login and
multi-tenant membership.

The tenant database receives tenant-scoped product data: members and their
events, products, prices, grants, subscriptions, orders, coupons, courses,
modules, lessons, progress, spaces, posts, reactions, reports, notifications,
campaigns, sends, suppressions, consent records, and tenant documents.

Fiscal data is deliberately left open and defaults to staying platform-side.
Invoices, KSeF numbering, and frozen fiscal artifacts are legal evidence with a
six-year retention basis. Moving them into a database the platform can neither
back up nor attest weakens that evidence chain, and the platform still carries
processor obligations over it.

Every boundary-crossing `tenant_id` foreign key and its cascade disappears.
Tenant deletion stops being one cascade and becomes a two-sided protocol.

### Per-tenant connection routing

The `DbDriver` union in `adapters/db/client.ts` is not the seam. It picks a
driver from the environment, once, for the whole process. The seam is
`createDeps`: repositories must stop closing over a boot-time `Db` and start
receiving a `Db` derived from tenant identity, either through request-scoped
dependencies built after tenant resolution or through a tenant-database
resolver port injected into repositories.

The resolver must pool and bound connections, because one connection per tenant
does not survive a serverless runtime. It must cache with invalidation on
credential rotation. It must fail closed: a tenant whose database is
unreachable is unavailable, never silently empty.

`tenant_secrets` is the credential store. It is already per-tenant,
AES-256-GCM, keyed by `SECRETS_MASTER_KEY`, and read through the existing
tenant secret resolver that Stripe and KSeF credentials use. The connection
secret must live in the platform database and never in the tenant database, and
tenant resolution must stay a platform-database read.

### Atomicity is the gate

Most operations in the MUST-ATOMIC inventory stay inside one tenant database
and survive the split. Three classes do not, and they are the reason this is
not near-term work.

- `MemberErasurePort.pseudonymize` runs one transaction that rewrites tenant
  rows, then counts `members` and `tenant_admins` across all tenants to decide
  whether the shared auth user is orphaned, then deletes the `user` row. Split
  by tenant, that single transaction spans the tenant database, the platform
  database, and every other tenant database.
- `TenantRepository.createTenantWithOwnerGrant` writes the tenant row and the
  owner grant as one unit, against a tenant database that does not yet exist or
  is not yet migrated.
- Background claims carry no tenant filter at all.
  `EmailOutboxRepository.claimBatch` and `KsefSubmissionJobRepository.claimDue`
  claim due work globally in one ordered transaction. Per-tenant databases turn
  one claim into a fan-out with no global ordering and no shared lease.

No distributed transaction is acceptable as the answer. Each class must be
redesigned as a saga with idempotent, replayable compensation before any of
this is scheduled, and the erasure saga runs against a statutory deadline. The
`neon-http` precedent holds unchanged: a topology that cannot give an
interactive transaction is refused at boot, not worked around per call site.

### Migrations per tenant database

One linear journal today, applied once. Under this direction the same journal
is applied against many databases the platform neither owns nor can schedule.
Skew therefore becomes normal rather than exceptional:

- The server reads each tenant database's journal state and refuses to serve a
  tenant whose schema is behind or ahead of the running build.
- Migrations stay backward-compatible across at least one release, expanding
  before contracting. The existing `migration-lint` ban on transaction control
  and concurrent index creation already assumes an externally driven runner.
- A per-tenant runner with per-tenant reporting replaces the single
  `migrate.ts` invocation, and a tenant whose migration fails degrades only
  that tenant.
- An external database is admitted only after a capability probe, never on a
  successful connection alone. The schema depends on `tsvector` full-text
  search and timezone-aware timestamps.

### Backup, restore, and erasure guarantees

Ownership inverts, and the contract must say so instead of leaving it implied.
The platform cannot promise point-in-time recovery, retention, or verified
restore for a database it does not host. Those become the tenant's duty.

Processor obligations do not move with the data. The retention windows in
[member erasure](../member-erasure.md) and the fiscal retention rule must stay
enforceable through the tenant database, or the fiscal tables stay
platform-side. Enabling an external database requires a verified precondition,
reachability, schema version, and capability probe, rechecked on a schedule
rather than only at connection time.

## Consequences

Sales gains a claim that is verifiable rather than rhetorical: the tenant's
course and member data sit in a database the tenant owns, exportable and
survivable independently of Together, completing the storage and payments story
with the last piece a creator can be locked into.

The cost is that every operation which is one transaction over one database
today becomes tenant-local, platform-local, or a saga, and the support surface
grows a class of failure the platform cannot inspect directly.

This ADR fixes the split between platform identity and tenant product data,
names `createDeps` as the routing seam and `tenant_secrets` as the credential
store, and records the three atomicity classes as the gate. It schedules
nothing. Revisit after the first production deploys.
