# Accessibility audit

## Run contract

- **Cadence:** before a release, after material UI or theme changes, and after
  adding a public, member, creator, authentication, or account route.
- **Owner:** the web owner performs the audit; the product owner accepts only
  time-bounded exceptions with an affected-user impact statement.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), attaching `out/a11y/a11y-report.json` and the
  readable report when the scan runs. Manual findings name route, role, locale,
  viewport, input method, WCAG criterion, impact, owner, and due date.
- **Standard anchor:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA is the
  review target. Together's installed axe-core 4.12.x supplies automated rule
  evidence for its machine-checkable subset. Neither the scan nor this audit is
  a WCAG conformance claim.

## Automation caveat

Deque's published coverage study found that axe-powered automation detected
[57.38% of issues in its sampled audits](https://www.deque.com/automated-accessibility-coverage-report/).
That figure is a dataset result, not a guaranteed detection rate for Together,
and it leaves essential human-verifiable behavior outside automation.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| [`pnpm run a11y`](../../scripts/a11y-scan.ts) | Runs axe-core against Together's real public, member, and creator application surfaces at defined viewports and themes. Serious and critical findings fail; moderate and minor findings remain visible. The command is not part of `pnpm run check` or CI. |
| `pnpm run lint` | Applies JSX accessibility rules to represented syntax. It cannot evaluate rendered interaction, computed names, focus behavior, or route coverage. |
| `pnpm run visual` | Supplies deterministic macOS visual evidence under the [visual-regression policy](../visual-regression.md). Pixel equality does not establish accessibility. The Argos track remains advisory. |

## Manual checks

1. Exercise all actions by keyboard alone, including skip/navigation paths,
   logical focus order, visible focus, dialog trapping, focus restoration, and
   escape behavior.
2. Inspect headings, landmarks, form instructions, error association, status
   announcements, accessible-name meaning, and dynamic updates with browser
   accessibility tools and at least one representative screen reader.
3. Verify color is not the only carrier of meaning, text and UI contrast,
   reflow and zoom, target size, orientation, reduced motion, and content at
   mobile and desktop widths.
4. Repeat critical creator and member journeys in Polish and English. Check both
   account surfaces because shared identity does not imply shared markup.
5. Compare the scanner's route inventory with the current
   [route table](../route-table.md) and record unsampled states, browsers,
   assistive technologies, embedded third-party content, and provider-hosted
   pages as blind spots.

