# Storybook + Lost Pixel (OSS) spike — verdict

> Spike for `tasks/ux-decisions.md` point 2 (owner leaning: **Lost Pixel OSS
> mode** for self-hosted, Chromatic-style visual regression; fallbacks Loki and
> storycap+reg-suit). Built end-to-end in a worktree on top of `poc-together`.
> Date: 2026-07-19.

> **Retired implementation (2026-08-03).** This is a historical spike record,
> not current operating guidance. Lost Pixel and `app/lostpixel.config.ts` were
> removed after the spike. `pnpm run visual:stories` now builds static Storybook
> and runs `app/scripts/visual-story-screenshots.ts`, which uses the repository's
> Playwright browser and shared zero-diff `pixelmatch` comparator against the
> preserved advisory baselines. `pnpm run visual:stories:update` updates only
> those story baselines. See `app/docs/storybook.md` for current policy.

## TL;DR

**Lost Pixel OSS holds up. Recommend adopting it** for the layout-primitive
component workshop and mobile+desktop visual regression. It is fast, flake-free
in this run, stores plain PNG baselines in-repo, and reuses the stack we already
have (playwright-core + pixelmatch). The one caveat is a pinned browser build
(see Gotchas). The full 7-theme matrix is affordable but should be opt-in per
story, not global.

## What was built

- **Storybook 10.5.2** (`@storybook/react-vite`, Vite 7 / React 19) under
  `app/.storybook/`:
  - Global decorator wraps every story in the real MUI `ThemeProvider`
    (`createThemeForMode`) + `CssBaseline` + the app `LanguageProvider`
    (PL default).
  - **Theme toolbar** switch across all 7 modes from `apps/web/src/theme.ts`
    (logbook, material, quiet-studio, scoreboard, shadcn, signal-mono,
    steady-frame); default `shadcn` (the app default).
  - Viewport presets: mobile 390×844, desktop 1440×900.
  - A decorator neutralises animations/transitions and hides the text caret so
    shots are deterministic (FocusCard's `settle` animation, MUI ripples, etc.).
- **29 stories** in `apps/web/src/components/../stories/` (mock data inline, no
  network):
  - 7 layout primitives — FocusCard, MemberPage (incl. bottom-tab-bar state),
    PanelPage, ListSection (with table data), SectionCard, StatusView (all 4
    states), ConfirmDialog (open state).
  - 2 composites — a checkout-like FocusCard flow, a panel list page.
  - A 7-story Theme showcase that forces each theme via per-story `globals`, so
    the 7-theme matrix is actually exercised, not just theorised.
- **Lost Pixel OSS** (`lostpixel.config.ts`) over the static Storybook build:
  - `storybookShots` against `storybook-static/`, breakpoints `[390, 1440]`.
  - Baselines committed under `app/tasks/lost-pixel-baselines/`; current/diff
    images land in the gitignored `app/out/lost-pixel/`.
  - pixelmatch engine, `threshold: 0.01`, `failOnDifference: true`,
    `flakynessRetries: 1`, telemetry disabled.
- **npm scripts**: `storybook`, `storybook:build`, `visual:stories`,
  `visual:stories:update`.

## Results (this machine, headless)

| Metric | Value |
| --- | --- |
| Stories | 29 |
| Shots (29 × mobile+desktop) | 58 |
| Storybook static build | ~3–4 s (Vite) |
| Baseline generation (`visual:stories:update`) | ~62 s |
| Compare run (`visual:stories`) | ~58 s, exit 0, 0 differences |
| Baseline footprint | 58 PNGs, ~1.6 MB (~28 KB/shot) |
| Concurrency | 4 shots in parallel (`shotConcurrency`) |

### Speed

Good. ~1 s/shot wall-clock end-to-end (browser nav + 500 ms settle + capture +
compare) at concurrency 4. The Storybook build is the cheap part. This scales
linearly with shot count, so cost is driven by how many story × breakpoint ×
theme combinations we opt into.

### Flake

Zero across the update→compare cycle here. The determinism decorator
(animations/transitions off, caret hidden) plus a fixed 500 ms
`waitBeforeScreenshot` was enough; `flakynessRetries: 1` is configured as a
safety net but was not needed. Fonts render from the OS fallback stack (we did
not import `@fontsource` into Storybook), which is stable run-to-run on the same
machine but **will differ across machines/CI** — see Next steps.

### Baseline ergonomics

Excellent. Baselines are plain PNGs named
`<story-id>__[w<width>px].png`, committed in-repo (owner requirement met).
The historical update command was `npm run visual:stories:update`; the current
pnpm command and authoring policy are documented in `app/docs/storybook.md`.
Baseline PNG changes remain reviewable like any other artifact.

### Mobile + desktop matrix

Works cleanly via `breakpoints: [390, 1440]` — one config line yields both
viewports for every story, satisfying ux-decisions point 3 (mobile-first is
mandatory, both viewports for every story). Lost Pixel captures full-page
height at each width. The MemberPage bottom-tab-bar correctly appears only in
the 390 px shot and is absent at 1440 px, exactly as the `xs`-only nav intends —
a real regression the matrix would catch.

## What the 7-theme matrix costs

Today the baseline set renders every story in **one** theme (`shadcn`) plus a
dedicated 7-theme showcase (7 stories × 2 breakpoints = 14 shots ≈ 0.5 MB,
~14 s). Fanning **every** story across all 7 themes would be:

- Shots: 29 × 7 × 2 = **406** (7× today).
- Wall time: ~**7 min** per run at the current ~1 s/shot, plus the build.
- Storage: ~406 × 28 KB ≈ **11 MB** of baselines.

That is affordable but not free, and 7× the review surface on every UI change.
Mechanism: per-story/per-meta `globals: { theme: '<mode>' }` (already proven in
`ThemeShowcase.stories.tsx`) — Lost Pixel screenshots each story with its baked
globals, so no extra tooling is needed to enumerate themes.

**Recommendation on the matrix:** do **not** run all stories × 7 themes by
default. Keep the default set at one canonical theme + the explicit theme
showcase (which pins the theme atoms — buttons, chips, money, surfaces — across
all 7 modes). Opt specific high-risk stories into the full theme fan-out via
`globals` where cross-theme rendering actually matters. Revisit a global fan-out
only if theme regressions start slipping through.

## Gotchas / caveats

1. **Pinned browser build.** Lost Pixel bundles its own
   `playwright-core@1.47.2`, which expects Chromium build **1134** — not the
   1228 the repo's `playwright-core@1.61.1` uses. First run needs a one-time
   `playwright-core install chromium` for that version (already present in this
   worktree's browser cache). In CI this means an explicit browser-install step
   pinned to Lost Pixel's playwright-core, or Lost Pixel's Docker runner (which
   also fixes the font-consistency problem below). This is the main operational
   wrinkle.
2. **Font rendering is host-dependent.** We render from OS fallback fonts.
   Stable locally, but baselines generated on a dev Mac will not match a Linux
   CI runner. Fix by either importing the `@fontsource` families into
   `.storybook/preview` (bundled, deterministic) or running Lost Pixel's Docker
   image so the baseline environment is fixed. Recommend the Docker runner for
   CI, local OSS mode for authoring.
3. **Telemetry.** Lost Pixel phones home by default; disabled via
   `LOST_PIXEL_DISABLE_TELEMETRY=1` in the npm scripts.
4. **Config lives outside the layered graph.** Stories are dev-only fixtures, so
   they opt out of the `apps/web` ESLint boundary + `sx-layout-only` rule and are
   excluded from dependency-cruiser (additive, scoped overrides). This keeps the
   two gates green without weakening any rule for product code.

## Recommendation

**Adopt Lost Pixel OSS** as the visual-regression tool for the layout-primitive
workshop, alongside Storybook 10 as the component catalog. It satisfies every
owner constraint in ux-decisions point 2–3: self-hosted, in-repo baselines,
reuses playwright-core + pixelmatch, mobile+desktop for every story. The
fallbacks (Loki, storycap+reg-suit) are not needed — Lost Pixel cleared the bar.

## Next steps (if adopted)

1. **Pin the browser for CI**: add a step that installs Chromium 1134 against
   Lost Pixel's playwright-core, or switch CI to Lost Pixel's Docker runner
   (also resolves font drift). Decide Mac-local vs. Docker baseline ownership.
2. **Font determinism**: import the app `@fontsource` families into
   `.storybook/preview` so shots match the real UI (and match across machines if
   not using Docker).
3. **Grow the catalog**: extend stories to `components/ui/*` and the state
   primitives as the atomic-design catalog fills out (ux-decisions point 1).
4. **A11y scan** (ux-decisions point 4, lowest priority): hook `axe-core` into
   the Storybook pipeline once the catalog stabilises.
5. **Theme fan-out policy**: keep default single-theme + showcase; opt-in
   per-story `globals` for high-risk cross-theme screens; reconsider a global
   matrix only if regressions leak.
6. **Historical CI recommendation (not adopted)**: the spike proposed running
   `visual:stories` on PRs. The replacement remains advisory and is not a merge
   gate; current policy lives in `app/docs/storybook.md`.
```

## Fallbacks (only if Lost Pixel had failed)

- **Loki** — Storybook-native, Docker/Chrome; heavier, less active.
- **storycap + reg-suit** — storycap captures, reg-suit diffs/reports with
  pluggable storage; more moving parts and config than Lost Pixel.

Neither was needed.
