# Activity reports API

Both endpoints require `X-Api-Key` with the exclusive `report:read` scope and a
tenant selected by its host or `X-Tenant`. Browser sessions and legacy unscoped
keys do not grant access. Responses use the standard `{ "ok": true, "data": ... }`
envelope and `Cache-Control: no-store`. No database role or reporting connection
is needed. See [CLI usage](cli.md#activity-reports) and [security](security.md#tenant-api-keys).

## Activity summary

`GET /api/reports/activity-summary?from=<ISO>&to=<ISO>`

`data.days` contains ascending UTC dates with recorded activity. Dates without
activity are omitted. Each row has `day`, `sessions`, `distinctUsers`,
`progressUpdates`, `distinctProgressMembers`, and `lessonCompletions`.
`data.totals.membersTotal` counts current, non-deleted tenant members;
`membersActive` counts distinct members with a session or progress update in the
half-open interval `[from,to)`. Completion events alone do not make a member active.

## Member activity

`GET /api/reports/member-activity?from=<ISO>&to=<ISO>&pivot=<ISO>&excludeEmailPatterns=<patterns>&cursor=<memberId>&limit=100`

`data.members` includes current, non-deleted members with any session or progress
update in `[from,to)`, ordered by member ID. `nextCursor` is the last returned ID
when another page exists, otherwise `null`. Pass it unchanged as `cursor`; keep
all other filters unchanged. The default limit is 100 and the maximum is 500.
Pagination reflects live data, not a snapshot across requests.

Every row contains:

| Fields | Meaning |
|---|---|
| `memberId`, `displayName`, `email` | Tenant member identity; display name can be null |
| `sessionsBefore`, `sessionsAfter` | Sessions created before the pivot / at or after it, within the range |
| `firstSession`, `lastSession` | Earliest / latest session creation within the range; null without sessions |
| `progressBefore`, `progressAfter` | Retained course progress rows updated before / at or after the pivot, within the range |
| `coursesTouched` | Distinct courses with progress updated within the range |
| `lessonsCompletedTotal` | Total lesson-completion events within the range |
| `lastProgress` | Latest progress update within the range; null without progress |
| `completionsBefore`, `completionsAfter` | Lesson-completion events before / at or after the pivot, within the range |

`from`, `to`, and `pivot` accept ISO 8601 timestamps with `Z` or numeric UTC offsets.
`from` must precede `to`. A pivot outside the interval puts all observations on
one side. `excludeEmailPatterns` is a comma-separated list of PostgreSQL `ILIKE`
patterns: `%` matches any sequence and `_` one character. Matching is case
insensitive. Empty patterns are ignored; the encoded parameter is limited to
4096 decoded characters. URL-encode patterns. Filters use bound parameters.

## Data interpretation

Sessions come from the auth session table joined to current tenant members by
user ID. Auth sessions are global: a shared user's session is attributed to each
tenant where that user is a current member, irrespective of the login host.
Revoked or purged sessions disappear from these reports. Sessions measure retained
session creation, not page views, visits, or a complete login history.

Progress comes from `member_course_progress`, one current projection per member
and course. A later update replaces the earlier timestamp; `progressUpdates`
counts retained rows, not every learning interaction. Completions come exclusively
from `member_events` with type `lesson-completion`; repeated completion events are
counted individually. All activity metrics, including `lessonsCompletedTotal`,
are restricted to the requested interval. Banned members remain included;
soft-deleted members are excluded.

## Errors and limits

Missing, invalid, revoked, expired, or foreign-tenant keys return 401; active keys
without `report:read` return 403. Invalid query parameters return 400. Reports
share the existing API-key minute/day rate policy and PostgreSQL bucket storage
(`M2M_TRANSACTIONAL_EMAIL_RATE_PER_MINUTE` and
`M2M_TRANSACTIONAL_EMAIL_RATE_PER_DAY`); exhaustion returns 429 with `Retry-After`.
