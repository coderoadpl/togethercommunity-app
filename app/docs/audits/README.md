# Recurring audits

These specifications turn recurring review into a versioned roster. An audit is
an evidence-gathering exercise, not a certification: references to external
standards provide scope and vocabulary only. A green tool result is one input,
not a claim that Together conforms to a standard or that the manual review is
complete.

Every audit record must identify the commit and date reviewed, auditor, scope,
tool evidence, manual evidence, findings, accepted exceptions, blind spots,
owners, and due dates. Record `not run` or `unmeasured` rather than inferring a
result. Findings go to Together's product backlog or the
[go-live checklist](../go-live-checklist.md), according to urgency; they do not
silently rewrite either source of truth.

The roster is repository documentation only. Together has no website mirror for
these specifications.

## Roster

| Audit | Minimum cadence | Accountable owner | Primary anchor |
| --- | --- | --- | --- |
| [Documentation truth](docs-truth.md) | Monthly and before a release | Repository owner | ISO/IEC/IEEE 26514:2022 |
| [CI security](ci-security.md) | Monthly and after CI or ruleset changes | Repository owner | OpenSSF Scorecard 5.5.0; SLSA v1.2 |
| [Dependencies](dependencies.md) | Weekly automation; monthly review | Dependency maintainer | OpenSSF Scorecard 5.5.0; SLSA v1.2 |
| [Dead code and test gaps](dead-code-and-test-gaps.md) | Monthly and before a release | Repository owner | ISO/IEC 25010:2023 |
| [Consistency](consistency.md) | Before a release and after a cross-surface change | Feature owner | OWASP ASVS 5.0.0 V8; OWASP API Security Top 10:2023 |
| [External links](external-links.md) | Quarterly and before a release | Documentation owner | Together [`doc-lint`](../../scripts/doc-lint.ts) relative-target contract at the audited commit |
| [Completeness](completeness.md) | Monthly and before go-live | Product owner | OWASP ASVS 5.0.0 V6/V7 L2-derived profile; NIST SP 800-63B-4 |
| [Accessibility](accessibility.md) | Before a release and after material UI changes | Web owner | WCAG 2.2 AA; Together in-house [a11y checks](../../scripts/a11y-checks.ts) |
| [Performance](performance.md) | Quarterly instrument review; then before a release | Web owner | Core Web Vitals |

The 2026-08-04 email-verification review is recorded in both the
[completeness](completeness.md#email-verification-evidence--2026-08-04) and
[consistency](consistency.md#email-verification-evidence--2026-08-04) audits.

## Operating doctrine

- Run the tool-performed checks named by the spec, preserving their raw output
  or a stable artifact reference. Do not substitute one tool for a manual step.
- Follow every manual checklist and state which routes, roles, languages, and
  account surfaces were sampled. An omitted surface is a blind spot.
- Treat the linked [route table](../route-table.md),
  [permission table](../permission-table.md), [security posture](../security.md),
  [visual-regression policy](../visual-regression.md), and
  [go-live checklist](../go-live-checklist.md) as authoritative. Audits link to
  them instead of copying their inventories or decisions.
- Pin a standard by version in each record. A later version requires an explicit
  scope review before the roster changes.
- Report advisory evidence as advisory. In particular, Scorecard, accessibility
  automation, visual comparison, and future performance measurements do not
  become release gates merely because an audit consumes them.
