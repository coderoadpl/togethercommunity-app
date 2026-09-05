# ADR-0009: Release versioning and version surfaces

Status: accepted, 2026-07-29. Builds on
[ADR-0003](0003-vercel-environments.md), which defines production promotion.
Decision 3 and the deferred release hygiene below are superseded by
[ADR-0017](0017-version-derived-from-git-history.md), which derives the version
from the commit graph at build time; the single version source, the surfaces
and the `1.0.0` boundary decided here still stand.

## Context

Together already has an application version. `package.json` identifies the
application as `0.1.0`, and the server includes that version together
with a commit SHA in its health attestation. The CLI and browser previously had
no local identity surface, which made it harder to distinguish a stale browser
bundle, a different server deployment, or an invocation of an unexpected CLI
checkout.

Together is still a pre-release. It has no public product website, no
published support commitment, and no independently released consumer of its
HTTP API. A useful application identity must not be mistaken for a compatibility
promise or for release machinery that does not exist yet.

Application releases, HTTP API compatibility, and architecture decisions have
different lifecycles. The application needs one version and visible build
identity now. An external API promise and a repeatable release process become
necessary only when their concrete triggers occur.

## Decision

1. **Together uses strict SemVer syntax and `app/package.json` is the single
   application version source.** No `VERSION` file or second
   application-version constant is introduced.

   - The server reads the manifest in `apps/server/src/version.ts` and exposes
     the value through the existing health attestation.
   - The CLI reads the same manifest in `apps/cli/src/version.ts`; `--version`
     and the `version` command work locally without contacting a server.
   - The web build reads the manifest in `apps/web/vite.config.ts` and injects
     the version into the browser bundle. It also injects a short
     `APP_COMMIT_SHA`, falling back to Vercel's build-time commit SHA and then
     to `unknown` when no deployment attestation is available.

   The package version names the application release. The commit SHA identifies
   the exact build. Neither value substitutes for the other.

2. **The current `0.x` line is pre-release.** While Together remains
   pre-release, its version communicates build identity and relative release
   progression, not a public stability guarantee. Major, minor, and patch
   selection still follows SemVer, including SemVer's allowance for
   incompatible change before `1.0.0`.

3. **A version bump happens only for a deliberate release.** Ordinary merges to
   the staging branch do not change `package.json`. The person cutting a release
   chooses and reviews the next version as part of that release. The production
   promotion topology remains the one defined by ADR-0003; this ADR does not
   add a release branch, script, tag workflow, or automated bump.

4. **`1.0.0` is Together's first public and supported release boundary.** The
   boundary is reached only when all of the following are deliberate facts:

   - Together is offered beyond its private pre-release audience as a public or
     explicitly supported product;
   - the owner has approved the deployed feature and operational baseline that
     will be supported;
   - installation, operation, upgrade, and support expectations for that
     baseline are documented; and
   - the release procedure and compatibility commitments that apply after
     `1.0.0` have been reviewed and recorded.

   A website is not required merely to increment a version, and none exists
   today. If a public release later needs a website or published documentation,
   that work is selected on its own merits rather than implied by this ADR.

5. **No external API compatibility policy is adopted yet.** Today the server,
   web application, and CLI are developed from the same repository and release
   context. The trigger for a new decision is the first independently released
   consumer of Together's HTTP API: a client whose release and upgrade schedule
   is not controlled by the Together application release.

   Before such a consumer is supported, or before a breaking API change is made
   after that consumer exists, a later ADR must decide and document the
   compatibility promise. That decision must explicitly address additive-only
   evolution and whether breaking changes require a concurrently served
   `/api/v2`. This ADR does not declare the current unprefixed API to be v1, does
   not add a version prefix, and does not promise a `/api/v2` policy in advance.

6. **The implemented identity surfaces stay narrow and honest.**

   | Surface | Identity | Source |
   |---|---|---|
   | Health endpoints | server version and commit SHA | existing server attestation |
   | CLI | application version | local manifest read |
   | Login and authenticated shell | browser version and known short SHA | Vite build constants |
   | Settings | browser and server version/SHA comparison | build constants plus existing health query |

   The health response shape remains unchanged. The CLI does not claim a commit
   SHA because it has no separate build attestation. Browser surfaces show
   `unknown` rather than deriving a SHA from Git at runtime. No documentation or
   changelog URL is displayed because Together has no canonical published
   destination for either.

7. **Architecture history remains ADR history.** An application major version
   does not renumber, snapshot, or rewrite architecture decisions. A later
   decision changes this policy by superseding this ADR rather than by editing
   version numbers into existing decisions.

## Explicitly deferred release hygiene

The following work is useful at a real release boundary but is not implemented
by this ADR:

- a release script that validates a clean tree and prepares the reviewed
  manifest bump;
- an immutable release-tag workflow tied to the actual production promotion
  event; and
- a `CHANGELOG.md` convention that defines unreleased entries and release
  headings without inventing a historical `0.x` changelog.

The release procedure decision made before `1.0.0` must either implement these
items or explicitly reject them with replacements appropriate to Together's
then-current deployment model.

## Consequences

Operators and users can identify the CLI, browser bundle, and server without a
network call from the local surfaces, while signed-in settings can detect a
browser/server mismatch through the existing health endpoint. All version
surfaces derive from one manifest, and deployed build identity continues to use
the commit SHA already carried by the health attestation.

Browser build stamps are masked in committed visual baselines, so ordinary
release version bumps do not require baseline regeneration. If a version
surface changes layout or presence, the affected goldens still require
`visual:update` on the macOS renderer and the baseline evidence required by
[Visual regression](../visual-regression.md).

Together remains honestly pre-release: version visibility does not create a
public support contract, an API v1 promise, a release automation claim, a
website, or a changelog. Those commitments receive dedicated decisions when the
first public release or independent API consumer makes them necessary.

The release-only bump rule is enforced by review for now. No repository
mechanism can distinguish an ordinary merge from a deliberate release until the
deferred release workflow is designed.
