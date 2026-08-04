# Security policy

## Supported versions

Together is a private pre-release. It has no public supported release line,
maintenance branches, backport policy, or response-time commitment. Fixes are
evaluated only against the current `main` branch. If a report concerns a
deployed instance, include the commit SHA from its health attestation and the
deployment surface so the maintainer can reproduce it. The package version
names the application release, while the commit SHA identifies the exact build;
neither creates a public support promise, as recorded in the
[release-versioning decision](app/docs/decisions/0009-release-versioning-and-version-surfaces.md).

## Reporting a vulnerability

Do not open an issue, pull request, or discussion for a vulnerability.

Email **<kontakt@coderoad.pl>**. The repository is private, so email is also the
reporting path for someone who does not already have repository access. Include:

- the affected commit and deployment surface;
- the impact and the boundary crossed;
- the smallest reproduction available; and
- any conditions needed to reproduce the finding without accessing real user
  data.

Keep the report and reproduction private until the maintainer agrees that a fix
or disclosure is ready.

## What to expect

Reports are handled on a best-effort basis, without an SLA or bug bounty. The
maintainer will acknowledge a report when it is read, validate its scope, and
prioritize a confirmed vulnerability against other pre-release work. If there
is no response after two weeks, resend the report because it may have been
missed.

Together is source-available under
[FSL-1.1-ALv2 with an Apache-2.0 future license](LICENSE.md). This policy does
not change the license terms, create a warranty, or establish a public support
commitment.

## Scope

In scope are Together's source code and repository-controlled configuration,
including `app/`, database migrations, deployment configuration, and CI
workflows. Reports are especially relevant when they demonstrate:

- cross-tenant data access or authorization bypass;
- account takeover, session compromise, or privilege escalation;
- disclosure or misuse of secrets, payment data, or private content;
- unsafe webhook, e-mail, storage, import, or deployment boundaries; or
- a supply-chain or CI path to unreviewed repository or production access.

Findings in GitHub, Vercel, Neon, Stripe, AWS, or another provider belong to
that provider unless Together's code or configuration exposes the weakness.
Ordinary product defects, performance limits, and feature requests are not
security reports unless they cross a confidentiality, integrity, availability,
tenant, or privilege boundary.

## Known findings and evidence

Known gaps are recorded rather than implied to be fixed. The
[go-live checklist](app/docs/go-live-checklist.md) identifies incomplete owner
actions and pre-launch verification, while the
[server edge-security document](app/docs/security.md) records accepted
dependency advisories. The recurring
[audit roster](app/docs/audits/README.md), especially the
[CI-security](app/docs/audits/ci-security.md),
[dependency](app/docs/audits/dependencies.md), and
[product-completeness](app/docs/audits/completeness.md) specifications, defines
how evidence and open findings are reviewed.

A report about a recorded gap is still useful when it demonstrates new
exploitability, greater impact, or that the existing record understates the
risk. A green scanner or test run is evidence, not a security verdict.
