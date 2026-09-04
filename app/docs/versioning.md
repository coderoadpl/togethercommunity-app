# Versioning

Owner decision, 2026-09-04. The policy behind it is
[ADR-0017](decisions/0017-version-derived-from-git-history.md); the surfaces it
feeds are [ADR-0009](decisions/0009-release-versioning-and-version-surfaces.md)
and [ADR-0011](decisions/0011-version-surfaces.md).

## The rules

| Component | Counts |
|---|---|
| MAJOR | nothing — it stays at the major component of the `app/package.json` version until the owner raises it |
| MINOR | promotions to production: merge commits `Merge pull request #N from coderoadpl/staging` on `main` |
| PATCH | pull request merges into the trunk since that promotion: merge commits `Merge pull request #N from coderoadpl/<branch>` reachable from `HEAD` but not from the last promotion |

A promotion therefore raises MINOR and resets PATCH to zero, because after the
promotion no pull request merge is outside it yet. Nothing is bumped by hand,
no commit carries a version, and CI never writes a version back into the
repository.

Today `main` derives `0.13.0` (thirteen promotions) and the trunk derives
`0.13.5` (five pull requests merged since promotion #96).

## Derivation

`app/scripts/derive-version.ts` reads the numbers with git plumbing only:

```bash
pnpm exec tsx scripts/derive-version.ts          # 0.13.5
pnpm exec tsx scripts/derive-version.ts --json   # version, major, minor, patch, sha, promotion, complete
```

MINOR walks `git log --first-parent --merges` over the first `main` ref that
exists out of `refs/versioning/main`, `refs/remotes/origin/main`,
`refs/heads/main`. PATCH walks `git log --merges HEAD ^<last promotion>`. Both
pre-filter with `--grep` and then match the merge subject exactly, so a
`Merge branch …` commit never counts.

The result is a function of the commit graph alone: the same commit always
derives the same number, on any machine, in any checkout order.

## Where the number surfaces

`vercel-build` derives the version and writes it into that build's copy of
`app/package.json` before migrating and building. The manifest is already the
single version source every surface reads, so nothing else has to be rewired:

- `/api/health` version and the OpenTelemetry service version;
- the browser build stamp `vX.Y.Z (<sha>)` in the footer and on the login
  screen, and the build info in settings;
- the CLI `--version` flag and `version` command.

Tests, Docker images and local runs never execute `vercel-build`, so they keep
the committed manifest value. That is the intended fallback, not a defect.

## The history the derivation needs

- **CI** checks out with `fetch-depth: 0`, so every branch and the full history
  are present.
- **Vercel** clones the deployed branch about ten commits deep, with no other
  branches and no remote configured
  ([configuring a build](https://vercel.com/docs/builds/configure-a-build)).
  Set `VERCEL_DEEP_CLONE=true` in the project environment to get the full
  history. When the clone is still shallow, the script re-fetches
  `+refs/heads/*:refs/versioning/*` from
  `https://github.com/$VERCEL_GIT_REPO_OWNER/$VERCEL_GIT_REPO_SLUG.git`, which
  needs no credentials because the repository is public.
- **Docker and tests** have no promotion history to read and fall back to the
  manifest.

When the history cannot be read, the version becomes the manifest value plus
the `+unknown` build metadata marker, and the commit identity falls back to
`VERCEL_GIT_COMMIT_SHA`. A footer reading `v0.1.0+unknown (abc1234)` means the
build could not see enough history — it does not mean the application is at
`0.1.0`.

## Tags and changelog

The `release-tag` job in `.github/workflows/ci.yml` runs after the gates on a
push to `main`. When that push is a promotion it creates the annotated tag
`vX.Y.Z` through the GitHub API and publishes a release whose notes are the
changelog. Tags are never moved: the job exits early when the tag already
exists.

`app/scripts/changelog.ts` builds those notes from the pull request titles
carried in the merge commit bodies since the previous `v*` tag, grouped by the
`feat` / `fix` / `ui` / `docs` / `ci` title prefix, with anything else under
`Other`. No classification model is involved.

```bash
pnpm exec tsx scripts/changelog.ts --from v0.12.0 --version 0.13.0
```

The changelog is published with each release rather than committed as a
repository file, which keeps the promotion merge the only commit CI ever
produces on `main`.
