# Cross-surface consistency audit

## Run contract

- **Cadence:** before a release and after any contract, authorization, account,
  CLI, or user-facing language change.
- **Owner:** the changed feature's owner performs the comparison; the repository
  owner accepts intentional divergences.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), with a matrix whose columns are contract,
  server, client, CLI, creator account, member account, PL, EN, and docs. Every
  row records parity, intentional divergence, missing surface, and evidence.
- **Standard anchor:** OWASP ASVS 5.0.0 V8 supplies authorization-verification
  vocabulary, and the
  [OWASP API Security Top 10:2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
  supplies API-risk vocabulary. All non-authorization surface parity is a
  Together-specific contract; this audit claims no OWASP conformance.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| `pnpm run typecheck`, `pnpm run typecheck:islands`, and `pnpm run depcruise` | Detect type and layer drift across compiled paths. They do not prove semantic parity or that every surface exposes the feature. |
| `pnpm run permissions:check` | Compares generated route and use-case authorization inventories represented by the [route table](../route-table.md) and [permission table](../permission-table.md). It does not decide whether a role assignment is correct. |
| `pnpm run test` and `pnpm run smoke` | Prove covered descriptors, transports, commands, UI behavior, and runtime paths. Missing assertions remain invisible. |
| `pnpm run doc-lint` | Detects structural documentation drift only, not contract accuracy. |

## Manual checks

For every audited capability, compare all of these surfaces even when one is
expected to be absent:

1. `core/contract` request, response, error, and capability definitions.
2. Server route, identity resolution, tenant context, authorization guard, and
   use-case behavior.
3. `core/client` descriptor and browser transport behavior.
4. CLI arguments, JSON envelope, human output, and taxonomy exit code.
5. The creator/platform account and security surface.
6. The tenant-member `/account` surface. Together has one credential identity
   but both account surfaces must be checked independently.
7. Polish and English strings, including validation, pending, success, empty,
   unauthorized, and recovery states.
8. User, operator, route, permission, security, and release documentation.

Trace authorization decisions back to the authoritative generated inventories;
do not copy their rows into the audit. Record transport-only, CLI-only, or
deliberately role-limited features as explained divergences. Anything not
examined is a blind spot, not implicit parity.

