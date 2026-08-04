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
| `pnpm run permissions:check` | Checks the generated use-case authorization inventory represented by the [permission table](../permission-table.md). It does not decide whether a role assignment is correct. |
| `pnpm run test` and `pnpm run smoke` | `pnpm run test` includes generated [route table](../route-table.md) drift detection. Together the commands prove covered descriptors, transports, commands, UI behavior, and runtime paths. Missing assertions remain invisible. |
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

## Email-verification evidence — 2026-08-04

**Reviewed commit:** `bcac038897c8819af4a539ef96f8a424b791e8df` on
`run-v140-email-verify`, with the findings below resolved by the review commit.
**Auditor/owner:** feature owner; repository owner accepts intentional
divergences before merge. **Next review:** the next release audit.

| Contract | Server | Client | CLI | Creator account | Member account | PL | EN | Docs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `emailVerified` identity state and `tenant:create` verdict | Soft verification mail and enumeration-safe resend; tenant-host links preserve the cookie world | Identity parsing and resend descriptor covered | Identity output includes verification state | Status and resend in tenantless home and settings | Status and resend at `/account` | Mail, status, success, error, and recovery copy | Mail, status, success, error, and recovery copy | ADR 0012, route table, permission table, self-host guide, and this audit |

- **Tool evidence:** focused auth, server, and login-page tests cover subdomain,
  custom-domain, base-domain tenant-header, bounded-context, and known provider
  outcomes. `pnpm run check` and `pnpm run smoke` remain the merge gates.
- **Intentional divergence:** `createTenant` reads `tenants.hasAny()` before
  authorization to select the documented first-workspace waiver. The read is
  non-mutating, `requireEmpty` preserves write atomicity, and denial tests prove
  the tenant store is unchanged.
- **Findings:** no open cross-surface mismatch remains in the reviewed scope.
- **Blind spots:** a live production mail provider, real custom-domain DNS/TLS,
  and inbox placement were not sampled; production owners must supply that
  evidence before go-live.
