# Visual regression

`npm run visual` captures the canonical seeded routes at fixed desktop and mobile
viewports in the Shadcn, Material, and Scoreboard themes. It compares every pixel
against the committed files in `tasks/visual-goldens/`. `npm run visual:update`
is the only golden-authoring command.

The harness fixes the seed time, browser clock, locale, timezone, color scheme,
device scale, and motion preference. It blocks non-local resources and persistent
browser streams, waits for the screen's explicit ready condition, network idle,
and loaded fonts, then freezes animations, transitions, and the caret before
capture. Captures are sequential and comparison has no retry or tolerance budget.

Only stable surfaces belong in the screen list. A route needs deterministic seed
data, controlled external resources, and an explicit readiness condition for its
last asynchronous rendering input. Dynamic or ambiguously ordered content must
be stabilized, scoped out, or omitted.

## Platform guard

The current goldens were authored on macOS and `visual:update` rejects every
other platform. Browser screenshots depend on the operating system's font
rasterizer, so a Linux renderer cannot safely overwrite or compare against this
set as if the bytes were portable.

The Linux CI visual job remains deferred. Enabling it requires a deliberate,
reviewed migration that switches the authoring platform guard and regenerates
the complete golden set on the pinned Linux renderer. Until then, CI continues
to run the existing non-visual gates.
