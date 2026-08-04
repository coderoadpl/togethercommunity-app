# ADR-0010: Shadcn as the single maintained base theme

Status: accepted, 2026-07-29.

## Context

`apps/web/src/theme.ts` compiles seven theme definitions (`MODES`): Logbook,
Material, Quiet Studio, Scoreboard, Shadcn, Signal Mono, and Steady Frame.
Maintaining pixel goldens for all seven multiplied the visual regression
surface without a product reason; only one theme ships as Together's actual
product look.

## Decision

Shadcn becomes the only maintained and selectable base theme. The product
runtime hardcodes Shadcn, the tenant-facing `ThemeSwitcher` is removed, and
legacy theme values in local storage are ignored. The other six definitions
remain compiled only as unmaintained Storybook examples for a possible future
tenant bring-your-own-theme (BYO-theme) feature; they keep their branding-test
coverage but have no product runtime path, golden-image coverage, or support
claim. Steady Frame stays as the most complete showcase reference.

Shadcn currently has only a light palette. A light/dark/auto mode control must
not ship until a reviewed dark token set exists; until then the runtime remains
light-only.

`scripts/visual-screenshots.ts`'s `THEMES` constant shrinks to `['shadcn']`,
which drops both `pnpm run visual` and `pnpm run visual:argos-capture` to one
theme. The non-Shadcn entries in `tasks/visual-goldens/` (140 of the 210
files) are deleted rather than kept stale. The Storybook toolbar in
`.storybook/preview.tsx` and the seven-theme matrix in
`ThemeShowcase.stories.tsx` remain the reference surface for the BYO-theme
direction below.

## Consequences

`pnpm run visual` and the Argos advisory track now capture 70 screenshots (35
scenarios times one theme times two viewports) instead of 210. Reviewers no
longer see or approve Material/Scoreboard baseline changes; a future change
to any of the six example themes cannot be pixel-verified and is exempt from
`docs/visual-regression.md`'s baseline-review requirement.

The BYO-theme direction: a future tenant-supplied theme is expected to plug
into the same `ThemeMode`-shaped contract these six examples already
exercise. Promoting an example to maintained status, or adding a genuinely
new tenant theme, is a separate decision that must explicitly re-expand the
golden set — this ADR does not pre-approve that expansion.
