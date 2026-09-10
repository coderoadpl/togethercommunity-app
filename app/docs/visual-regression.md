# Visual regression

`pnpm run visual` builds Storybook, serves `storybook-static` on an ephemeral
local port, and captures every story mapped to `tasks/visual-goldens/`. It needs
Node 24, pnpm 10.34.5 and Chrome, with no database or application server. It
always builds first so stale bundles cannot pass the gate. CI runs this gate on
macOS 26 (arm64) with Chrome 152.0.7977.82, matching the golden authoring platform. Set
`PLAYWRIGHT_CHROME_EXECUTABLE_PATH` to use an explicit Chrome executable.

Native macOS date controls also read the OS region and hour-cycle preferences,
independently of Playwright's browser locale and the frozen JavaScript clock.
Goldens use the `en_PL` macOS locale with English UI and 24-hour time. CI pins
these preferences on its disposable runner before launching Chrome. `TZ=UTC`
and `LANG=C` alone do not override them. Empty coupon validity fields must show
`dd/mm/yyyy, --:--`; an `mm/dd/yyyy` placeholder with an AM/PM field indicates
native locale drift, not a changing default date.

The catalogue currently covers 130 captures in Shadcn, the maintained base theme
described in the [Storybook reference](storybook.md#supported-scope). Other themes and synthetic
states remain available for review without separate committed PNG baselines.

## Storybook

The shared screen inventory in `scripts/visual-screen-inventory.ts` defines
readiness, interactions and viewport selection: desktop 1440×900, mobile
390×844, and member/checkout pages at 375×812. The member menu sheet is mobile
only. `scripts/storybook-page-screens.ts` maps screens to story IDs, including
the original Start, LessonPlayer, SpaceFeed and hosted legal document IDs.
Every mapped viewport must exist in Storybook's built index. Every committed
PNG must be covered; a missing story, missing golden or unmapped golden fails.
The inherited active-named DNS goldens repeat the pending DNS capture after a
same-document navigation. Both map to the pending story to preserve that page
state; verified DNS has separate Active stories.

Both capture paths use `createVisualCapture` in `scripts/visual-browser-setup.ts`.
It fixes Date to the recording time and sets locale to `pl-PL`,
timezone to UTC, color scheme to light, scale to 1 and reduced motion. It shares
the live harness's request policy, stream suppression, font readiness and
animation freezing. Each story must finish its fixture calls and queries before capture; fonts and
image decoding also settle before screenshots. Panel stories load their shell
fonts before mounting to reproduce navigation within an already loaded panel.
The email integration story preserves the initial font-loading sequence used
by its recorded tab-underline measurement through `preloadFonts: false`.
The lesson-attachment scenario explicitly scrolls its HTML
field to the recorded end position. DNS fixtures open settings without an initial
hash jump; the harness scrolls to the domain section after fonts settle so the
sticky sidebar is first painted at the top of the document. Server HTML stories render the production HTML in a nested iframe;
the harness waits for that document and its fonts. Captures run sequentially,
once, with no retries. Each viewport/auth group reuses a page in inventory order, matching the
golden authoring harness and its rounded-shadow paint caches. The shared browser
setup saves native animation-frame scheduling before Playwright installs its
clock. Capture waits use those native frames, so paint readiness remains tied
to rendering while application timers retain the authoring clock behavior.

Pixelmatch uses threshold 0, excludes anti-aliasing and allows at most 10 counted
pixels. Byte-identical PNGs pass immediately with zero counted pixels and clear
any stale diff image; every non-identical PNG still runs through Pixelmatch.
Migration acceptance is stricter: each converted capture must report
0 counted pixels, preferably identical bytes. Any residual pixels and their
cause must be listed in the pull request. Browser errors, unexpected fixture
calls, unexercised expected errors, unresolved queries and suspiciously small
screenshots also fail. The default size floor is 10 KiB; the held boot splash
uses 7 KiB and skips network-idle waiting.

Screenshots are written to `out/visual/current`, diffs to `out/visual/diff`, and
per-capture counts, byte equality, fixture hashes and diagnostics to
`out/visual/measurements.json`. CI uploads this directory even on failure.
To inspect selected screens after explicitly building the current source:

```bash
pnpm run storybook:build
pnpm exec tsx scripts/storybook-capture.ts out/visual-debug login,lesson
```

The optional output directory and comma-separated screen list are diagnostic
controls. The default `pnpm run visual` always captures the full catalogue.

## Add a screen

1. Add the screen's seed-backed route, readiness condition and supported
   viewports to `SCREENS`. Readiness must cover the last asynchronous rendering
   input. Use a `settled` action for scrolling or opening an interaction.
2. Add a scenario to `scripts/fixtures-record.ts`, declaring its seed principal,
   tenant, route and required client calls. Record it using the commands below.
3. Add a page story using the production page composition and fixture decorator.
   Parse fixture inputs at the boundary. For server HTML, use the production
   renderer and the server iframe pattern. Use the golden filename without
   `.png` as the story ID and add the screen to `storybook-page-screens.ts`.
4. Build Storybook and inspect the story. Author a new golden on macOS with
   `pnpm run visual:update`, then run the serial static gate and visual gate.
   Review every new image and its diff in the pull request.

Story files have the bounded lint exceptions described in [Storybook](storybook.md).
Fixture clients, decorators and composition infrastructure still obey layering
and dependency-cruiser. Do not import server use-cases or database adapters into
web fixture infrastructure. Add no comments except to explain a non-obvious why.

## Record and check fixtures

```bash
nvm use
pnpm run db:up
pnpm run fixtures:record
pnpm run fixtures:check
```

Recording creates and drops the isolated database with a unique `together_smoke_test` name with the
fixed visual seed clock, starts the real server, and records through the client
boundary. It does not overwrite the development database. Each process receives its own database name.
`DATABASE_URL` selects the Postgres instance for recording; the default is the
local development instance on port 48912.

`fixtures:record` writes `apps/web/src/stories/fixtures`; an optional output
directory records elsewhere. `fixtures:check` re-records into a temporary
directory and fails on any byte or file-set drift, cleaning up on either outcome.
CI runs it in the Postgres-backed `e2e` job's `auth` leg, before the live subset.
A changed API response or seed requires an intentional fixture update and review;
CI never silently refreshes fixtures. Fixtures use the seed vocabulary only.

## Synthetic states

Loading, empty, error and preference-result states can be unreachable through
populated seed routes. Derive them from recorded seed data and declare their
expected errors or pending calls explicitly. Use `pending` call entries with
query keys to hold loading states; readiness waits for all other queries and
mutations. Never disguise an unknown call as an empty success or add a timeout
retry. Synthetic stories without inventory entries have no golden and do not
increase the required capture count. See the boot splash and marketing
preference-result stories for examples.

## Live application subset

`pnpm run visual:app` keeps only login, boot splash and one seeded lesson, at
their supported viewports (seven captures). It starts Postgres locally, creates, migrates
and seeds an isolated database with the visual clock, builds the SPA and
boots the real server. In CI, `E2E_DATABASE_URL` selects the supplied database
service and skips Docker startup. The isolated database is dropped after the run.

Login must receive the real auth-config and enabled seed auth methods. Real
password and magic-link sign-in establish creator and member sessions. The boot
splash holds `/api/me`, waits for public branding, captures the pending state,
then releases the request and requires the dashboard to replace the splash.
The lesson requires the server's HTTPS frame policy and script nonce and a real
HTTPS media embed. External media delivery remains blocked by the shared request
policy; provider uptime is outside this gate.

This e2e subset asserts live behavior and retains screenshots in
`out/visual-app/current`. Pixel comparison belongs to the Storybook gate, so
the e2e job can run on Linux without comparing its font rasterization against
macOS goldens. CI runs the subset in the `auth` leg and uploads its captures.

## Baseline ownership

`pnpm run visual:update` is the only baseline-authoring command. It builds and
captures Storybook, then writes only PNGs whose bytes changed, after all captures
pass their rendering checks. It rejects non-macOS hosts. A contributor or
maintainer must review every changed baseline as an intentional product change;
never regenerate goldens to hide a regression. Re-run verification after changing
the implementation. A pull request must list each changed image and its cause,
with golden/story/diff evidence. For the Storybook migration the target is no
baseline changes.

Pull requests to `staging` that change committed PNGs also receive a sticky
Before/After gallery from `.github/workflows/visual-golden-gallery.yml`. Its
images are pinned to the compared commits. The publisher uses trusted base-ref
workflow code and never executes pull-request code.

## Chromatic

The `preview` project publishes a Storybook preview permalink for non-draft pull requests
targeting `staging` and pushes to `staging` when `CHROMATIC_PREVIEW_PROJECT_TOKEN` is
available and changes affect `app/apps/web/**`, `app/.storybook/**`,
`app/apps/server/src/**`, `app/core/**`, `app/package.json`, `app/pnpm-lock.yaml`,
`app/tasks/visual-goldens/**`, or `.github/workflows/chromatic-preview.yml`.
The preview command uses TurboSnap (`--only-changed`) to copy unchanged stories
instead of capturing them, while retaining `--exit-zero-on-changes` and `--exit-once-uploaded`.

Chromatic snapshot testing runs only for promotion pull requests targeting `main`, plus manual
`workflow_dispatch` runs. It reviews Storybook UI snapshots for baseline changes
before promotion; it is not the visual regression gate and does not replace
`pnpm run visual` or the committed route goldens.

Pull-request workflows check out `github.event.pull_request.head.sha` with full
history before running Chromatic. TurboSnap compares the real PR head with
baseline ancestors; the synthetic merge commit from the default pull-request
checkout does not provide a usable changed-file range and makes Chromatic fall
back to the full Storybook catalogue.

Before the Chromatic command, the workflow diffs the pull-request base and head
for `app/apps/web/**`, `app/apps/server/src/**`, `app/core/**`, `app/.storybook/**`,
`app/package.json`, and `app/pnpm-lock.yaml`. Pull requests with no matching
files run the Chromatic CLI with `--skip`, leaving the check green and refreshing
the sticky PR comment with `Chromatic skipped: no UI changes`. Dependency file
changes are included because installed package changes can alter rendering, and
`app/core/**` is included because `app/apps/web/src` imports it as
`#core/domain` / `#core/contract` and its changes can alter rendered stories.
The `pnpm install` and Chromatic steps run unconditionally so the skip decision
comes only from the Chromatic CLI's own `--skip` flag, keeping every job on the
lockfile-pinned dependency tree instead of an ad hoc install.

The free plan budget is 5,000 snapshots per month in Chrome. The snapshot cost follows the current catalogue size. With
TurboSnap enabled through `onlyChanged`, most promotion builds should snapshot
only stories affected by the pull request instead of the whole catalogue. Manual
runs still spend quota according to the number of stories Chromatic snapshots.
The skip rule keeps non-UI pull requests from spending monthly snapshots.

Review Chromatic from the UI Review status on the pull request. Inspect each
changed snapshot, accept only intentional UI baseline changes in Chromatic, and
leave accidental changes unaccepted until the branch is fixed. The UI Review
status is advisory: it gives reviewers visual evidence for promotion, but the
required repository gate remains `pnpm run check` and the existing smoke/visual
processes.
