# Marketing contacts, lists and imports

The tenant directory is independent of accounts. Importing contacts never creates
users, members, grants, verification messages or welcome messages. Campaigns support both legacy member audiences and explicit contact-list
audiences in Studio, as described below.

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

## Campaign list audiences

New Studio campaigns explicitly select a version 2 audience. Included lists are
unioned and deduplicated by contact; excluded lists and excluded product grants
win. An empty selection includes nobody. The optional member source includes
linked members with active campaign consent. Every selected contact still needs
that campaign's consent definition and must pass suppression checks. Product
exclusions use any current grant projection, including expired, free, manual and
imported grants; they are not a paid-purchase filter.

```json
{
  "version": 2,
  "includeLists": ["list-id"],
  "excludeLists": [],
  "excludeProductIds": [],
  "includeMembersWithConsent": false
}
```

`POST /api/marketing/audience-preview` accepts `consentDefinitionId` and this
`audience`. It returns the eligible `count`, candidate/excluded counts, a skipped
breakdown, and at most 20 eligible contacts in stable ID order. Preview requires
both campaign and contact read permissions. Counts remain estimates until
scheduling. Member/product selections first reconcile directory jobs within a
bounded budget; unfinished synchronization returns a conflict with a retry hint.

Scheduling persists immutable snapshot membership, addresses, names, consent
references, list revisions and counts in one transaction. Later list/tag changes
or new contacts cannot expand that snapshot. Initially ineligible candidates stay
skipped even after consent changes. Each candidate gets a contact-keyed send record;
eligible records receive durable payloads and unsubscribe tokens. A send and its
contact cursor advance commit together. Replayed enumeration does not duplicate
sends. Dispatch rechecks consent, suppression, contact archival and address identity.
Member erasure pseudonymizes snapshot personalization as well as the directory.

Scheduled version 2 campaigns must return to draft before content or audience
changes. Rescheduling creates a fresh snapshot and retains the prior snapshot.
Campaign details expose the frozen audience total and a grouped send projection
for waiting, sent, failed, skipped, delivered, bounced, complained and unresolved
delivery outcomes.
They also retain queued and unresolved provider-acceptance counters; uncertain
acceptance is excluded from waiting and is never retried automatically. Completion
waits for all snapshot candidates to be enumerated and for pending sends to resolve.

Existing requests without `audience` still create version 1 member campaigns.
Their inclusive product filter and member cursor retain their meaning. An old
client's content update cannot clear a version 2 audience. Studio offers an
explicit switch from a legacy draft to list selection.

```bash
pnpm --silent run cli campaign audience set --campaign campaign-id \
  --audience '{"version":2,"includeLists":["list-id"],"excludeLists":[],"excludeProductIds":[],"includeMembersWithConsent":false}'
pnpm --silent run cli campaign audience preview --campaign campaign-id
pnpm --silent run cli campaign draft campaign-id
pnpm --silent run cli campaign sends --contact contact-id
```

`campaign create --audience <json>` selects the same contract. The dedicated
setter uses `POST /api/marketing/campaigns/audience` and only accepts drafts.
The existing send journal accepts `contactId` on list and CSV-export queries;
Studio contact detail links each send to its delivery/event timeline.
