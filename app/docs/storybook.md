# Storybook

Storybook is Together's isolated component workbench and design-review
catalogue. A story may merge only when the fast story-module test in
`pnpm run check` passes. CI also runs `pnpm run storybook:build` as a hard step
to catch builder and `.storybook` configuration drift.

## Supported scope

Stories are for layout primitives under `apps/web/src/components/layout`, the
four non-ready `PageState` branches in
`apps/web/src/components/layout/StatusView.tsx`, the seven-theme matrix in
`ThemeShowcase.stories.tsx`, and presentational feature views backed by
hand-written fixtures. `PageState` also contains `ready`, which renders no
status view; loading, error, empty, and not-found are structurally unreachable
through the populated seeded-route loop. Route goldens capture only Shadcn,
the one maintained base theme (see
[ADR-0010](decisions/0010-shadcn-base-theme.md)); the Storybook toolbar still
carries all seven so the other six remain reachable as unmaintained BYO-theme
examples.

Stories do not verify routing, data fetching, authentication, tenant
resolution, content security policy, server-rendered public pages, island
state, or coverage. The nonce policy in `apps/server/src/app.ts` is verified by
`pnpm run visual` and `pnpm run smoke`, never by stories. Island cores governed
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
addon, Chromatic, or another hosted comparison service. Accessibility already
belongs to the in-house browser checks in `pnpm run a11y`; hosted advisory pixels
belong to Argos. Any Storybook dependency or addon requires an owner decision
and the licence review required by `CLAUDE.md`.

## Pixel ownership

Canonical route pixels belong to `tasks/visual-goldens/` and the deterministic
`pnpm run visual` workflow documented in the
[visual regression policy](visual-regression.md). The hosted advisory track is
Argos.

Lost Pixel, its copied story baselines, and the replacement story-shot commands
are retired. Storybook has no separate committed PNG baseline. The experimental
[page capture path](visual-regression.md#storybook) compares recorded page stories
with the application goldens. `pnpm run storybook:build` verifies that the catalogue
compiles; `pnpm run visual` remains the runtime visual gate and
`pnpm run visual:update` remains the only baseline-authoring command.

## Merge gate

`apps/web/src/stories/stories.test.tsx` eagerly imports the web story modules and
checks its CSF exports during `pnpm run check`. CI then builds the complete
Storybook. Server HTML stories are compiled by TypeScript and the Storybook build.

## Recorded page fixtures

The experimental page workflow records the isolated seed database with the visual harness clock:
`pnpm exec tsx scripts/fixtures-record.ts`. An optional output directory keeps
recordings outside the source tree. Each recording scenario declares its principal, route and page queries. Recorded
tracking and read-mark failures follow the same request policy as the application
harness. Authenticated passkey reads use the auth adapter; session IDs and times
are normalized to stable fixture values. Page stories keep
an `auto` theme preference; use browser color-scheme emulation for light captures or dark previews.

Run `pnpm exec tsx scripts/fixtures-check.ts` after `pnpm run db:up` to re-record
into a temporary directory and fail on any byte or file-set drift. The default
baseline is `apps/web/src/stories/fixtures`; an optional baseline directory supports
drift-check diagnostics. Temporary recordings are removed on success and failure.
A future CI step would use the pinned Node/pnpm toolchain, start Postgres, and run
this command before the Storybook build. CI does not run this experimental capture path.

For serial full-gate verification, use `TOGETHER_TEST_SERIAL=1 pnpm run check`.
