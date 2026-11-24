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

The catalogue currently covers 240 captures in Shadcn, the maintained base theme
described in the [Storybook reference](storybook.md#supported-scope). Other themes and synthetic
states remain available for review without separate committed PNG baselines.

Lesson player captures derive long text in the page story from the unchanged recorded fixture and show the full page, including the centred reading preview, its control, and the discussion below it at desktop and both mobile widths.

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

Settings security and team have separate desktop and mobile captures using the
recorded owner fixture. The team story adds a synthetic pending invitation to
cover its status and revoke action. Each capture scrolls to its section and
asserts that the section begins below the sticky app bar in the viewport,
preserving coverage of both settings surfaces and their headings.

Lesson lightbox captures are page variants declared in
`scripts/visual-screen-inventory.ts` and mapped in
`scripts/storybook-page-screens.ts`. They reuse the recorded lesson fixture with
local image content. The light desktop variant opens the overlay with a real
pointer click in the capture's readiness step, so its close button shows no
focus ring; the others open it through a story interaction. The goldens cover a
small captioned raster (light desktop), a captioned transparent SVG in Polish
(light mobile) and in the dark theme (dark desktop), and a raster with
alternative text only (dark mobile), including the lesson shell behind the overlay.
Each variant uses an isolated browser context and the normal fixture readiness
handshake; no new recording scenario or database is required.

Component screens are the second mapping. `scripts/storybook-component-screens.ts`
declares them directly as screen specs, each with one story ID and one or both
viewports, so they never appear in `SCREENS` and never touch
`scripts/fixtures-record.ts`. Most render a single component from props instead
of a seeded route; the capture skips the `fixtureReady` handshake for every
screen of this mapping and records `fixturePath` and `fixtureSha256` as `null`
in `measurements.json`. Their captures run after the page screens within each
viewport and authentication group. Because a single component is smaller than a
full page, they use a 4 KiB size floor.

Every capture path uses `createVisualCapture` in `scripts/visual-browser-setup.ts`.
The harness tracks network idle itself: the page is idle once 500 ms have passed
with no request in flight, and any new request, attached frame or frame navigation
ends that state until another 500 ms pass with nothing in flight.
Requests remain in flight until they finish or fail, and the idle wait fails after
30 seconds with their URLs if the page cannot settle. The browser library's idle
bookkeeping can lose its main-frame idle state after a late request and a child
frame navigation, so capture readiness does not use its network-idle wait.
It fixes Date to the recording time and sets locale to `pl-PL`,
timezone to UTC, color scheme to light, scale to 1 and reduced motion. It shares
the live harness's request policy, stream suppression, font readiness and
animation freezing. Each story must finish its fixture calls and queries before capture; fonts and
image decoding also settle before screenshots. Panel stories load their shell
fonts before mounting to reproduce navigation within an already loaded panel.
Course captures repaint their asynchronously settled notification badge, public
sidebar icons and editor upload control before the screenshot: repeated runs of
those screens alternated between two antialias states for the same geometry, and
forcing a re-raster once the chrome is final made them byte-stable. The mobile
lesson lightbox captures repaint the lesson footer bar behind the scrim for the
same reason: the lesson image can finish loading after the overlay opens and move
that bar, and repeated runs left its outlined previous-lesson button one pixel
apart. The differences were seen only in the mobile captures, so the repaint runs
below 900 px. Each repaint
first waits for its target, so a selector that stops matching fails the capture
instead of silently skipping the re-raster.
The mobile long-curriculum capture moves the pointer off the program button and
blurs the trigger after dismissing its sheet, then asserts that it is neither
hovered nor focused, so prior interactions cannot change its captured background.
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
pixels. A PNG whose dimensions differ from its baseline fails as a size mismatch
before any pixel comparison. Among PNGs of the same size, byte-identical ones
pass immediately with zero counted pixels and clear any stale diff image; every
other one runs through Pixelmatch.
Migration acceptance is stricter: each converted capture must report
0 counted pixels, preferably identical bytes. Any residual pixels and their
cause must be listed in the pull request. Browser errors, unexpected fixture
calls, unexercised expected errors, unresolved queries and suspiciously small
screenshots also fail. The default size floor is 10 KiB; the held boot splash
uses 7 KiB and skips network-idle waiting, and component screens use 4 KiB.

Screenshots are written to `out/visual/current`, diffs to `out/visual/diff`, and
per-capture counts, byte equality, fixture hashes and diagnostics to
`out/visual/measurements.json`. CI uploads this directory as the `visual`
artifact, whose top level holds `current/`, `diff/` and `measurements.json`,
also when the capture fails; a job that stops before the capture step leaves
nothing to upload. A capture whose readiness wait fails or whose screenshot is
at or below its size floor records the reason in the `failure` field of its
measurement, with the queries still fetching when there are any; a capture
without such a failure has no `failure` field.
Each capture log names the condition that failed the gate: `missing fixture
calls: [...]` for calls the story made that its fixture does not hold, `fixture
expectation issues: [...]` for the opposite problem (an unexercised expectation,
or no fixture selected), `unreadable fixture diagnostics: ...` when the dataset
value cannot be parsed, `error boundary rendered`, and `page errors: ...`. The
first three read the same `data-fixture-errors` dataset, which the story harness
fills from both classes. The measurement for every capture records the same
information in `missingFixtureCalls`, `fixtureExpectationIssues`,
`unreadableFixtureDiagnostics`, `errorBoundaryRendered` and `pageErrors`,
including empty values on success.
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
   `pnpm run visual:update`, or take it from the CI capture under the conditions
   in [Baselines from the CI capture](#baselines-from-the-ci-capture), then run the serial
   static gate and visual gate. Review every new image and its diff in the pull
   request.

## Add a component screen

1. Add a story whose args cover the state to capture, with a stable test id the
   readiness condition can wait for. No fixture, route or seed data is involved.
2. Add the screen and its story ID to `scripts/storybook-component-screens.ts`,
   choosing the viewports to capture.
3. Author the golden with `pnpm run visual:update` on macOS, or take it from
   the CI capture under the conditions in
   [Baselines from the CI capture](#baselines-from-the-ci-capture), and review the image in
   the pull request, exactly as for page screens.

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

`pnpm run visual:update` is the baseline-authoring command. It builds and
captures Storybook, then writes only PNGs whose bytes changed, after all captures
pass their rendering checks. It rejects non-macOS hosts. A contributor or
maintainer must review every changed baseline as an intentional product change;
never regenerate goldens to hide a regression. Re-run verification after changing
the implementation. A pull request must list each changed image and its cause,
with golden/story/diff evidence. For the Storybook migration the target is no
baseline changes.

### Baselines from the CI capture

Owner decision 2026-11-22, recorded in `CLAUDE.md` (Storybook and visual
verification): baselines authored this way are accepted, and the ten baselines
changed by #448 and #450 and re-recorded in #452 were authored this way.
Conditions 1 to 4 below are checked by a reviewer, not enforced by a command;
`config-regression/visual-golden-gallery.test.ts` enforces condition 5 in
`pnpm run check`.

A contributor without a macOS host may take baselines from the `visual` job of
the pull request's own CI run instead. That job runs the same capture on the
macOS runner and the browser version the workflow pins. The run is the
`pull_request` run of `ci.yml`: it checks out the merge commit GitHub prepares
for the pull request, which is the head commit merged into the base branch as
the base was when that commit was prepared; a re-run renders the same merge
commit. The captures therefore include the base. A run triggered by a push to a
branch is not such a run. All of these conditions hold, or the baselines are
not accepted:

1. The PNGs are copied byte for byte from the `current` directory of the
   `visual` artifact of a `pull_request` CI run for the pull request's own head
   commit. Nothing else produces them: no local capture, no editing, no artifact
   of another branch or pull request.
2. The capture of that run completed, measured every screen of the catalogue,
   and failed only because captures differed from their existing baselines (a
   pixel count above the tolerance or a size mismatch). A run in which any
   measurement records a `failure`, a missing fixture call, a fixture
   expectation issue, unreadable fixture diagnostics, a rendered error boundary
   or a page error is not a source of baselines; fix the cause first.
3. The commit that replaces the PNGs changes nothing else that affects
   rendering, and the `visual` job passes in a `pull_request` CI run for the
   head that carries them. A later commit that changes what a captured screen
   renders needs a new capture from a run for that later head. When the base
   branch has gained a change that affects rendering since the source run, the
   `visual` job must pass in a run that merges the head into the current base
   before the pull request is merged; if it fails there, the baselines are
   captured again from that run under these conditions.
4. The pull request description lists every added or changed image with its
   cause, names the source run with its head commit and the base commit it
   merged with, and states for changed images where they differ from the
   previous baseline. An unexplained difference is a regression to fix, not a
   baseline to accept.
5. The number of committed baselines stays within `maxRows` in
   `.github/workflows/visual-golden-gallery.yml`, so a complete regeneration
   still fits in the Before/After gallery; raising `maxRows` is a separate
   change.

A new screen has no baseline for the first run to compare with, and the capture
stops before its first screenshot when a mapped screen has no PNG. Commit a
valid provisional PNG under the new name whose dimensions differ from the
viewport's, so the comparison fails as a size mismatch, let the `visual` job
fail on it, and replace it in a separate commit from that run's artifact. The
conditions above apply to that replacement, not to the provisional PNG. The
provisional PNG counts toward condition 5: while the number of baselines equals
`maxRows`, a new screen first needs `maxRows` raised in a separate change.

#### Evidence for the ten baselines accepted on 2026-11-22

The owner decision names ten baselines: six changed by #448, and four changed by
#450 and recorded again in #452. Each one is byte for byte the capture in the
`current` directory of the `visual` artifact of the source run below. The
SHA-256 is that of the PNG committed under `tasks/visual-goldens/` by the named
baseline commit; `staging` still carries those bytes. Each baseline commit
changes PNG files only.

In both source runs the `visual` job ran on the `macos-26` runner with browser
152.0.7977.82 and measured all 240 captures of the catalogue. Their
`measurements.json` holds no measurement with a `failure`, a missing fixture
call, a fixture expectation issue, unreadable fixture diagnostics, a rendered
error boundary or a page error. The listed captures are the only ones whose
comparison failed in their run: six pixel counts above the tolerance of 10 in
the first, four size mismatches in the second. The `visual` job then passed
with the six in CI run 44870470586 for head `290b10a6` of #448 (merge commit
`c0f6f313` into base `6e6a4d66`), and with all ten in CI run 44876916294 for head
`754e0056` of #452 (merge commit `a879f04d` into base `6e6a4d66`).

All four runs merged their head with `staging` at `6e6a4d66`, and `staging` was
still at `6e6a4d66` when #452 was merged, so the base did not move between the
captures and the merge. The merge commit ids are the commits each run's checkout
step logged; GitHub keeps them only under the pull request's temporary merge
reference.

This record was assembled on 2026-11-22 from the artifacts of the two source
runs, the job logs of the four runs and the baseline commits. The repository holds the baseline
commits and the PNGs; the artifacts and logs are kept by the CI provider for a
limited time, so the run measurements, the byte comparison with the artifacts
and the merge commit ids cannot be re-derived from the repository alone.

Six images changed by #448: baseline commit `bd12ca3d`, source run 44868762903
for head `4d82617e` of that pull request, which checked out merge commit
`f20027c1` of that head into base `6e6a4d66`. Its `visual` job failed on these
six. Cause as stated in #448: the three Meta consent stories render the
purchase confirmation sentence, which that pull request shortened.

| Baseline | Comparison result in the source run | SHA-256 of the committed PNG |
|---|---|---|
| `meta-capi-consent--shadcn--desktop` | 31265 px differ (2.412%) | `6a0adc0d1b5a41e0ae078c69a838846f089fb3233305123cb07d8d4e230bc092` |
| `meta-capi-consent--shadcn--mobile` | 2885 px differ (0.876%) | `ed2dc9a72bc42b03ade18152a4d488c54667d2f640168aebbf591cddd390707e` |
| `meta-capi-expanded--shadcn--desktop` | 1825 px differ (0.141%) | `1d2a5c9b91f06c1d8210f4f9c1beffac5cee0e30282bb0ac6a2444c6eacab3fd` |
| `meta-capi-expanded--shadcn--mobile` | 2885 px differ (0.876%) | `6b0ac9e41bac4508bdee335341c93cbf096eb1a9f269ca691164e5971615d6fe` |
| `meta-capi-decided--shadcn--desktop` | 34699 px differ (2.677%) | `117219c048cabb6b1dfef952f6707bbdf757d20227924898f27c7d043824ba20` |
| `meta-capi-decided--shadcn--mobile` | 36271 px differ (11.019%) | `f863aeb2d4374feee05c854eec976f4ff1018ff0c4c842a3a8d4f8fdda6380e5` |

Four images changed by #450 and recorded again in #452: baseline commit
`754e0056`, source run 44875118318 for head `f2536201` of #452, which checked
out merge commit `78a87679` of that head into base `6e6a4d66`. Its `visual` job
failed on these four. #450 had moved these stories to the composed bundle
checkout page with its summary details open and recorded them in commit
`d3e182de`; in the #452 source run each capture came out 24 px taller than that
recording. Cause as stated in #452: on the combined branch the product-safety
Details toggle sits below the product rows and rows without a picture keep a
picture slot.

| Baseline | Comparison result in the source run | SHA-256 of the committed PNG |
|---|---|---|
| `sales-link-offer-light-desktop--shadcn--desktop` | size mismatch: baseline 1440x1429, current 1440x1453 | `b9f1a5a1ad1e3b44758b49ed7fe3a23e9626e8f12d7ef9e80661ac8e05eece5f` |
| `sales-link-offer-dark-desktop--shadcn--desktop` | size mismatch: baseline 1440x1429, current 1440x1453 | `736ca7a2ca339d80f2e7e27ae8d593df496d669c3b9f3130bc9bbbd7faa91aa3` |
| `sales-link-offer-light-mobile--shadcn--mobile` | size mismatch: baseline 390x1550, current 390x1574 | `c70b4c3073717355a47b5c0ab5d5a9dd446ed804ad1c94164909efbb53be3f99` |
| `sales-link-offer-dark-mobile--shadcn--mobile` | size mismatch: baseline 390x1550, current 390x1574 | `5f735b2b56d77275c3280ea338e6681e1224d142038196b7016616fab8bd62e2` |

One shortfall against the conditions above, which were written after these
pull requests: their descriptions list the images with their causes but name
neither the source run nor its head and base commits (condition 4). This
section records what the descriptions lacked.

Pull requests to `staging` that change committed PNGs also receive a sticky
Before/After gallery from `.github/workflows/visual-golden-gallery.yml`. Its
images are pinned to the compared commits. The publisher uses trusted base-ref
workflow code and never executes pull-request code.

## Chromatic

Chromatic uses one project for promotion review. Snapshot testing runs for
promotion pull requests targeting `main`, plus manual `workflow_dispatch` runs.
It reviews Storybook UI snapshots for baseline changes before promotion; it is
not the visual regression gate and does not replace `pnpm run visual` or the
committed route goldens.

Pushes to `main` run the same project with `--auto-accept-changes` and
TurboSnap (`--only-changed`) so the accepted baseline follows each promotion.
The push trigger carries the same `paths:` list the pull-request job diffs, so a
promotion that touches no UI file leaves the previous baseline in place.

The pull-request job checks out `github.event.pull_request.head.sha` with full
history before running Chromatic. TurboSnap compares the real PR head with
baseline ancestors; the synthetic merge commit from the default pull-request
checkout does not provide a usable changed-file range and makes Chromatic fall
back to the full Storybook catalogue.

Before the pull-request Chromatic command, the workflow diffs the pull-request
base and head for `app/apps/web/**`, `app/apps/server/src/**`, `app/core/**`,
`app/.storybook/**`, `app/package.json`, `app/pnpm-lock.yaml`,
`app/tasks/visual-goldens/**`, and `.github/workflows/chromatic.yml`. Pull
requests with no matching files run the Chromatic CLI with `--skip`, leaving the
check green and refreshing the sticky PR comment with `Chromatic skipped: no UI
changes`.
Dependency file changes are included because installed package changes can
alter rendering, and `app/core/**` is included because `app/apps/web/src`
imports it as `#core/domain` / `#core/contract` and its changes can alter
rendered stories. The `pnpm install` and Chromatic steps run unconditionally
so the skip decision comes only from the Chromatic CLI's own `--skip` flag,
keeping every job on the lockfile-pinned dependency tree instead of an ad hoc
install.

The free plan budget is 5,000 snapshots per month in Chrome. The snapshot cost follows the current catalogue size. With
TurboSnap enabled through `onlyChanged`, most promotion and main-baseline builds
should snapshot only stories affected by the change instead of the whole
catalogue. Manual runs still spend quota according to the number of stories
Chromatic snapshots. Non-UI pull requests spend nothing through the `--skip`
rule, and non-UI promotions never start a main-baseline build because the push
trigger filters the same paths.

Review Chromatic from the UI Review status on the pull request. Inspect each
changed snapshot, accept only intentional UI baseline changes in Chromatic, and
leave accidental changes unaccepted until the branch is fixed. The UI Review
status is advisory: it gives reviewers visual evidence for promotion, but the
required repository gate remains `pnpm run check` and the existing smoke/visual
processes.
