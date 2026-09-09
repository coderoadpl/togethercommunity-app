# Together

Together is a source-available platform for creators, combining digital product
sales, marketing, course delivery, and community. Self-hosting is free; the
planned hosted service costs USD 1-5 per month. Creators own their content and
connect their own storage (S3, YouTube, Vimeo, or Bunny) and Stripe account.

**Product values: reliability, versatility, affordability.**

## Status

A working proof of concept lives in `app/`. It includes the web application,
API server, CLI, migrations, demo data, automated tests, and architecture rules.
The documentation also describes areas still under development.

## Documents

| Document | Contents |
|---|---|
| [Application README](app/README.md) | Quickstart, local demo, test accounts, and CLI. |
| [Architecture](architecture.md) | System boundaries, layers, vocabulary, and rules. |
| [Terminology glossary](app/docs/terminology-glossary.md) | Canonical user-facing terms and copy conventions. |
| [SES onboarding](docs/ses-onboarding.md) | SES setup, AWS application answers, and SMTP fallback options. |
| [Security policy](SECURITY.md) | Private vulnerability reporting, scope, and current support policy. |
| [Contributing](CONTRIBUTING.md) | Contribution workflow, required gates, and review. |
| [Contributor License Agreement](CLA.md) | The CLA signed with a contributor's first pull request. |
| [License](LICENSE.md) | Application license terms. |
| [Third-party licenses](THIRD-PARTY-LICENSES.md) | Dependency licenses and notices for the foundation, sharp/libvips, and FA(3) schemas. |
| [Foundation](FOUNDATION.md) | agentproofarch provenance, fork commit, and synchronized paths. |
| [coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch) | Normative foundation architecture: layers, ports, CLI, and Vercel/Docker deployment. |

## Name and domain

The product is named **Together**. The domain will be announced when the hosted
service launches.

## License

Together is Fair Source under [FSL-1.1-ALv2](LICENSE.md). You may self-host it,
but you may not offer competing hosting. Each release automatically transitions
to Apache-2.0 after two years. Learn more at [fsl.software](https://fsl.software/)
and [fair.io](https://fair.io/).
