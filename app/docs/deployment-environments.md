# Deployment environments

Together serves the static web app and Hono API on Vercel. Runtime adapters
require interactive transactions, so every environment uses
`DB_DRIVER=node-postgres`; see [Data atomicity](data-atomicity.md).

## Branches and databases

| Environment | Source | Vercel deployment | Database |
|---|---|---|---|
| Development | local worktree | local Node entry | local Docker Postgres |
| Preview | pull request to `staging` | automatic Preview | disposable Neon preview branch |
| Staging | `staging` | stable Preview alias | automatic integration-managed Neon staging branch |
| Production | `main` | Vercel Production Branch | Neon production branch |


`main` is the default and production branch. Feature pull requests merge into
`staging`; production promotion is an owner-approved pull request from `staging`
to `main`. Follow the [production promotion runbook](promotion.md). Preserve
merge commits and their GitHub-generated subjects: the [version
derivation](versioning.md) counts those events.

Set Vercel Production Branch Tracking to `main`. Merges to `staging` create
Preview deployments only, using the integration-managed Neon staging branch.
The legacy `production` branch is not a deployment target. Environment data and
credentials remain isolated.

Repository configuration describes the required topology but does not prove
that live branch protection, hosting accounts, or databases match it. Verify
those boundaries and record deployment SHA attestation using the
[go-live checklist](go-live-checklist.md#16-production-branch-and-approval-wall)
and [deployment controls](deployment-risk-classes.md#together-controls).

## Runtime and build configuration

The Vercel project root is `app`. `api/index.ts` delegates to
`apps/server/src/entry.vercel.ts`, while local and smoke processes keep using
`entry.node.ts`. `NODEJS_HELPERS=0` is mandatory because the Hono node-style
handler owns request-body consumption. Vercel provisions this as a project-level
environment setting through the dashboard or CLI; its per-function
`vercel.json` schema cannot express environment variables. The platform entry
maps `VERCEL_GIT_COMMIT_SHA` to the neutral `APP_COMMIT_SHA` used by health
attestation. Auth e-mail delivery for members is registered with the platform's
`waitUntil` and drained before the function returns.

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

The `product_download_assets_default_lineage` insert trigger is the expand step for the
NOT NULL `lineage_id` column, so a release that omits it keeps inserting; the contract
step is to drop the trigger once no running release omits `lineage_id`.

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
itself does not need it. `db:migrate` logs
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
`api/platform-reset.ts`, whose exported `maxDuration` of 300 s covers the
reseed without raising the 30 s ceiling of the shared `api/index.ts` function.
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

## Migration journal

`db:migrate` (`adapters/db/migrate.ts`) applies the files in `app/drizzle`
with the application's own runner, `adapters/db/migration-runner.ts`. It parses
them with drizzle-orm's `readMigrationFiles`, so each migration's hash and
timestamp are the values drizzle-orm's migrator recorded, and it keeps the same
pending rule: a migration runs when its journal timestamp is later than the
newest `created_at` in the journal. The journal is `public.__drizzle_migrations`
with drizzle-orm's columns (`id`, `hash`, `created_at`). The runner never
creates a schema, so a role that owns schema `public` without `CREATE` on the
database can migrate.

A run is one `READ COMMITTED` transaction, whatever
`default_transaction_isolation` the database or role sets. It takes a
transaction-scoped advisory lock and reads the journal only after the lock is
granted; at that isolation level every statement sees what was committed before
it started, so a runner that waited for the lock sees everything the previous
run committed. It applies every pending migration before it commits, so a
failed migration leaves the database and its journal as they were. The lock
works through a transaction-mode connection pooler, because it never outlives
the transaction. A second runner waits up to five minutes for the lock and
then fails with `Another migration run held the migration lock for more than
300000 ms; nothing was applied.` A `statement_timeout` set on the database or
the role does not shorten that wait; it still applies to the migrations
themselves. The previous release's migrator does not take this lock; what
keeps it from applying a migration next to this runner is the
[journal fence](#journal-fence).

Migration `0105_record_skipped_0080` names `drizzle.__drizzle_migrations`. The
runner executes that one migration, identified by its tag, against
`public.__drizzle_migrations`; the file itself is unchanged, so the hash
recorded for it is the same in every database. Every other migration runs
exactly as written, so a later migration that cleans up or drops the old table
acts on the old table.

The runner refuses to start in four cases, each with nothing applied. `db:migrate`
prints the refusal as one line on stderr, without a stack trace, and exits 1;
any other failure, such as a migration statement that fails, is reported with
its stack trace.

| Message begins with | Cause | Recovery |
|---|---|---|
| `Another migration run held the migration lock` | Another runner held the lock longer than the wait. | Let the other run finish, then run again. |
| `drizzle.__drizzle_migrations belongs to <owner>, not to <role>` | The old journal is owned by a role the migration role is not a member of, so the runner cannot fence it. | [Journal fence](#journal-fence). |
| `drizzle.__drizzle_migrations holds <n> row(s) that public.__drizzle_migrations lacks` | An earlier release's migrator wrote the old journal while it had no fence. | [Diverged journals](#diverged-journals). |
| `The database has <n> application table(s) but no migration journal` | The database was restored or copied without its journal. | See the last paragraph of [upgrade from the drizzle schema](#upgrade-from-the-drizzle-schema). |

### Upgrade from the drizzle schema

Earlier releases kept the journal in `drizzle.__drizzle_migrations`. On such a
database the first run fences the old table (see [journal fence](#journal-fence)),
creates `public.__drizzle_migrations` and copies every row with its `id`,
`hash` and `created_at`, in `id` order, before it applies anything, in the same
transaction as the migrations. The operator sees `Migration journal moved to
public.__drizzle_migrations (<n> row(s) copied from
drizzle.__drizzle_migrations)` and then `Migrations applied (<n> new)`; later
runs print only the second line. A run that dies part-way leaves the database
as it was and the next run copies again. The `drizzle` schema stays in place;
later runs only fence its journal when the fence is missing and compare it with
the public one, and dropping it is a separate decision that a later migration can make as written.

When both tables exist, `public.__drizzle_migrations` is authoritative. The
public table only appears in the same commit as the complete copy and the
[journal fence](#journal-fence), and every later run of this runner records
migrations there alone, so the old table can only fall behind. A hotfix that
adds a migration is therefore cut from this release or a later one, never from
an older one: an older release's migrator can no longer record a migration.
Before it applies anything, the runner checks that the old table holds no row
newer than the newest public row and no hash the public table lacks; otherwise
it refuses, as described under [diverged journals](#diverged-journals).

When the database has application tables in `public` but neither journal — a
database restored or copied without its journal — or an empty public journal,
the runner refuses with `The database has <n> application table(s) but no
migration journal, so migration 0000 would run against existing tables.` and
changes nothing. Recover by restoring the database together with its journal,
or start again from an empty database. The `vercel-build` pre-check refuses the
same case earlier with a pointer to [staging](staging.md#troubleshooting).

### Journal fence

An earlier release's migrator takes no lock and records migrations only in
`drizzle.__drizzle_migrations`; started next to this runner, for example by a
hosted-platform build of an older branch, it could apply the same migration a
second time. Every run that finds the old table therefore makes sure it carries
the check constraint `migration_journal_moved_to_public`, in the same
transaction as the copy:

```sql
ALTER TABLE drizzle.__drizzle_migrations
  ADD CONSTRAINT migration_journal_moved_to_public CHECK (false) NOT VALID;
```

`NOT VALID` keeps the rows already there; every row inserted afterwards
violates the constraint. The earlier migrator applies all its pending
migrations and their journal rows in one transaction, so its first journal
insert fails and rolls back everything it applied in that run. On a database
moved before the constraint existed, the next run adds it. Deleting rows from
the old table still works, so the reconciliation below and a later migration
that cleans the old table up are unaffected.

What the operator of an earlier release sees after the move:

- With nothing pending (its newest migration is already in the old journal),
  its migrator succeeds and applies nothing, as before.
- With a migration pending, its migrator fails and nothing it ran is kept. The
  error is either the failure of a migration statement whose effect is already
  in the database (for example `relation "…" already exists` or `column "…" of
  relation "…" already exists`) or, when the statements succeed, `new row for
  relation "__drizzle_migrations" violates check constraint
  "migration_journal_moved_to_public"`. On the hosted platform this fails the
  build of that deployment. Cut the change from this release or a later one
  instead.

Adding the constraint needs ownership of the old table: the migration role
must own it or be a member of the role that does, which holds when the same
role ran the earlier migrator. Otherwise the runner refuses with
`drizzle.__drizzle_migrations belongs to <owner>, not to <role>, so this run
cannot stop an earlier release's migrator from writing to it.` and changes
nothing. Run the migration Job once as the owner, or have the owner run the
statement above and run the Job again; with the constraint present the runner
needs only `USAGE` on schema `drizzle` and `SELECT` on the old table.

### Diverged journals

An earlier release's migrator that wrote the old journal while it had no fence,
for example a hotfix cut from an older commit or an older branch migrated
against a shared development database, recorded what it applied only in
`drizzle.__drizzle_migrations`. This runner would then see the same file as
pending and apply it a second time. It refuses instead; a refused run keeps
nothing, so the fence is added by the first run after the reconciliation:

```text
drizzle.__drizzle_migrations holds 1 row that public.__drizzle_migrations lacks, so an earlier release's migrator ran after the journal moved: id 155 (created_at 1790000000000, hash 1a2b3c4d5e6f, is migration 0154_example of this release). Nothing was applied, because this run could repeat those migrations. Reconcile the two journals as described in docs/deployment-environments.md#diverged-journals.
```

The message names up to ten rows by `id`, `created_at` and the first twelve
characters of the hash, and says for each whether its hash belongs to a
migration of the release being migrated. Reconcile as the migration role, with
the Job stopped:

1. A row that `is migration <tag> of this release` was applied from the same
   file. When every migration of this release that is older than that row is
   already in `public.__drizzle_migrations`, record it there and run the Job
   again:

   ```sql
   INSERT INTO public.__drizzle_migrations (hash, created_at)
   SELECT hash, created_at FROM drizzle.__drizzle_migrations WHERE id IN (<ids>);
   ```

   When an older migration of this release is still missing from the public
   journal, recording the row would make the runner skip it, because the
   pending rule compares timestamps; treat the row as in step 2 instead.
2. A row that `matches no migration of this release` records a change this
   release does not know. Either ship that migration file unchanged in the
   release and continue with step 1, or undo its changes by hand (or restore
   the backup taken before it ran), then delete the row:

   ```sql
   DELETE FROM drizzle.__drizzle_migrations WHERE id IN (<ids>);
   ```

Run the Job again after either step; it prints `Migrations applied (<n> new)`
once the journals agree.

### Rollback

The previous release reads and writes only `drizzle.__drizzle_migrations`,
which keeps the rows it held when this release moved the journal; its
readiness and health counts read the same table. Redeploying the previous
release is safe only when both of these hold:

- The old journal covers every migration the previous release ships: the
  previous release had migrated this database to its own last migration before
  this release moved the journal. Check it as the migration role; the result
  must be at least the `when` of the last entry in the previous release's
  `drizzle/meta/_journal.json`:

  ```sql
  SELECT created_at FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC LIMIT 1;
  ```

- The migration role has `CREATE` on the database, as on the current Neon
  databases. The previous release's migrator first issues
  `CREATE SCHEMA IF NOT EXISTS drizzle`, and PostgreSQL checks that privilege
  before it checks whether the schema exists, so without it the migrator fails
  on its first statement with `permission denied for database` even though the
  schema exists.

Then the previous release's migrator applies nothing, the
[journal fence](#journal-fence) is never reached, and its readiness reports
the database as current. Migrations this release applied after the move stay
in place, as with any forward-only rollback, and remain recorded only in the
public journal.

Every other database is fix-forward only; ship a fix from this release or a
later one instead of redeploying the previous release:

- A database this runner initialised from empty has no `drizzle` schema. The
  previous release's migrator, given `CREATE` on the database, creates the
  schema and an empty old journal, then fails on migration `0000` with
  `relation "…" already exists`; without `CREATE` it fails with `permission
  denied for database`. Its readiness answers `503` with `Database migrations
  are behind this release: 0 of <expected> applied`. The empty old journal it
  leaves behind gets the fence on the next run of this runner.
- An older backup restored and then upgraded by this runner keeps the older
  watermark in the old journal; the migrations this runner applied are recorded
  only in the public journal. The previous release's migrator sees them as
  pending and fails, either on a statement whose effect is already there (for
  example `column "…" of relation "…" already exists`) or on the fence, and
  keeps nothing. Its readiness answers `503` with `<applied> of <expected>
  applied`, counting the older watermark.
- A database moved with the [cutover dump](#cutover-dump) below has no
  `drizzle` schema, which puts it in the first case.

### Cutover dump

Take the dump for a move to another PostgreSQL only after this release has
migrated the source, so the journal is in `public`, and leave the old schema
out:

```bash
pg_dump --format=custom --no-owner --no-acl --exclude-schema=drizzle
```

Restore it as the role that owns schema `public`; the next migration run
applies nothing. A dump taken before the upgrade carries the journal only in
the `drizzle` schema, which a role without `CREATE` on the database cannot
restore, and leaving that schema out of such a dump produces a database the
runner refuses.

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

The database client rewrites `sslmode=require`, `sslmode=prefer` and
`sslmode=verify-ca` in `DATABASE_URL` to `sslmode=verify-full`, so a connection
string copied from a provider console still validates the server hostname. An
explicit `sslmode=disable` is left untouched for local development.

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
data. No workflow currently invokes it or turns its result into an automated
acceptance gate.

The staging smoke also requests a magic-link sign-in for the seeded tenant
member without reading or following the link, then polls an operator-secret-gated
internal projection for up to 90 seconds. The `auth-mail-serverless` check passes
only when the redacted platform auth send log created after that request settles
as `sent`, proving that the deployed serverless runtime completed its off-request
mail delivery work before returning. The projection needs the staging operator
secret: without it the check is skipped with the name of the repository secret to
create, and every other staging check still runs.

Before deployment, confirm `NODEJS_HELPERS=0` is set for every target Vercel
environment.
Project linkage, environment provisioning, and deployment require the
operator to authenticate with the hosting provider.
