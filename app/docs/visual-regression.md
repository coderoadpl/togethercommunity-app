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
has a zero threshold and zero mismatch budget.

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
`pull-requests: write`. It supplements the required exact-commit review evidence
and remains separate from the advisory Linux Argos capture.

## Argos parallel track (evaluation)

Argos is a second, advisory-only visual track that runs in Linux CI. It captures
the same canonical routes, themes, and viewports into `out/visual/argos/` without
reading, writing, or comparing `tasks/visual-goldens/`, then uploads those PNGs
to an independent Argos-hosted Linux baseline. It does not replace the
committed-golden workflow, and no existing visual command changes meaning. The
evaluation exists only so the owner can compare both workflows in practice.

The `argos-advisory` job is not a gate. Its upload step tolerates Argos service
failures, and it is skipped when `ARGOS_TOKEN` is absent. Argos may post commit
statuses such as `argos`, `argos/<build-name>`, and `argos/summary`; branch
protection must never mark any of them as required.

Owner setup checklist:

1. Create an Argos account on the Hobby/free plan.
2. Create a project for this GitHub repository and complete its GitHub
   integration.
3. Copy the project token into the repository Actions secret named
   `ARGOS_TOKEN`.
4. In the Argos project settings, set the reference branch to `staging` (the integration trunk).
5. Re-run the `ci` workflow or push a commit to produce the first build.
6. In Argos, open the project, select the build from the Builds list, review its
   screenshot changes, and open the review control in the build header to choose
   **Approve** if that control is available on the Hobby plan.

Before relying on the Hobby plan, verify these three unresolved product details
empirically:

- Whether the build-header **Approve** action is actually available. Argos's
  pricing page presents team collaboration and reviews as Pro features, while
  its review-workflow documentation does not state a plan restriction.
- The actual screenshot and build retention period. Argos did not document this
  period when this evaluation track was added.
- The Hobby plan's screenshot quota. Each build captures 80 screenshots (40
  scenarios times the one maintained theme times two viewports), and every push
  to every open pull request can consume another build's allocation.

## Storybook

Storybook has no committed screenshot baseline or comparison command. Lost
Pixel and its copied story baselines are retired. The catalogue is checked by
its module tests and static build; all committed pixel comparison and baseline
authoring use the canonical route workflow above. Storybook's scope is
documented in [Storybook](storybook.md).
