# Visual regression

`npm run visual` captures the canonical seeded routes at fixed desktop and mobile
viewports in the Shadcn, Material, and Scoreboard themes. It compares every pixel
against the committed baseline in `tasks/visual-goldens/`. `npm run visual:update`
is the only baseline-authoring command.

The harness fixes the seed time, browser clock, locale, timezone, color scheme,
device scale, and motion preference. It blocks non-local resources and persistent
browser streams, waits for the screen's explicit ready condition, network idle,
and loaded fonts, then freezes animations, transitions, and the caret before
capture. Captures are sequential and comparison has no retry. Pixelmatch excludes
pixels it classifies as anti-aliasing; every remaining pixel has a zero threshold
and zero mismatch budget.

Only stable surfaces belong in the screen list. A route needs deterministic seed
data, controlled external resources, and an explicit readiness condition for its
last asynchronous rendering input. Dynamic or ambiguously ordered content must
be stabilized, scoped out, or omitted.

## Platform guard

The current baseline was authored on macOS and `visual:update` rejects every
other platform. Browser screenshots depend on the operating system's font
rasterizer, so a Linux renderer cannot safely overwrite or compare against this
set as if the bytes were portable.

## Baseline ownership

Only the contributor responsible for the visual change or a maintainer reviewing
that change may run `npm run visual:update`. It must run on the macOS renderer
from the exact commit proposed for review. If the commit changes afterwards, the
baseline and its evidence must be regenerated from the new commit.

A pull request that changes the baseline must identify the captured commit SHA
and show review evidence for every changed image, using a side-by-side comparison
or diff artifact. The reviewer must confirm that each baseline change is an
intentional consequence of the product change before approval. The directory
name `tasks/visual-goldens/`, the `out/visual/current` and `out/visual/diff`
paths, and the separate Lost Pixel failure semantics remain unchanged.

## Deferred decisions

**DEFERRED — owner decision pending:** a CI visual job. The current baseline
requires the macOS renderer, so a non-macOS CI runner cannot author or validate
it. Enabling CI requires an owner-approved macOS runner or a reviewed full
baseline migration.

**DEFERRED — owner decision pending:** an advisory AI visual verdict. It would
remain non-gating, but CI currently has no API key for it. No AI credential or
verdict step is part of the present visual policy.
