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
through the populated seeded-route loop. Route goldens currently capture three
of the seven themes.

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
For `.storybook/**` and `lostpixel.config.ts`, the `boundaries/*` rules are
disabled. This is the only repository location where the layered graph is not
enforced, and the exception is bounded to those directories and configuration
files.

## Dependency freeze

`addons: []` stays empty. Do not add a Storybook test runner, an accessibility
addon, Chromatic, or another hosted comparison service. Accessibility already
belongs to `pnpm run a11y` and `eslint-plugin-jsx-a11y`; hosted advisory pixels
belong to Argos. Any Storybook dependency or addon requires an owner decision
and the licence review required by `CLAUDE.md`.

## Pixel ownership

Canonical route pixels belong to `tasks/visual-goldens/` and the deterministic
`pnpm run visual` workflow documented in the
[visual regression policy](visual-regression.md). The hosted advisory track is
Argos.

`tasks/lost-pixel-baselines/` is an advisory, partial, macOS-authored local
snapshot. It is not a golden set or a merge signal and must never be added to a
gate or branch protection. Missing baselines are expected rather than defects;
`pnpm run visual:stories` reports unbaselined stories as additions.

The story-shot regime differs materially from the route goldens: it uses a
`0.01` threshold, four concurrent shots, one flakiness retry, a fixed
500-millisecond wait, no frozen clock, locale, timezone, or color scheme, no
image-size assertion, no platform guard, and the older Chromium bundled with
`lost-pixel`. Reviewers apply the determinism policy only to
`tasks/visual-goldens/`.

Now that Argos is live, the likely next owner decision is to remove
`lost-pixel`, `lostpixel.config.ts`, `tasks/lost-pixel-baselines/`, and the
`visual:stories*` scripts, eliminating roughly 31 lockfile entries and the
second Chromium. That decision is recorded here but is not executed in this
batch.

## Merge gate

`apps/web/src/stories/stories.test.tsx` eagerly imports every story module and
checks its CSF exports during `pnpm run check`. CI then builds the complete
Storybook. A story added without passing both checks cannot merge.
