# Visual regression

`pnpm run visual` captures the canonical seeded routes at fixed desktop and mobile
viewports in the Shadcn theme, Together's only maintained base theme (owner
decision 2026-07-29; see
[ADR-0010](decisions/0010-shadcn-base-theme.md)). It compares every pixel
against the committed baseline in `tasks/visual-goldens/`. `pnpm run visual:update`
is the only baseline-authoring command.

The harness fixes the seed time, browser clock, locale, timezone, color scheme,
device scale, and motion preference. It blocks non-local resources and persistent
browser streams, waits for the screen's explicit ready condition and loaded fonts,
then freezes animations, transitions, and the caret before capture. By default it
also waits for network idle and rejects captures at or below 10 KiB. A screen may
set `waitForNetworkIdle: false` when an intentionally held request makes network
idle unreachable, and may set `minBytes` when a legitimate stable capture is
smaller than the global floor. The boot splash uses both exceptions because it
holds `/api/me` open to preserve the pending state; it separately waits for the
public-offer response that supplies its final branding input and retains a 7 KiB
floor to reject blank output. Captures are sequential and comparison has no retry.
Pixelmatch excludes pixels it classifies as anti-aliasing; every remaining pixel
has a zero threshold and a 10-pixel mismatch budget.

Only stable surfaces belong in the screen list. A route needs deterministic seed
data, controlled external resources, and an explicit readiness condition for its
last asynchronous rendering input. Dynamic or ambiguously ordered content must
be stabilized, masked, scoped out, or omitted. Masks are reserved for present
but intentionally variable pixels such as build identity text; they do not
replace readiness checks or allow absent UI to pass unnoticed.

## Platform guard

The current baseline was authored on macOS and `visual:update` rejects every
other platform. Browser screenshots depend on the operating system's font
rasterizer, so a Linux renderer cannot safely overwrite or compare against this
set as if the bytes were portable.

## Baseline ownership

Only the contributor responsible for the visual change or a maintainer reviewing
that change may run `pnpm run visual:update`. It must run on the macOS renderer
from the exact commit proposed for review. If the commit changes afterwards, the
baseline and its evidence must be regenerated from the new commit.

A pull request that changes the baseline must identify the captured commit SHA
and show review evidence for every changed image, using a side-by-side comparison
or diff artifact. The reviewer must confirm that each baseline change is an
intentional consequence of the product change before approval. The directory
name `tasks/visual-goldens/`, the `out/visual/current` and `out/visual/diff`
paths, and the `visual` and `visual:update` command names remain unchanged.

The Linux CI visual job remains deferred. Enabling it requires a deliberate,
reviewed migration that switches the authoring platform guard and regenerates
the complete golden set on the pinned Linux renderer. Until then, CI continues
to run the existing non-visual gates.

## Pull request gallery

Pull requests targeting `staging` that change committed PNGs in
`tasks/visual-goldens/` receive one sticky Before/After comment from
`.github/workflows/visual-golden-gallery.yml`. Added, removed, renamed, and
modified baselines use URLs pinned to the pull request's merge base and head
commits. If GitHub cannot compare a fork's head commit in the base repository,
the workflow uses the pull request's base commit instead. The gallery caps its
rows and points reviewers to the Files tab when further changes are omitted.
When a pull request reverts all baseline changes, an existing sticky comment
reports that none remain.

The parity map's upstream design uses `raw.githubusercontent.com` image URLs.
The gallery instead emits commit-pinned `github.com/<owner>/<repo>/raw/<sha>/`
image URLs and wraps each preview in a matching blob link. Now that the
repository is public both URL forms are reachable without credentials, so
inline previews render; the pinned blob links remain the reliable fallback
whenever GitHub's comment image proxy declines a preview.

The publisher runs only trusted base-ref workflow code, never checks out or
executes pull-request head code, and is the only gallery job with
`pull-requests: write`. It supplements the required exact-commit review evidence.

## Storybook

The experimental Storybook capture path renders seeded member, public and studio
pages, plus the hosted legal document, from recorded fixtures. It shares the application harness's
clock, request policy, browser setup, settling helpers and pixelmatch comparator
(threshold 0, anti-aliasing excluded, 10-pixel budget). Page acceptance additionally
requires zero counted pixels for every converted capture.

After `pnpm run db:up`, run `pnpm exec tsx scripts/fixtures-check.ts` to verify that
fresh recordings match the committed fixtures byte-for-byte. Build with
`pnpm run storybook:build`, then run
`pnpm exec tsx scripts/storybook-capture.ts <output-directory> <screen-names>` on the macOS
renderer. The command captures the static Storybook on a local seed subdomain,
compares against the existing `tasks/visual-goldens/` files, and writes screenshots,
diffs and measurements to the output directory. It fails on missing fixtures,
browser errors, missing goldens or any counted pixel difference. Captures run once,
sequentially, with no retries. The optional screen list is comma-separated;
without it, the complete page catalogue is captured. Before capturing, the command
checks that every catalogue viewport has a built story and a committed golden;
unknown screen names fail explicitly. Viewports and capture actions
follow the application harness: desktop 1440×900, mobile 390×844, and member
pages at 375×812. The menu sheet has only a 390-pixel capture. New page story IDs
match golden filenames without the PNG extension.

This path is experimental and does not replace `pnpm run visual` or author goldens.
The catalogue is checked by its module tests and static build. Lost Pixel and its
copied story baselines are retired. Fixture calls cover initial rendering; unknown
interactions fail explicitly and concurrent page canvases are not supported.
See [Storybook](storybook.md) for recording and layer boundaries.
