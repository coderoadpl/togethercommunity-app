# Accessibility runtime scan (axe-core)

`npm run a11y` boots the real server against a seeded database and runs
axe-core (WCAG 2.0/2.1 level A + AA, plus best-practice) over the key screens
across **all 7 themes** at desktop 1440, with the member-facing screens
additionally scanned at mobile 390 — **161 screen renders per run**. Violations
are aggregated by rule × theme × screen; the script fails on any
serious/critical instance. Raw machine output lands in `out/a11y/`
(`a11y-report.json`, `a11y-report.md`).

Screens: login, checkout (multi-price `product-club`), my-courses, course,
lesson (incl. discussion), my-products, account, panel dashboard, products,
product editor, course detail, members, member detail, sales, integrations,
settings. Themes: logbook, material, quiet-studio, scoreboard, shadcn,
signal-mono, steady-frame.

## Result

| | Baseline scan | After fixes |
| --- | --- | --- |
| serious/critical instances | **61** | **0** |
| total violations | 306 | 14 (all waived, see below) |
| distinct rules | 6 | 1 |
| gate (`npm run a11y`) | FAIL | **PASS** |

## Findings and remediation

| Rule | Impact | Baseline | Screens (baseline) | Fix | Status |
| --- | --- | ---: | --- | --- | --- |
| `color-contrast` | serious | 54 | most screens, all themes | Per-theme AA contrast-token deltas in `theme.ts` (see below) | Fixed |
| `aria-progressbar-name` | serious | 7 | member detail | `aria-label` on the per-course learning-progress `LinearProgress` | Fixed |
| `landmark-one-main` | moderate | 98 | all member/public screens | Wrapped page body in a `<main>` landmark (`MemberPage`, `FocusCard`) | Fixed |
| `region` | moderate | 98 | all member/public screens | `<main>` + `<aside>` landmarks; wrapped the floating theme/language switchers in labelled `region` landmarks | Fixed |
| `heading-order` | moderate | 42 | dashboard, products, product editor, member detail, lesson | Corrected component heading levels (h3→h2, h4→h3) so pages step h1→h2→h3 | Fixed (28 of 42) |
| `empty-table-header` | minor | 7 | product editor | Visually-hidden "Actions" label on the price table's action column header | Fixed |

### Contrast fixes (all in `theme.ts`, minimal AA-reaching deltas)

- **Deleted-post tombstone text** used `text.disabled` (a token exempt only on
  genuinely disabled controls) → switched to `text.secondary`. Fixes all 7
  themes on the lesson screen.
- **Selected panel nav label** used the light brand accent (`primary.main`) as
  text on a tinted background → now uses `primary.dark`; the Material theme gains
  an explicit dark accent shade. Fixes logbook + material.
- **shadcn:** muted foreground `#71717a`→`#64646b` (toggle buttons and the
  lesson-duration pill sit on grey fills where `#71717a` fell just under 4.5:1);
  success `#16a34a`→`#15803d` (status chips, filled and outlined).
- **signal-mono / scoreboard:** filled status chips forced dark ink onto
  saturated fills; added `filled` chip overrides so success/error chips use
  light text on a sufficiently dark fill.
- **logbook:** filled primary filter chip and outlined buttons used the light
  accent → now use the dark accent ink (`accentInk`).
- **Material author chip** used `primary.main` → `primary.dark`.
- **Material accent theme:** the tenant accent doubles as button text on white
  and as the AppBar fill. Darkened the accent (`hsl 62%/42%`→`70%/28%`) so both
  directions clear AA, pinned `contrastText` to white, and added a `MuiAppBar`
  override so the inline theme/language switchers render solid white on the
  accent bar (semi-transparent white does not reach AA on a mid-tone fill).

## Waived (with reason)

- **`heading-order` on the lesson screen — 14 instances (2 per theme, moderate).**
  The lesson body is **creator-authored HTML** rendered via a sanitized
  `dangerouslySetInnerHTML`. The seeded lessons open each content block with an
  `<h3>` beneath the page `<h1>`, producing an h1→h3 step that axe flags. This is
  authored content, not a layout/component defect; normalising heading levels
  would mean rewriting arbitrary creator markup and is out of scope for a
  contrast/ARIA pass. Tracked as a separate content-normalisation concern.

No third-party iframe internals were flagged: non-local requests (including the
Bunny video embed) are stubbed during the scan, so their internals never enter
the audit.

## Re-run (post-fix, clean)

```
a11y: 161 renders scanned in ~170s
a11y: 14 total violations across 1 rules:
  [moderate] heading-order — 14x (all themes; screens: lesson)   ← waived
a11y: PASS — no serious/critical violations (moderate/minor only).
```
