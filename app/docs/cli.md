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

## CLI parity inventory

Run `pnpm run cli-parity` to list every method in the `core/client` API client
method table and whether CLI code calls it, followed by missing methods grouped
by API area. The report exits 0 when gaps exist. See the current count and
inventory scope in [Architecture](architecture.md#cli-first-verification).
