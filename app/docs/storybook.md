# Storybook

Storybook is Together's isolated component workbench and design-review
catalogue. A story may merge only when the fast story-module test in
`pnpm run check` passes. CI also runs `pnpm run storybook:build` as a hard step
to catch builder and `.storybook` configuration drift.

## Supported scope

Stories are for layout primitives under `apps/web/src/components/layout`, the
four non-ready `PageState` branches in
`apps/web/src/components/layout/StatusView.tsx`, the seven-theme matrix in
`ThemeShowcase.stories.tsx`, presentational feature views backed by hand-written
fixtures, and page compositions backed by recorded seed fixtures. `PageState` also contains `ready`, which renders no
status view; loading, error, empty, and not-found are structurally unreachable
through the populated seeded-route loop. Page goldens capture only Shadcn,
the one maintained base theme; the Storybook toolbar still
carries all seven so the other six remain reachable as unmaintained BYO-theme
examples.

Stories do not verify routing, data fetching, authentication, tenant
resolution, content security policy, server-side route behavior, island
state, or coverage. The nonce policy in `apps/server/src/app.ts` is verified by
`pnpm run visual:app` and `pnpm run smoke`, never by stories. Island cores governed
by `tsconfig.islands.json` remain DOM-free and node-tested.
`vitest.config.ts` deliberately excludes `**/*.stories.tsx` from coverage.

## Bounded lint exception

The carve-out in `eslint.config.js` exists because stories are development-only
fixtures outside the layered runtime graph. For
`apps/web/src/stories/**/*.stories.tsx` and `apps/server/src/**/*.stories.tsx`, `boundaries/element-types`,
`boundaries/external`, `together/query-descriptors-only`,
`together/sx-layout-only`, and `no-restricted-globals` are disabled.
For `.storybook/**`, the `boundaries/*` rules are disabled. These are the only
repository locations where the layered graph is not enforced, and the exceptions
are bounded to story files and Storybook configuration. Fixture helpers remain
subject to the normal rules, with explicit edges for page composition and the
fixture client construction site.

## Dependency freeze

`addons: []` stays empty. Do not add a Storybook test runner, an accessibility
addon or another hosted comparison service. Accessibility already
belongs to the in-house browser checks in `pnpm run a11y`; Chromatic provides advisory review on promotion pull requests. Any Storybook dependency or addon requires an owner decision
and the licence review required by `CLAUDE.md`.

## Pixel ownership

Canonical page pixels belong to `tasks/visual-goldens/` and the deterministic
`pnpm run visual` workflow documented in the
[visual regression policy](visual-regression.md). Chromatic provides advisory snapshots for promotion pull requests.

Lost Pixel, its copied story baselines, and the replacement story-shot commands
are retired. Storybook has no separate committed PNG baseline. The
[page capture path](visual-regression.md#storybook) compares recorded page stories
with the application goldens. `pnpm run storybook:build` verifies that the catalogue
compiles; `pnpm run visual` builds and captures the catalogue without a database and
`pnpm run visual:update` remains the only baseline-authoring command.

## Merge gate

`apps/web/src/stories/stories.test.tsx` eagerly imports the web story modules and
checks its CSF exports during `pnpm run check`. CI then builds the complete
Storybook. Server HTML stories are compiled by TypeScript and the Storybook build.

## Recorded page fixtures

The page catalogue covers the seeded member area, anonymous home and course
pages, studio management pages, member details and email history, the mobile member menu, login, registration and password recovery, checkout, a missing
course, a locked lesson, and the creator boot splash. Each new page capture has a story ID matching its application golden
name without the `.png` suffix, with the same desktop, mobile, or 375-pixel viewport.
The original Start, LessonPlayer, SpaceFeed, and hosted legal document stories
retain their existing IDs.

The page workflow records the isolated seed database with the visual harness clock:
`pnpm run fixtures:record`. An optional output directory keeps
recordings outside the source tree. Each recording scenario declares its principal, route and page queries. Each scenario checks its declared domain error codes and rejects expectations for
unrecorded calls. Captures reject pending or expected-error calls that were never
exercised. Recorded
tracking and read-mark failures follow the same request policy as the application
harness. Authenticated passkey reads use the auth adapter; session IDs and times
are normalized to stable fixture values. Routing hosts use a stable fixture port; the capture masks ephemeral CORS fields,
matching the live authoring inventory. The pending and active DNS
checklist stories share the synthetic routing scenario with the live screen
inventory. The inherited active-named goldens contain the same cached pending
response as the pending goldens; the capture mapping reuses the pending story
and its loaded document. Recorded Pending variants expose that fixture alongside
separate Active variants rendering the verified response. The remaining settings
and session data come from the seed. Page stories keep
an `auto` theme preference; use browser color-scheme emulation for light captures or dark previews.

Run `pnpm run fixtures:check` after `pnpm run db:up` to re-record
into a temporary directory and fail on any byte or file-set drift. The default
baseline is `apps/web/src/stories/fixtures`; an optional baseline directory supports
drift-check diagnostics. Temporary recordings are removed on success and failure.
CI runs this drift check in the Postgres-backed e2e auth leg. The separate
macOS visual job builds and captures Storybook without a database.

Auth page stories render the production AuthShell. The default build reproduces
the committed goldens' unconfigured base-domain fallback. Run
`APP_BASE_DOMAIN=localhost pnpm run storybook` to inspect the tenant public
navigation and footer on `studio.localhost:9009`. Login's Method Cards story
renders the same sign-in choices for every email address. Tenant login stories
include short and long notices, English and Polish UI, light and dark schemes,
and desktop and mobile viewports.
Registration is available at both viewport sizes without a committed golden.

For serial full-gate verification, use `TOGETHER_TEST_SERIAL=1 pnpm run check`.

The splash records the creator and public offer from the seed, then declares
`me:[]` and its identity query key in the fixture's `pending` list. The fixture client holds that call
indefinitely; capture readiness waits for all queries outside the explicitly
held query keys and for all mutations to settle. A held call can serve multiple
queries or run outside the query cache. Timeout diagnostics include fetching query
keys and held calls. Page decorators use the production tenant-loading boundary
and baseline placement. Animation suppression belongs to the capture harness after
the page settles, matching the application harness; disabling it before mount
changes the course upload button’s initial border paint. The shared screen specification supplies the splash's 7 KiB minimum
PNG size and skips network-idle waiting. Password recovery stories synchronize
the fixture route's token and error parameters with the iframe URL because the
production auth pages read those values from the browser location.

## Server HTML pages

The server catalogue renders the production public-page functions in fullscreen
`iframe srcDoc` elements, without the web theme decorator. The capture path waits
for the nested document and its fonts before comparing the four inventory pages
at desktop and mobile sizes: hosted legal document, marketing preferences, and
confirmation success and expired states. All eight captures use the application
goldens and the shared comparator, with zero counted pixels required.

The recorder reads the brand, unsubscribe token, consent definitions, versions,
consent history and confirmation state from the isolated seed database. It also
checks that the new recorded inputs reproduce the live server HTML exactly.
The nonce remains the stable `storybook` fixture value: Hono generates a fresh
request nonce, but these pure renderers do not emit it into the document.
CSP behavior remains covered by `pnpm run visual:app`.

The preference-result stories cover scoped unsubscribe, global unsubscribe,
saved preferences and pending confirmation at both viewports. These synthetic
states reuse the recorded seed brand, token and scope label. They have no entries
in the application capture inventory and no committed goldens, so they are
catalogue coverage only.

Account page stories include the profile, security, notifications and playback tabs
using the production search validator. Page compositions provide the application
toast context for feedback from the current product components.
