# Version surfaces

`app/package.json` is the single application version source. Deployment builds
stamp the version derived from Git history into their own copy of that manifest;
[Versioning](versioning.md) describes the derivation, fallback, tags, and release
notes. The committed manifest value is
<!--release-version-->`0.1.0`<!--/release-version-->.
Local runs, tests, and Docker builds retain that value. A deployment build that
cannot read sufficient history adds `+unknown` build metadata.

## Build identity

| Surface | Identity | Source |
|---|---|---|
| Health endpoints | Server version and commit SHA | `apps/server/src/version.ts` and health attestation |
| CLI | Application version | `apps/cli/src/version.ts`, reading the local manifest |
| Login and authenticated shell | Browser version and known short SHA | Constants injected by `apps/web/vite.config.ts` |
| Settings | Browser and server version/SHA comparison | Build constants and the existing health action |

The version identifies the application release; the commit SHA identifies the
exact build. The current `0.x` line is pre-release and does not provide a public
stability or support guarantee. See the [security policy](../../SECURITY.md)
for the current support scope. The HTTP API has no published compatibility
promise or version-prefix policy.

The browser stamp makes no network request. Vite reads `APP_COMMIT_SHA`, falls
back to Vercel's build-time SHA, and otherwise records `unknown`; the login
stamp omits an unknown SHA. Settings warn when browser and server identities
differ, but treat an unknown SHA on either side as unverifiable rather than
stale.

The CLI `--version` flag and `version` command print the bare semantic version
without contacting a server. The CLI has no separate commit attestation;
server identity remains available through the health command.

The visual harness masks browser build stamps on every route capture. A version
change alone does not require new goldens; changes to the layout or presence of
a version surface follow the [visual-regression workflow](visual-regression.md).
