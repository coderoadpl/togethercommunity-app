# Together client SDK publishing

## Version line

The SDK follows strict SemVer independently of the application. Its version
lives in `packages/client-sdk/package.json`. A release bumps that version in a
reviewed pull request, merges the change, and then pushes
`sdk-v<version>` on the merge commit.

Cut an SDK release alongside any application release that changes
`core/client`, `core/contract`, `core/domain`, or
`adapters/auth/client-adapter.ts`. A breaking client-surface change requires a
major release, or a minor release while the SDK remains pre-1.0 under SemVer's
0.x rules.

## Pipeline

The tag triggers the `release-sdk` workflow. The workflow builds the package,
packs and installs the tarball in a clean consumer project, and runs
`npm publish` with provenance through trusted publishing. No npm token exists
in the repository or its secrets.

## One-time owner setup on npmjs.com

1. Create the organization for the selected scope through npmjs.com → Add
   Organization, for example `together-community`. The final scope is the
   owner's naming decision. If it differs from the placeholder, update the
   package `name` and both SDK documents before the first publish.

2. Publish once manually because npm cannot attach a trusted publisher to a
   package that does not exist. From a clean checkout, run
   `pnpm install && pnpm run sdk:build` in `app/`. Then, in
   `app/packages/client-sdk/`, temporarily set the version to `0.0.0`, run
   `npm login` and `npm publish --access public`, and revert the local version.
   Never commit the temporary version. The first real version then ships
   through the tag workflow.

3. On the package page, open Settings → Trusted Publisher → GitHub Actions.
   Set organization to `coderoadpl`, repository to `togethercommunity-app`,
   workflow filename to `release-sdk.yml`, and leave environment empty. Under
   allowed actions select "npm publish", which is mandatory for configurations
   created after 2026-05-20.

4. Optionally harden publishing. In npm package Settings → Publishing access,
   require the trusted publisher only to disable token publishes. In GitHub
   repository Settings → Rules, add a tag ruleset for `sdk-v*` that restricts
   creation to the owner. This preserves the SIL-3 requirement that the owner
   approve production-facing promotion.

Sources: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
and the [GitHub trusted publishing announcement](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/).
