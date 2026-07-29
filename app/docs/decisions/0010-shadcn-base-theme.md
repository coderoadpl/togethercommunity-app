# ADR-0010: Shadcn as the single maintained base theme

Status: accepted, 2026-07-29.

## Context

`apps/web/src/theme.ts` compiles seven theme definitions (`MODES`): Logbook,
Material, Quiet Studio, Scoreboard, Shadcn, Signal Mono, and Steady Frame. The
theming engine itself — `ThemeMode`, `createThemeForMode`, the per-tenant
accent hue, and `ThemeModeProvider` — is load-bearing across the app: the
tenant-facing theme switcher, Storybook's theme toolbar, and
`theme-branding.test.ts` all iterate the full `MODES` union. Maintaining pixel
goldens for all seven multiplied the visual regression surface without a
product reason; only one theme ships as Together's actual product look.

## Decision

Shadcn becomes the only maintained base theme. The engine stays untouched: the
`ThemeMode` union and all seven `create*Theme` functions remain compiled, and
the tenant-facing `ThemeSwitcher` keeps offering all seven — the default was
already `shadcn` and stays that way. The other six move from "maintained" to
"unmaintained example" status: they keep working and keep their branding-test
coverage, but they lose golden-image coverage and any claim to product
support. Steady Frame stays in place as the showcase example for a future
tenant bring-your-own-theme (BYO-theme) feature, since its structure is the
most complete illustration of what a full custom theme definition looks like.

`scripts/visual-screenshots.ts`'s `THEMES` constant shrinks to `['shadcn']`,
which drops both `pnpm run visual` and `pnpm run visual:argos-capture` to one
theme. The non-Shadcn entries in `tasks/visual-goldens/` (140 of the 210
files) are deleted rather than kept stale. The Storybook toolbar in
`.storybook/preview.tsx` and the seven-theme matrix in
`ThemeShowcase.stories.tsx` are untouched — they are cheap to keep and are the
intended reference surface for the BYO-theme direction below.

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
