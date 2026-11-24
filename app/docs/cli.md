# CLI

Run commands from `app` with `pnpm --silent run cli`. Use `--help` at any command
level to list its options.

## Connection and authentication

API origin selection resolves `--api-url`, then `TOGETHER_CLI_API_URL`, the
repository-local default (`http://localhost:48730`), and the stored current origin.
Sessions and selected tenants are stored separately for each canonical API origin.
Tenant selection resolves `--tenant`, then `TOGETHER_CLI_TENANT`, and the selected
profile. Staff commands use the profile's bearer session; `m2m enroll` has its own
`--api-key` option for API-key authentication.

```bash
pnpm --silent run cli login --email creator@together.dev --password demo-password-15
pnpm --silent run cli tenant switch studio
pnpm --silent run cli --tenant studio course list
pnpm --silent run cli --tenant studio module list
pnpm --silent run cli --tenant studio lesson list
```

`--json` emits exactly one JSON envelope on stdout: `{ "ok": true, "data": ... }`
or `{ "ok": false, "error": ... }`. Errors use the shared taxonomy and exit-code
mapping, including validation = 2, unauthorized = 3, forbidden = 4, not found = 5,
conflict = 6, and internal = 10. Human output goes to stdout; errors go to stderr.

## Lesson previews

`lesson update` accepts a JSON payload containing the lesson ID through `--data`
or `--json-file`. `--preview` and `--no-preview` override the payload's `isPreview`.
Omitting both flags preserves the payload's value; omitting the field as well
leaves the stored preview setting unchanged.

```bash
pnpm --silent run cli --tenant studio lesson update --data '{"id":"lesson-id"}' --preview
pnpm --silent run cli --tenant studio lesson update --json-file lesson.json --no-preview
```

Replace a course's preview selection with exactly one of these selectors:

| Selector | Result |
| --- | --- |
| `--lessons <id,id,...>` | Enable the listed lessons and disable all other lessons in the course. IDs are trimmed and deduplicated; empty IDs and IDs outside the course are rejected before writing. |
| `--first-per-module` | Enable the first lesson in chapter/content order in each nonempty attached module; disable the rest. Empty chapters are skipped. |
| `--all` | Enable every lesson in the course. |
| `--none` | Disable every lesson in the course. |

```bash
pnpm --silent run cli --tenant studio lesson preview set --course course-id --first-per-module --dry-run
pnpm --silent run cli --tenant studio lesson preview set --course course-id --first-per-module
pnpm --silent run cli --tenant studio --json lesson preview set --course course-id --lessons lesson-one,lesson-two
pnpm --silent run cli --tenant studio lesson preview set --course course-id --all
pnpm --silent run cli --tenant studio lesson preview set --course course-id --none
```

The command reads staff course, module, and lesson data through `core/client`.
The human table shows each module and lesson with IDs and `current -> new`
preview values before writes begin. Modules follow the course's module order,
then creation time and ID for attached modules without an explicit rank.
`--dry-run` prints the plan and makes no updates.

JSON success data contains `courseId`, `dryRun`, `lessons` (table rows with
`moduleId`, `module`, `lessonId`, `lesson`, `currentIsPreview`, and `isPreview`),
`changedLessonCount` (unique lessons), and `updatedLessonIds`. Repeating a
successful command makes no writes when the selection already matches.

Preview state belongs to the lesson. Shared lessons change in every course that
uses them; a lesson selected as first in any module stays enabled everywhere.
Each changed lesson is updated once, even when it appears in multiple modules.
Updates are sequential and are not transactional across lessons. On an API
update error, processing stops and the error reports `failedLessonId` and
`updatedLessonIds` in its details. Earlier updates remain applied; rerunning
computes a fresh plan and only applies remaining differences.

## Checkout and simulated purchases

`checkout session` starts the same anonymous checkout as the storefront and
prints the hosted checkout URL; `simulate-purchase` calls the dev purchase
endpoint for the selected tenant. A workspace with a terms or privacy URL
refuses either request until the buyer accepts the terms: pass
`--accept-terms` to send `termsAccepted: true`. Without the flag the request
carries no terms field.

```bash
pnpm --silent run cli --tenant studio checkout session --product product-id \
  --email buyer@example.test --shipping-rate courier --accept-terms
pnpm --silent run cli --tenant studio simulate-purchase --product product-id \
  --email buyer@example.test --accept-terms
```

## Staff refunds

`order refund-preview <orderId>` prints the paid amount, the amount refunded
as far as the platform sees it and the remainder that can still be refunded,
whether they were read from Stripe, the stock a full refund can return and the
packing, shipment, invoice and subscription consequences; for an order marked
refunded whose observed refunds do not cover the payment (refunded outside the
platform or disputed) it prints "not known here" instead of the refunded
amount, and for an order with access or a running subscription it says that a
partial refund may still end them once the payment ends fully refunded. An
order marked refunded cannot be refunded here. `order refund <orderId>`
refunds the whole remainder; `--amount <decimal>` refunds part of it in the
order's currency (whole numbers for zero-decimal currencies) and always keeps
stock and the packing list as they are. Every confirmed refund, partial and
full, needs `--remainder <decimal>`, the remainder you confirm: without it, or
without `--yes`, the command refuses, prints the preview and the exact command
to confirm with, and never confirms a remainder it just read. The amount it
warns about and the remainder in that command both come from the remainder it
just read; when a given `--remainder` differs from it, the refusal starts with
"The remainder changed from X to Y". The request
carries that remainder, and when it changed in the meantime the server refuses
with `conflict` naming the current remainder and nothing is refunded; the
command then reads the preview again and prints it (with `--json`, under
`error.details.preview`). It also carries the packing-list and label state of
the preview the command read, and the server refuses with `conflict` when a
label was bought or the order was packed since. `--reason <text>`
keeps a staff-only note, `--no-restock` turns off the stock return of a full
refund, and `--keep-on-packing-list` keeps the order on the packing list; it
needs `--no-restock`, because returned goods cannot stay on the list.
`--request-key <key>` makes a retry safe: the same key never refunds twice.
With `--json` the command requires `--request-key` and refuses before any
request without it, so automation keeps the key before it sends a refund.
Without `--json` and without a key the CLI generates one and prints it on
stderr before it sends the request; after a network error or a lost answer,
re-run the command with `--request-key <key>` and it returns the refund the
first run created instead of a second one. The refund cannot be undone, so the
command refuses without `--yes`. `order ship-anyway <orderId>` puts a refunded
order that was taken off the packing list back on it. Each command prints one
envelope with `--json`; exit codes follow `EXIT_CODE_BY_ERROR_CODE`. The rules
are in [the shop guide](shop.md#staff-refunds).

```bash
pnpm --silent run cli --tenant acme order refund-preview order-id
pnpm --silent run cli --tenant acme order refund order-id --amount 12.50 --remainder 40.99 --reason 'Damaged cover' --yes
pnpm --silent run cli --tenant acme --json order refund order-id --remainder 40.99 --request-key refund-2026-11-23-1 --yes
```

## CLI parity inventory

Run `pnpm run cli-parity` to list every method in the `core/client` API client
method table and whether CLI code calls it, followed by missing methods grouped
by API area. The report exits 0 when gaps exist. See the current count and
inventory scope in [Architecture](architecture.md#cli-first-verification).

## Activity reports

Create a read-only key with your owner session:

```bash
pnpm --silent run cli --tenant studio api-keys create Reporting --scope report:read
```

`api-key` / `--scope` remain supported aliases. Report keys cannot include write
scopes. Expiry is optional with `--expires-at <ISO>`; revoke with
`api-keys revoke <id>`. Studio integrations also supports report keys.

`api-keys shop-management create <name> --scope <shop:*...> --expires-at <ISO> [--mode direct|propose]`
creates a [shop management key](shop-management-keys.md); it requires `shop:*`
scopes and an expiry at most 30 days ahead. `--mode propose` creates a key whose
writes become [change proposals](change-proposals.md) instead of live changes;
each write scope of such a key needs its read scope (`shop:catalog:write` with
`shop:catalog:read`, `shop:settings:write` with `shop:settings:read`); `direct`
is the default. `api-keys shop-management list` (the mode is its last column) and
`api-keys shop-management revoke <id>` list and revoke them; `api-keys list`,
`create` and `revoke` handle only the other keys.
`api-keys shop-management purge --yes` deletes every shop management key of the
workspace, revoked or not, and prints the count; it refuses without `--yes`.
`api-keys shop-management events [--key <id>] [--cursor <event-id>] [--limit <n>]`
lists the workspace's shop management key history (creation, revocation, purge
and keyed mutating requests handed to a shop route handler), newest first.
The `shop products|prices|stock|orders|settings|branding|cover|sales-links|integrations|proposals` commands use such a key from the environment
variable named by `--api-key-env` (default `TOGETHER_SHOP_KEY`) and never send
the stored session; see the guide for the full command list. With a
propose-mode key the catalogue, `shop settings set` and
`shop sales-links create|update|delete` commands print the proposal receipt and
exit `0` when the server answers `202`, and `shop proposals list|show|withdraw`
reach that key's own proposals; the receipt of an applied proposal shows the
resource it created or changed, to name in a follow-up proposal.
`proposals list [--status <status>] [--group <id>] [--cursor <id>] [--limit <n>]`,
`proposals show <id>`, `proposals approve <id>` and
`proposals reject <id> [--note <text>]` let the owner,
in their own session, read every change proposal of the workspace with its
before/after effect, approve it or reject it. `proposals approve` prints the
outcome first: `applied` exits `0` and names the resource by the operation
(`applied: price <id>` for a new price, `applied: sales link <id>`,
`applied: settings`); `stale` (the live state changed since the
proposal was made) and `failed` (the live use-case refused the stored change,
with its error code and message) apply nothing and exit `6`, the conflict exit
code, as does approving a proposal that is no longer pending.
Proposals that depend on each other go into a
[group](change-proposals.md#groups) the owner decides as one unit. The key runs
`shop proposals group create --title <title>`, then any proposing command with
`--group <id>`, and reads or withdraws the group with
`shop proposals group show|withdraw <id>`. An id argument or JSON field of a
later item names what an earlier item of the same group creates as
`$proposal:<proposal id>` (the receipt prints that form only for an item that
creates something: a product, a price or a sales link), quoted so the shell
leaves the `$` alone, for
example `shop prices add --product '$proposal:<id>' --kind one_time --price 49 --group <group id>`.
The owner runs `proposals group show <id>` (the items in order with their
effects, the items digest and the exact approve command; `itemsDigest` and
`approveCommand` with `--json`),
`proposals group approve <id> --items-digest <digest>` (the digest that `show`
printed is required; the command reads the group again and, when its items
changed since, prints the current items with their new digest and exits `6`
without sending anything; otherwise it approves exactly those items: `0` when
every item was applied, `6` when the group ends `stale` or `failed`, as for a
single approval) and
`proposals group reject <id> [--note <text>]`; `proposals list --group <id>`
lists one group and `proposals list` shows the group and position of each
grouped item. A grouped item cannot be approved, rejected or withdrawn alone.

Supply the secret through an environment variable, using the same
`--api-key-env <name>` mechanism as marketing commands. Reports default to
`TOGETHER_API_KEY`. The selected tenant and API origin follow the usual CLI
configuration. A stored bearer session does not grant report access.

```bash
pnpm --silent run cli --tenant studio reports activity-summary \
  --from 2026-08-01T00:00:00Z --to 2026-09-01T00:00:00Z --json
pnpm --silent run cli --tenant studio reports member-activity \
  --from 2026-08-01T00:00:00Z --to 2026-09-01T00:00:00Z \
  --pivot 2026-08-15T00:00:00Z --exclude '%@example.test' --exclude 'test_%' --csv
```

Member activity automatically follows all pages. `--json` produces one standard
envelope; `--csv` writes a header and quoted CSV fields with CRLF row separators,
escaping embedded quotes and preserving commas and newlines. These output flags
are mutually exclusive. Null values become empty CSV fields. Formula-looking
string cells are neutralised with a leading apostrophe, like the member export;
numeric values are unchanged. Errors retain the normal CLI taxonomy and produce
no partial CSV.
See [report definitions and limitations](reports-api.md).

## Organizations

An organization sits above workspaces. Only the instance operator creates one,
for an existing account with a verified e-mail address, and sets how many
workspaces it may hold. Both commands read the secret from `OPERATOR_SECRET`:

```bash
OPERATOR_SECRET=... pnpm --silent run cli --json operator org create \
  --slug holding --name 'Holding' --owner-email owner@example.test --max-workspaces 3
OPERATOR_SECRET=... pnpm --silent run cli --json operator org limits <organization-id> --max-workspaces 5
```

Creation is idempotent by slug for the same owner (`created: false` on replay);
the same slug for another owner is a `conflict`. An unknown and an unverified
owner produce the same validation error.

An organization holds at most `max_workspaces` workspaces, whether they are
linked now or created in it later. The limit defaults to 0 until the operator
raises it with `operator org limits`. Linking a workspace that would exceed it
is refused with `workspace_quota_exceeded` (HTTP 409, CLI exit 31) and changes
nothing; linking a workspace that is already in the organization does not count
it twice.

Members read their organizations with their usual session. `--org` accepts the
organization ID or slug and falls back to `TOGETHER_CLI_ORG`:

```bash
pnpm --silent run cli org list
pnpm --silent run cli org show --org holding
pnpm --silent run cli org member list --org holding
pnpm --silent run cli org audit --org holding --limit 50
```

Organization owners and admins can read; an organization that the caller does
not belong to answers `not_found`, whether or not it exists.

Organization owners manage members. Only an existing account with a verified
e-mail address can be added; no invitation is sent, so create the account
first. Members are named by e-mail address and hold the role `owner` or
`admin`:

```bash
pnpm --silent run cli org member add admin@example.test --role admin --org holding
pnpm --silent run cli org member role admin@example.test --role owner --org holding
pnpm --silent run cli org member remove admin@example.test --org holding
```

Adding a member who already holds the requested role, or setting the role a
member already has, reports `changed: false`; adding a member with another role
is a `conflict` (change the role instead). An unknown and an unverified account
produce the same validation error. The last owner can be neither demoted nor
removed (`conflict`), including by themselves. An organization admin is
`forbidden`. A removed member loses organization access on the next request.
Each change is recorded in the organization audit as `member.added`,
`member.role_changed` or `member.removed`.

Members also hold a role in every workspace linked to the organization, without
a workspace grant: an organization `owner` acts as a workspace `owner` and an
organization `admin` as a workspace `admin`. A member who also holds a direct
grant in the workspace gets the higher of the two roles; on a tie the direct
grant counts. The role is read on every request, so removing a member, changing
their role, unlinking the workspace or suspending the organization takes effect
on the next request. A suspended organization gives no workspace role; its own
routes keep their reads and refuse every write with `forbidden`, while the
`operator org` commands and `tenant organization unlink` keep working. No
command changes an organization's status.

Adding a member needs no invitation because a member reaches only the
workspaces that were linked with a direct owner's consent (below), and any
direct owner of such a workspace can take it out of the organization again.

An owner whose workspace role comes from the organization can use the
workspace like a direct owner, with three exceptions that need a direct owner
grant in the workspace: `api-key create` (tenant API keys), `team add` and
`team remove`, and `tenant organization unlink`; each is `forbidden` otherwise.
Shop management keys stay open to such an owner because every request with the
key checks the issuer's role again. `team list` shows the direct team and, for a
workspace of an active organization, a read-only `organization` section with
each member's derived role and `source: "organization"`. `team remove` for a
user whose only access comes from the organization answers
`organization_managed` (HTTP 409, CLI exit 32): change it with
`org member role` or `org member remove` instead. Staff notifications go to the
direct team only.

An organization owner links a workspace in which they also hold a direct owner
grant. The workspace is named by its slug and resolved from the caller's staff
workspaces:

```bash
pnpm --silent run cli org workspace list --org holding
pnpm --silent run cli org workspace link acme --org holding
pnpm --silent run cli org workspace unlink acme --org holding
```

Linking gives every current and future owner of the organization owner-level
access to the workspace, and every current and future organization admin
admin-level access, for as long as the workspace stays linked. Organization
owners add and promote members without asking the workspace, so link only a
workspace whose access you want the organization's owners to control.

Linking changes nothing in the workspace's settings, secrets, payments or
checkout. Linking a workspace that is already in the organization reports
`changed: false`. A workspace that belongs to another organization is a
`conflict`; an organization admin, or an owner who is only a workspace admin, is
`forbidden` to link. Both changes are recorded in the organization audit and in
the workspace audit.

Unlinking needs either side. Any organization owner can unlink a linked
workspace with `org workspace unlink`, without a grant in it; to an owner
without a direct owner grant, a workspace outside the organization is
`not_found`. A direct owner of the
workspace can take the active workspace out of its organization, whether or not
they belong to the organization:

```bash
pnpm --silent run cli tenant organization unlink
```

An owner whose role comes only from the organization is `forbidden` there.
Unlinking ends every organization-derived role in the workspace on the next
request; derived staff cannot be removed one by one (`organization_managed`).

Unlinking is a `conflict` on both routes while the workspace takes any
configuration group from the organization. `org workspace sources` lists the six groups of a linked
workspace (`payments_live`, `payments_test`, `invoicing`, `email_transport`,
`telemetry`, `shipping_carrier`) and whether each comes from the `workspace`
(the default) or the `organization`; owners and admins can read it:

```bash
pnpm --silent run cli org workspace sources acme --org holding
```

Organization owners keep the company identity and the settings that inheriting
workspaces will use. An empty `--legal-name` or `--legal-address`, and
`--invoicing-provider none` or `--shipx-sender none`, clear the value; an update
that changes nothing reports `changed: false`. Each change is recorded as
`organization.updated` with the names of the changed fields only:

```bash
pnpm --silent run cli org update --org holding --legal-name "Holding Ltd" \
  --legal-address "1 Main Street, Warsaw" --invoicing-provider ksef --ksef-submission-mode manual
pnpm --silent run cli org update --org holding --shipx-environment production \
  --shipx-sender '{"name":"Warehouse","email":"warehouse@example.test","phone":"500600700","street":"Main","buildingNumber":"1","city":"Warsaw","postCode":"00-001"}'
```

Organization secrets are encrypted like workspace secrets. Owners and admins
list them with masked previews only; owners set and delete them. A value is
read from the environment variable named by `--value-env` or, without it, from
stdin, and never from a command-line argument:

```bash
pnpm --silent run cli org secret list --org holding
pnpm --silent run cli org secret set ifirma.invoiceApiKey --value-env IFIRMA_INVOICE_KEY --org holding
pnpm --silent run cli org secret set smtp.password --org holding < smtp-password.txt
pnpm --silent run cli org secret delete smtp.password --org holding
```

The generic setter accepts the iFirma, KSeF, SES, SMTP, Resend and ShipX keys.
The Stripe keys and the telemetry connection are stored only through their
dedicated flows, and webhook secrets, endpoint ids, storage, video and Meta
conversions credentials stay per workspace, so these are `validation` errors.
Deleting a secret is a `conflict` while a workspace of the organization takes
that key's group from the organization. Each change is recorded as `secret.set`
or `secret.deleted` with the key name and its configuration group, never any
character of the value. A masked preview shows the last four characters only
for a value of at least twelve characters; a shorter value shows only the mask.
