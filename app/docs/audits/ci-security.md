# CI-security audit

## Run contract

- **Cadence:** monthly, after any workflow or repository-ruleset change, and
  before a release. The advisory Scorecard collection runs weekly.
- **Owner:** the repository owner is accountable; a maintainer with GitHub
  ruleset and Actions visibility performs the external-state review.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), plus a control/evidence/status table. Attach the
  Scorecard SARIF artifact or workflow-run URL and separate repository findings
  from GitHub-configuration findings.
- **Standard anchor:**
  [OpenSSF Scorecard 5.5.0](https://github.com/ossf/scorecard/releases/tag/v5.5.0)
  supplies check names and supply-chain risk vocabulary.
  [SLSA v1.2](https://slsa.dev/spec/v1.2/) supplies Build-track vocabulary.
  Together currently makes no SLSA level claim; without assessed provenance,
  the audit records Build L0 as the baseline rather than implying L1.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| Weekly/manual advisory Scorecard workflow | Retains the SARIF artifact for 30 days and attempts an advisory Security-tab upload. The upload is unavailable for private repositories without GitHub Advanced Security. It publishes no public result and blocks no pull request. A score is evidence, not a verdict. |
| GitHub Actions workflow files | Reviewable evidence for declared triggers, permissions, action pins, checkout credential persistence, advisory steps, and repository guards. Files cannot prove the live ruleset or secret configuration. |
| `pnpm audit --prod --audit-level=moderate` | Blocking production-tree advisory check in CI; accepted findings remain governed by the [security posture](../security.md). |
| `pnpm run lock-lint` and `pnpm run license-lint` | Check lockfile and license policy encoded in the repository. They do not assess workflow trust boundaries. |

## Pinned action releases

The Scorecard workflow pins immutable commits. At this roster revision, those
commits map to these release tags:

- [`actions/checkout` v4.3.0](https://github.com/actions/checkout/releases/tag/v4.3.0)
- [`ossf/scorecard-action` v2.4.4](https://github.com/ossf/scorecard-action/releases/tag/v2.4.4)
- [`actions/upload-artifact` v4.6.2](https://github.com/actions/upload-artifact/releases/tag/v4.6.2)
- [`github/codeql-action` v3.37.4](https://github.com/github/codeql-action/releases/tag/v3.37.4)

## Manual checks

1. Inspect the live default-branch ruleset, required checks, review requirements,
   bypass actors, Actions policy, and default workflow-token permissions.
2. Compare each workflow's effective permissions and secret access with its
   purpose. Verify each action SHA resolves to the release recorded above and
   update the mapping with every pin change. Review third-party action ownership
   and the meaning of every `continue-on-error` or advisory path.
3. Confirm forks and untrusted pull requests cannot reach privileged events,
   write tokens, deployment credentials, or repository-owner-only secrets.
4. Triage Scorecard 5.5.0 findings against Together's actual threat model and
   the existing [security posture](../security.md). Do not replace manual review
   with the aggregate score.
5. Inventory produced artifacts and provenance. If no distributable artifact
   has SLSA v1.2 Build provenance, retain the L0 baseline and file the gap rather
   than assigning a higher level.
6. Record settings that could not be observed as blind spots. The repository
   workflow alone cannot establish branch-protection or secret posture.
