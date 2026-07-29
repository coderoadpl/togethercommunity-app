# Contributing to Together

Thank you for helping improve Together.

## Contribution flow

1. Open an issue before starting a large change so its scope and design can be
   agreed on.
2. Fork the repository and create a focused branch from the current default
   branch.
3. Use Node.js 24 and run `pnpm install --frozen-lockfile` from `app/`.
4. Make the change, add or update tests and documentation, and keep commits
   focused.
5. Run `pnpm run check` from `app/`.
6. Open a pull request that explains the problem, the solution, and how it was
   verified.
7. Address review feedback and keep the branch current until all required
   checks pass.

## Contributor License Agreement

Every contributor must accept the [Individual Contributor License
Agreement](CLA.md) once before a contribution can be merged. The agreement
grants the Licensor the copyright, patent, sublicense, and relicensing rights
needed to maintain and license Together while you retain ownership of your
contribution.

CLA Assistant will record acceptance and block merges from contributors who
have not signed. The repository owner will install and configure the GitHub app
before the repository is made public.

Do not submit code, assets, or other material that you do not have the right to
contribute. Identify any third-party material and its license in the pull
request.

## Pull request expectations

Pull requests should be small enough to review, include tests appropriate to
the risk, avoid unrelated formatting changes, and update user-facing or
developer documentation when behavior changes.

By opening a pull request, you agree that the contribution is submitted under
the repository license and, after your one-time acceptance, under the terms of
the CLA.
