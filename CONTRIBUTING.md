# Contributing to Together

Thank you for helping improve Together.

## Contribution flow

1. Open an issue before starting a large change so its scope and design can be
   agreed on. Vulnerability reports are the exception: do not disclose them in
   an issue or pull request; follow the private [security policy](SECURITY.md).
2. Fork the repository and create a focused branch from the current default
   branch.
3. Use Node.js 24 and run `pnpm install --frozen-lockfile` from `app/`.
4. Prepare the local database before running any gate: start Docker, then run
   `pnpm run db:up && pnpm run db:migrate && pnpm run db:seed` from `app/`.
   The gates expect a migrated and seeded database and fail without one.
5. Make the change, add or update tests and documentation, and keep commits
   focused.
6. Run the static gate `pnpm run check` and the runtime gate `pnpm run smoke`
   from `app/`; both must be green.
7. Open a pull request that explains the problem, the solution, and how it was
   verified.
8. Address review feedback and keep the branch current until all required
   checks pass.

## Contributor License Agreement

Every contributor must accept the [Individual Contributor License
Agreement](CLA.md) once before a contribution can be merged. The agreement
grants the Licensor the copyright, patent, sublicense, and relicensing rights
needed to maintain and license Together while you retain ownership of your
contribution.

A CLA bot comments on every pull request that contains work from a contributor
who has not accepted the agreement yet. To accept it, reply on the pull request
with:

> I have read the CLA Document and I hereby sign the CLA

The signature is recorded once in this repository and covers your later
contributions, so the bot asks only on your first pull request. Comment
`recheck` if the bot needs to re-evaluate a pull request. The bot reports a
status check, and a pull request will not be merged until everyone who
contributed to it has signed; the check is enforced procedurally until a
ruleset marks it required.

Do not submit code, assets, or other material that you do not have the right to
contribute. Identify any third-party material and its license in the pull
request.

## Pull request expectations

Pull requests should be small enough to review, include tests appropriate to
the risk, avoid unrelated formatting changes, and update user-facing or
developer documentation when behavior changes.

By opening a pull request, you agree that your contribution is governed by
the CLA (one-time acceptance, required before the first merge). The CLA grants
the Licensor the rights needed to distribute the contribution under the
repository license and any future licensing of the project.
