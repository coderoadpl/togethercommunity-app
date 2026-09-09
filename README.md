# Together

A source-available platform for creators: digital product sales, marketing, course delivery, and community in one place. Free self-hosting and an inexpensive hosted version (USD 1–5/month), with content always owned by the user (BYO storage: S3 / YouTube / Vimeo / Bunny; BYO Stripe).

**Product values: reliability, versatility, price.**

## Status

A working PoC is implemented in `app/`. It includes the web app, API server,
CLI, migrations, demo data, automated tests, and architecture rules. The
documents also describe the direction of future development.

## Documents

| File | Contents |
|---|---|
| [`tasks/prd-together.md`](tasks/prd-together.md) | **Current PRD** — assumptions, principles, phases, user stories, requirements |
| [`app/README.md`](app/README.md) | **Quickstart** — local demo, test accounts, CLI |
| [`architecture.md`](architecture.md) | Together architecture — system boundaries, layers, glossary, and rules |
| [`docs/ses-onboarding.md`](docs/ses-onboarding.md) | SES setup, sample AWS application answers, and SMTP fallback options |
| [`SECURITY.md`](SECURITY.md) | Private vulnerability reporting, scope, and current support policy |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution workflow, required gates, and review |
| [`CLA.md`](CLA.md) | Contributor License Agreement signed with the first PR |
| [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md) | Dependency licenses and project notices (foundation, sharp/libvips, FA(3) schemas) |
| [`FOUNDATION.md`](FOUNDATION.md) | agentproofarch foundation provenance — fork commit and synchronized paths |
| [coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch) | **Normative architecture** (separate repository) — layers, ports, CLI, Vercel/Docker deployment |

## Name and domain

Name: **Together** (decided). The domain will be announced when the hosted version launches.

## License

Together is Fair Source under [FSL-1.1-ALv2](LICENSE.md). You may self-host it,
but may not offer competing hosting. Each release automatically transitions to
Apache-2.0 after two years. Learn more at
[fsl.software](https://fsl.software/) and [fair.io](https://fair.io/).
