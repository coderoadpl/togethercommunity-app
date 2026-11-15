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

`api-keys create --kind shop_management` creates a
[shop management key](shop-management-keys.md); it requires `shop:*` scopes and
`--expires-at` at most 30 days ahead. `api-keys list` prints each key's kind.
`api-keys purge-shop-management --yes` deletes every shop management key of the
workspace, revoked or not, and prints the count; it refuses without `--yes`.
`api-keys shop-events [--key <id>] [--cursor <event-id>] [--limit <n>]` lists
the workspace's shop management key history (creation, revocation, purge and
keyed mutating requests), newest first.
The `shop products|prices|stock|orders|settings|branding|cover|sales-links|integrations` commands use such a key from the environment
variable named by `--api-key-env` (default `TOGETHER_SHOP_KEY`) and never send
the stored session; see the guide for the full command list.

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
