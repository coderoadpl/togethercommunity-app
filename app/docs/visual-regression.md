# Visual regression

`npm run visual` captures the canonical seeded routes at fixed desktop and mobile
viewports in the Shadcn, Material, and Scoreboard themes. It compares every pixel
against the committed files in `tasks/visual-goldens/`. `npm run visual:update`
is the only golden-authoring command.

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

The current goldens were authored on macOS and `visual:update` rejects every
other platform. Browser screenshots depend on the operating system's font
rasterizer, so a Linux renderer cannot safely overwrite or compare against this
set as if the bytes were portable.

The Linux CI visual job remains deferred. Enabling it requires a deliberate,
reviewed migration that switches the authoring platform guard and regenerates
the complete golden set on the pinned Linux renderer. Until then, CI continues
to run the existing non-visual gates.

## Argos parallel track (evaluation)

Argos is a second, advisory-only visual track that runs in Linux CI. It captures
the same canonical routes, themes, and viewports into `out/visual/argos/` without
reading, writing, or comparing `tasks/visual-goldens/`, then uploads those PNGs
to an independent Argos-hosted Linux baseline. It does not replace the
lost-pixel or committed-golden workflows, and no existing visual command changes
meaning. The evaluation exists only so the owner can compare both workflows in
practice.

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
4. In the Argos project settings, set the reference branch to `poc-together`.
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
- The Hobby plan's screenshot quota. Each build captures 210 screenshots (35
  scenarios times three themes times two viewports), and every push to every open
  pull request can consume another build's allocation.
