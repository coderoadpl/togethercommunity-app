# Dead-code and test-gap audit

## Run contract

- **Cadence:** monthly, before a release, and after a substantial feature
  removal or architectural move.
- **Owner:** the repository owner is accountable; affected layer owners triage
  findings.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), with separate dead-code and test-gap tables.
  Each row names the behavior or symbol, layer, evidence, risk, disposition,
  owner, and due date.
- **Standard anchor:**
  [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) supplies
  maintainability and testability vocabulary only. No ISO conformance is
  assessed.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| `pnpm run knip` | Finds unused files, exports, and dependencies visible to its configured entry points. Dynamic registration and broad entry points can hide dead code. |
| `pnpm run typecheck`, `pnpm run lint`, and `pnpm run depcruise` | Detect invalid references and boundary violations, not behavior that is reachable but obsolete. |
| `pnpm run test` and `pnpm run smoke` | Exercise unit/integration behavior and the canonical runtime path. Passing tests do not establish meaningful coverage of every branch or role. |
| `pnpm run coverage` | Produces the repository's layer report and ratchet described in the [coverage audit](../../../tasks/coverage-report.md). It is separate from `pnpm run check` and is not a completeness metric. |

## Manual checks

1. Review Knip configuration, ignored paths, dynamic imports, wildcard auth
   routes, generated files, exported type-only seams, and suppressions for code
   the tool cannot classify safely.
2. Trace feature entry points through domain, contract, server, adapter, client,
   CLI, and web surfaces. Flag implementations with no reachable product path
   and paths whose only consumer is a stale test.
3. Inspect changed high-risk behavior for negative cases, tenant isolation,
   authorization, error taxonomy, persistence rollback, and runtime proof.
4. Read the coverage report's documented exclusions and runtime blind spots;
   prioritize gaps by impact rather than line percentage.
5. Record intentionally retained extension seams and why they remain. An
   unexplained suppression is a finding, not proof that the code is live.

