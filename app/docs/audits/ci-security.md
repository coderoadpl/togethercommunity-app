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

Every workflow pins immutable commits. At this roster revision, those commits
map to these release tags:

- [`actions/checkout` v4.3.0](https://github.com/actions/checkout/releases/tag/v4.3.0) — `08eba0b27e820071cde6df949e0beb9ba4906955`
- [`ossf/scorecard-action` v2.4.4](https://github.com/ossf/scorecard-action/releases/tag/v2.4.4) — `2d1146689b8cda280b9bc96326124645441f03bc`
- [`actions/upload-artifact` v4.6.2](https://github.com/actions/upload-artifact/releases/tag/v4.6.2) — `ea165f8d65b6e75b540449e92b4886f43607fa02`
- [`github/codeql-action` v3.37.4](https://github.com/github/codeql-action/releases/tag/v3.37.4) — `a2983b8bed1923f44751c5c43237f479442827b3`
- [`pnpm/action-setup` v6.0.9](https://github.com/pnpm/action-setup/releases/tag/v6.0.9) — `0ebf47130e4866e96fce0953f49152a61190b271`
- [`actions/setup-node` v4.4.0](https://github.com/actions/setup-node/releases/tag/v4.4.0) — `49933ea5288caeca8642d1e84afbd3f7d6820020`
- [`browser-actions/setup-chrome` v2.1.2](https://github.com/browser-actions/setup-chrome/releases/tag/v2.1.2) — `2e1d749697dd1612b833dba4a722266286fbefcd`
- [`contributor-assistant/github-action` v2.6.1](https://github.com/contributor-assistant/github-action/releases/tag/v2.6.1) — `ca4a40a7d1004f18d9960b404b97e5f30a505a08`
- [`actions/github-script` v8.0.0](https://github.com/actions/github-script/releases/tag/v8.0.0) — `ed597411d8f924073f98dfc5c65a23a2325f34cd`

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
