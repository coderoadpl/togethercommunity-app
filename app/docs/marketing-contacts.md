# Marketing contacts, lists and imports

The tenant directory is independent of accounts. Importing contacts never creates
users, members, grants, verification messages or welcome messages. The existing
campaign workflow remains unchanged; contact audiences and Studio screens are
separate implementation units.

## CLI workflow

Import suppressions before contacts. Use the existing tenant selection and session
or supply `--api-key-env VARIABLE` for a marketing-scoped API key.

```sh
pnpm --silent run cli --tenant acme marketing suppressions import suppressions.csv \
  --attest --attestation-note 'Synthetic suppression export; evidence retained privately.'
pnpm --silent run cli --tenant acme marketing contacts import contacts.csv --dry-run
pnpm --silent run cli --tenant acme marketing contacts import contacts.csv \
  --consent-definition newsletter --attest \
  --attestation-note 'Newsletter export; permission evidence retained privately.'
pnpm --silent run cli --tenant acme marketing contacts list --list newsletter
pnpm --silent run cli --tenant acme marketing contacts export --out contacts.csv
```

Contacts-only imports omit the consent definition and still require an authorization
attestation. Consent imports accept active optional marketing definitions with
single opt-in. Double opt-in definitions require contacts-only import or the
existing explicit confirmation flow.

`--dry-run` stages and validates an expiring batch without changing directory or
consent records. `--no-wait` returns its durable identifier after commit. The default
wait polls progress; it does not run the worker. `--resume ID` verifies the original
file hash and resumes staging, commit, retry or progress. Resuming a committed batch
with `--dry-run` only reads its status, including after a worker failure. JSON mode prints one final
envelope; progress goes to stderr. A self-hosted deployment must invoke the worker
or use the staff `marketing imports process --input JSON` command.

`marketing contacts` also provides get, upsert, update, archive, restore and sync.
`marketing lists` provides create, list, get, update, archive, add, remove, preview
and contacts. `marketing imports` exposes create, append, validate, commit, get,
rows, retry, cancel, process, upload and preview. JSON operations use `--input JSON`.
Upload and remapping use session authentication. Worker operations require the
scheduler capability; marketing API keys cannot execute them.

## CSV and JSON contract

UTF-8 CSV requires a header and supports a BOM, comma or semicolon delimiters,
LF/CRLF, quoted multiline values and doubled quotes. Ambiguous delimiters require
`--delimiter comma` or `--delimiter semicolon`. Email-only files are accepted automatically when both
delimiters produce identical records. Mapping files contain header-to-field JSON,
such as `{"Email address":"email","Full name":"name"}`. Unknown columns are
reported and ignored; duplicate headers and mappings are rejected.

Contact fields are `email,name,firstName,lastName,tags,source,consentSource,consentAt,lists`.
Email is trimmed and lowercased before validation. Names remain separate; a missing
display name is derived from first and last name, never the reverse. Tags and lists
use pipes as separators; mapping reports that a pipe cannot be part of a token.
Backslash-escaped pipes and pipes inside quoted tokens are rejected during mapping.
CSV field quoting does not escape a pipe: `"one|two"` still means two tokens.
JSON uses arrays.
Historical timestamps require a timezone, are normalized to UTC, and cannot be in
the future.

Suppression fields are `email,reason,at`. Reasons are `unsubscribe`, `bounce`,
`complaint`, and `manual`; bounce means a terminal hard bounce. Legacy email-only
files require explicit `--default-reason` and `--default-at`, retained in batch and
suppression evidence. Complaint escalation remains permanent. No import lifts a
suppression or restores a withdrawal.
Repeated suppression addresses retain separate row receipts so a later weaker
signal cannot discard an earlier complaint or permanent bounce.

Limits: CSV 3 MiB, multipart 4 MiB, batch 10,000 rows, JSON chunk 200 rows and 1 MiB,
staged row 16 KiB, 50 tags of at most 64 characters, 50 lists per row, and an
attestation note of 20–2,000 characters.

## Identity, consent and replay

Within a tenant, normalized email identifies a contact, including archived contacts.
Re-import updates non-empty supplied scalar fields, unions tags and static list
memberships, and preserves archival. Repeated addresses within one batch use the
last non-empty scalar and merge tags and lists. Conflicting consent evidence blocks
commit, including with `skip_invalid`. Other invalid rows require correction or
explicit `skip_invalid` and finish with reconciled rejection counts.

Batch idempotency binds a tenant/key to canonical metadata, including an optional
file hash. Row receipts separately bind each row number to its content hash. A
changed occupied row or changed metadata at the same key conflicts. Business
uniqueness and effective-consent reuse protect imports with new batch identifiers.

Validation binds rows, mapping, defaults and the consent-definition snapshot to a
hash. Commit requires that hash and explicit attestation. The server records the
exact English attestation, version, note, actor and time. API-key attestations retain
the actual authenticated key ID. Historical consent evidence remains separate from
the import time; missing historical time uses the administrator attestation basis.

## Lists, workers and lifecycle

Static memberships are reversible projections with append-only events. Dynamic
lists evaluate one bounded rule: tag any/all, product grant active/ever, or active
consent for a definition. Grant matching requires a member link; grants are not
proof of payment. Counts distinguish contacts, suppressions and eligibility for a
selected consent definition. Keys and list kinds are immutable; edits carry an
expected revision. Contact pages use immutable ID ordering and filter-bound cursors.
Public directory responses and exports omit address HMACs. Spreadsheet-safe CSV
escaping is optional and separate from lossless machine export.

Session routes use `/api/marketing`; JSON API-key routes use `/api/m2m/marketing`.
CSV upload and remapping are session-only. `Idempotency-Key` may supply the batch
key on creation. Commit returns 202 after durable queueing. The authenticated
`GET /api/internal/marketing/imports/tick` uses `CRON_SECRET`, runs every minute on
hosted deployments, and shares a 20-second budget across imports and member sync.
Interrupted imports resume unfinished rows under fenced leases; each row's effects
and receipt commit together. Database failures propagate and the worker records
sanitized retry state.

Member inserts and email/deletion changes immediately link or unlink existing
contacts through a database trigger, which also schedules missing projections.
The application computes HMACs during synchronization. Existing members are queued
by the additive migration. Address advisory locks serialize import and linking.
Member erasure pseudonymizes contacts, removes identifying metadata and staged
payloads, cancels affected unfinished imports, and preserves the original suppression.

Uncommitted staging expires after 24 hours. Completed/cancelled payloads are purged
after 30 days; unresolved failed batches remain available. Attestations, hashes,
counts and receipts persist independently of payload retention. Tenant purge removes
all directory tables through their tenant references.

## Permissions

Owners and administrators have directory read/write, list read/write and import
write capabilities. Marketing-scoped API keys receive the same directory
capabilities. Enrollment, transactional and content/users import scopes do not.
Import operations additionally authorize contact/list/consent/suppression writes as
applicable; previews require the corresponding reads. List previews require both
list and contact read. See [permission table](permission-table.md).
