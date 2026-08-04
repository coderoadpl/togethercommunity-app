# @together-community/client-sdk

Typed API client for the Together platform, built and published from the main
repository. The package contains the sources from `app/core/client`,
`app/core/contract`, and `app/core/domain`, plus the headless authentication
adapter.

The npm scope shown here is a placeholder. The owner selects the final scope on
npmjs.com before the first publish.

| Subpath | Contents |
| --- | --- |
| `.` | Fetch client and TanStack Query and mutation descriptors |
| `./contract` | API routes, zod schemas, and HTTP status and exit-code maps |
| `./domain` | Domain types, `ERROR_CODES`, and `Result` helpers |
| `./auth-client` | Headless bearer authentication through `createCliAuthAdapter` |

The package is ESM-only and supports Node 20 or newer and modern bundlers. React
Native projects can use Metro 0.82 or newer, which resolves the package's
`imports` field natively.

The SDK has an independent SemVer line. Releases use `sdk-vX.Y.Z` git tags cut
alongside application releases when the client surface changes, and npm trusted
publishing records provenance for each release.

The SDK is source-available under FSL-1.1-ALv2; see `LICENSE.md`. The owner may
later choose to relicense the SDK more permissively.

See the [integrator quickstart](https://github.com/coderoadpl/togethercommunity-app/blob/main/app/docs/integrations/client-sdk.md).
