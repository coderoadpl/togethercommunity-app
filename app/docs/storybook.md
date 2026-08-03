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
`apps/web/src/stories/**`, `boundaries/element-types`,
`boundaries/external`, `together/query-descriptors-only`,
`together/sx-layout-only`, and `no-restricted-globals` are disabled.
For `.storybook/**`, the `boundaries/*` rules are disabled. These are the only
repository locations where the layered graph is not enforced, and the exceptions
are bounded to the story and Storybook configuration directories.

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

`pnpm run visual:stories` builds `storybook-static/`, captures every story at
390 px and 1440 px through the repository's Playwright browser, and reuses the
route harness's zero-diff PNG comparator. Existing images in
`tasks/lost-pixel-baselines/` are compared with `pixelmatch` at threshold zero
and a zero mismatch budget. New stories without a baseline are reported as
additions, because this remains an advisory, partial track rather than a merge
signal.

`pnpm run visual:stories:update` authors only the separate story baseline
directory; it never writes `tasks/visual-goldens/`. Story authoring is guarded
to macOS, matching the preserved baseline renderer. Current images and diffs go
to `out/visual-stories/`. Lost Pixel itself and its configuration are retired;
the committed story baselines and command meanings are preserved by the thin
in-house comparator.

## Merge gate

`apps/web/src/stories/stories.test.tsx` eagerly imports every story module and
checks its CSF exports during `pnpm run check`. CI then builds the complete
Storybook. A story added without passing both checks cannot merge.
