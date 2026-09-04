# ADR-0017: Version derived from git history

Status: accepted, 2026-09-04. Supersedes decision 3 and the deferred release
hygiene of [ADR-0009](0009-release-versioning-and-version-surfaces.md).

## Context

ADR-0009 kept one hand-reviewed version in `app/package.json` and deferred the
release procedure, the release tag and the changelog until a real release
boundary. A hundred pull requests later that boundary has still not arrived and
the number never moved, so every surface has been reporting the same value for
the whole life of the project. A version that never changes identifies nothing;
the commit SHA has been carrying the entire build identity alone.

The repository already records exactly the two events a version should count.
Production promotion is a merge commit `Merge pull request #N from
coderoadpl/staging` on `main`. Ordinary work reaches the trunk as a merge
commit `Merge pull request #N from coderoadpl/<branch>`. Both are facts of the
commit graph, so a number counted from them needs no bookkeeping commit, no
reviewer discipline and no state outside git.

## Decision

1. **The version is derived from the commit graph at build time.** MINOR counts
   the promotions on `main`, PATCH counts the pull request merges reachable from
   `HEAD` but not from the last promotion, and MAJOR stays at the major
   component of the manifest until the owner raises it. `app/docs/versioning.md`
   states the rules, the derivation, and the number the current history yields.

2. **No commit and no CI run writes a version into the repository.**
   `app/scripts/derive-version.ts` computes the number, and `vercel-build`
   stamps it into that build's copy of `app/package.json` before migrating and
   building. `app/package.json` therefore remains the single version source that
   ADR-0009 established, and the server, browser and CLI surfaces of ADR-0011
   keep reading it unchanged.

3. **The committed manifest version is the documented fallback.** Tests, Docker
   images and local runs have no promotion history to count and keep the
   committed value. A build that cannot read enough history reports the manifest
   version with a `+unknown` build metadata marker rather than a plausible wrong
   number.

4. **Promotions are tagged and get a changelog.** A CI job creates the immutable
   annotated tag `vX.Y.Z` on the promotion commit and publishes a release whose
   notes group the pull request titles since the previous tag by their
   `feat` / `fix` / `ui` / `docs` / `ci` prefix. The changelog is release notes,
   not a committed file, so promotion stays the only commit CI produces on
   `main`.

5. **The pre-release meaning of `0.x` is unchanged.** A derived MINOR is a
   count of promotions, not a compatibility statement, and ADR-0009's
   conditions for `1.0.0` continue to apply.

## Consequences

Every deployed build now carries a number that says how much production has
moved, and `/api/health`, the browser stamp and the CLI agree on it because
they all read the same manifest. Comparing two deployments no longer requires
looking up commit SHAs.

The derivation depends on the merge subjects that GitHub writes for a pull
request merge. Squash or rebase merges into `main` or the trunk would not be
counted; the merge-commit topology of
[ADR-0003](0003-vercel-environments.md) is now load-bearing for the version as
well as for promotion.

Builds need more git history than a default Vercel clone provides. The
consequence is operational and documented with its two remedies: the
`VERCEL_DEEP_CLONE` project variable, and the script's own re-fetch of the
public repository.

Renumbering never happens retroactively: a commit's number is a function of the
history behind it, so an old deployment keeps reporting the number it was built
with.
