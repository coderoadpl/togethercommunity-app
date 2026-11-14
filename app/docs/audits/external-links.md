# External-link audit

## Purpose

Check that Together's external citations still resolve to the artifact, state,
and content they name rather than merely returning a successful HTTP status.

## Run contract

- **Cadence:** quarterly, before a release, and after moving or renaming an
  external dependency, provider, standard, or repository.
- **Owner:** the documentation owner performs the review; the owner of the
  linked integration confirms provider-specific content.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), with URL, referring file, HTTP outcome, content
  match, replacement or exception, owner, and due date.
- **Standard anchor:** no external standard is asserted. At the audited commit,
  [`scripts/doc-lint.ts`](../../scripts/doc-lint.ts) defines the versioned
  relative-target contract. For external URLs, this specification requires that
  a link resolve to the content the surrounding claim describes, not merely to
  a successful HTTP response.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| `pnpm run doc-lint` | Checks tracked relative Markdown targets. It deliberately does not request external URLs or validate anchors on remote pages. |
| Auditor-selected HTTP link checker | May collect status, redirects, TLS errors, and timeouts for public URLs. No external-link checker is wired into Together's gates, and automated requests can be blocked or receive different content. |

## Manual checks

Choose and label the run mode before collecting evidence:

- **Full inventory:** use for quarterly and release audits. Enumerate external
  citations across repository documentation, instruction files, README files,
  release notes, and generated or code-block material. Record every referring
  location, cited claim, URL, final target, and verification result.
- **Partial rotating sample:** review every changed link plus a declared
  rotating sample of unchanged citations. Record excluded files/links and do
  not report the run as a full-inventory audit.

1. Review the selected inventory or sample of standards, provider instructions,
   advisories, legal sources, and repository links.
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
6. For cited GitHub pull requests and issues, inspect the actual repository,
   number, title, and open/closed/merged state. A closed-but-unmerged PR does not
   support a claim that its change landed. Verify decision numbers/titles and
   the cited artifact's identity, not only whether its URL resolves.
7. Treat authentication, rate limits, bot blocks, timeouts, and unavailable
   artifacts as unverified until further evidence distinguishes access failure
   from a removed target. Keep external crawling outside merge gates.

## Finding criteria

- A verified missing target (such as 404/410 with access context checked),
  removed cited section, or redirect to unrelated content no longer supports
  the referring claim. A generic homepage returning 200 is not a valid match.
- A cited PR/issue's actual state contradicts the surrounding merged/open/closed
  claim, or a repository, artifact number, decision number, or title identifies
  something different from what the citation names.
- The final page lacks the named version, heading, instruction, or evidence
  needed by the citation, supported by a content check rather than status alone.

Unverified access failures are not dead-link findings. Prefer versioned sources,
but an unpinned yet currently correct link is a stability/style note rather than
a fabricated present-tense defect; deeper prose truth belongs to
[documentation truth](docs-truth.md).

## Known blind spots

- A correct response today cannot establish future link stability or unchanged
  content, especially for unversioned sources and mutable release pages.
- Authentication, rate limits, bot handling, regional variance, and generated
  material can limit inventory or verification; a public HTTP scan cannot
  establish what every reader sees.
- Partial samples leave unsampled citations unverified. Even full-inventory
  resolution/content checks do not establish every surrounding prose claim or
  replace a documentation-truth review.
