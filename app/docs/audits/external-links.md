# External-link audit

## Run contract

- **Cadence:** quarterly, before a release, and after moving or renaming an
  external dependency, provider, standard, or repository.
- **Owner:** the documentation owner performs the review; the owner of the
  linked integration confirms provider-specific content.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), with URL, referring file, HTTP outcome, content
  match, replacement or exception, owner, and due date.
- **Standard anchor:** no external standard is asserted. The repository-defined
  requirement is that a link resolves to the content the surrounding claim
  describes, not merely to a successful HTTP response.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| `pnpm run doc-lint` | Checks tracked relative Markdown targets. It deliberately does not request external URLs or validate anchors on remote pages. |
| Auditor-selected HTTP link checker | May collect status, redirects, TLS errors, and timeouts for public URLs. No external-link checker is wired into Together's gates, and automated requests can be blocked or receive different content. |

## Manual checks

1. Review every external link added or changed since the prior audit and a
   rotating sample of unchanged standards, provider instructions, advisories,
   legal sources, and repository links.
2. Open the final redirect target and confirm the cited version, heading,
   instruction, release, or claim remains present. A generic homepage is not a
   valid substitute for a versioned source.
3. Check whether the target is official, stable, accessible without a private
   session, and safe for the intended reader. Prefer permanent or versioned
   links when the authoritative source provides them.
4. Review links embedded in code blocks or generated artifacts separately,
   because Markdown link extraction may not see them.
5. Record authentication walls, bot blocks, geographic variance, and links not
   sampled as blind spots. Do not report a status-only scan as content truth.

