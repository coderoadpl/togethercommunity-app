# Accessibility audit

## Purpose

Identify barriers in Together's shipped routes and states against the WCAG 2.2
AA review target, combining the in-house scan with manual interaction evidence.

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
  review target. Automated rule evidence comes from Together's in-house checks
  in [`scripts/a11y-checks.ts`](../../scripts/a11y-checks.ts), not from an
  external rule engine. Neither the scan nor this audit is a WCAG conformance
  claim.

## Automation caveat

axe-core was removed in favor of the in-house rule set; the
[accessibility checks doc](../accessibility.md) records what that swap costs.
The in-house checks reproduce every finding category the previous scan raised
on this app, but roughly ninety axe rules are gone — ARIA attribute validity,
nested interactive controls, table structure, and list semantics are no longer
machine-checked, and neither is the removed `eslint-plugin-jsx-a11y` syntax
layer. Automated coverage was already partial before the swap: Deque's
published study found axe-powered automation detected
[57.38% of issues in its sampled audits](https://www.deque.com/automated-accessibility-coverage-report/),
a dataset result rather than a detection rate for Together. Treat the narrowed
rule set as an argument for the manual checklist below, and record an unrun
category as not run rather than inferring a pass from it.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| [`pnpm run a11y`](../../scripts/a11y-scan.ts) | Runs the in-house [rule set](../../scripts/a11y-checks.ts) against Together's real public, member, and creator application surfaces at defined viewports and themes. Serious and critical findings fail; moderate and minor findings remain visible. Rules outside that set are not evaluated. The command is not part of `pnpm run check` or CI. |
| `pnpm run lint` | Carries no accessibility rules since `eslint-plugin-jsx-a11y` was removed with axe-core. Record the JSX syntax layer as not run. |
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

## Finding criteria

- A reproducible barrier in an audited route/state that violates a cited WCAG
  2.2 A or AA criterion. Include the role, locale, viewport, input method,
  expected interaction, observed result, and affected-user impact.
- An in-house scanner result supported by the affected element and rule
  evidence; manually confirm its meaning rather than importing a tool severity
  as a conformance verdict. Moderate and minor results remain reportable under
  the existing scan policy.
- Missing keyboard, focus, name, announcement, contrast, reflow, zoom, or
  reduced-motion behavior demonstrated by the manual checks, even when the scan
  is green. Unexercised checks are `not run`, not inferred violations.

## Known blind spots

- The in-house rules do not restore the removed axe or JSX accessibility
  coverage; a clean report cannot establish WCAG conformance.
- The selected routes, states, themes, locales, viewports, browsers, and
  assistive technologies cannot represent every user setup. Report omissions
  and provider-hosted or embedded content separately.
- Pixel equality, static lint, and a successful keyboard journey do not prove
  screen-reader usability or the absence of other accessibility barriers.

