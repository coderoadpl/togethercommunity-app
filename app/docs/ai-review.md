# AI review gate

The `ai-review` workflow is a fail-closed doctrine and code-review check for pull requests targeting `staging` or `main`. It reviews the pinned pull-request diff from inert snapshots; it never checks out or executes files from the pull-request head.

For `staging`, the review checks tenant isolation and authorization, layer boundaries, English/Polish i18n parity, public-repository and tenant-neutrality rules, secrets and deployment separation, additive migration safety, WHY-only comments, meaningful tests, and truthful documentation. For `main`, it applies the same rules to the cumulative `staging` promotion and also reports blast radius, hard-to-reverse changes, coverage, rollback, and confidence. A main review with low confidence cannot pass.

## Blocking behavior

Only the first valid `PASS` makes the check green. A model `FAIL`, invalid or empty structured output, authentication rejection, usage limit, unavailable model, timeout, provider failure, missing credentials, draft PR, stale target, cancellation, or preparation failure leaves the check red. A valid `FAIL` ends the run; later models and tokens are infrastructure fallbacks, not second opinions.

The primary model depends on the PR base. Staging uses `AI_REVIEW_MODEL`, while main uses `AI_REVIEW_MODEL_MAIN`; both use `AI_REVIEW_MODEL_FALLBACK`. Attempts run in this order:

1. Slot 1 primary, then slot 1 fallback.
2. Slot 2 primary, then slot 2 fallback.
3. Slot 3 primary, then slot 3 fallback.

Each model/slot pair receives one immediate retry only when the execution log proves the model was never called. Missing slots are skipped. Usage-limit and model-unavailable errors therefore reach the fallback model on the same token before the next token slot.

The workflow uses a read-only GitHub token for preparation and a pull-request-write token only for its deterministic sticky comment. The model receives one OAuth credential at a time, no GitHub token, no shell, no network tools, no write tools, no plugins, and no repository or user configuration. Its reads are confined to the prepared runner-temporary input directory.

## Owner setup

Land the workflow, scripts, prompts, tests, and this document on `staging`, then promote them to `main` under the existing controls before making `ai-review` required. The introducing pull request is expected to be red because its trusted base does not contain the gate yet.

In repository **Settings → Secrets and variables → Actions → Variables**, preserve these values:

- `AI_REVIEW_MODEL=claude-opus-5`
- `AI_REVIEW_MAX_TURNS=120`
- `AI_REVIEW_TIMEOUT_MINUTES=90`

Add:

- `AI_REVIEW_MODEL_MAIN=claude-fable-5-1`
- `AI_REVIEW_MODEL_FALLBACK=claude-opus-5`

The organization secret `CLAUDE_CODE_OAUTH_TOKEN_1` is already granted to this repository. Slots `_2` and `_3` are optional. To add one later, open **coderoadpl → Settings → Secrets and variables → Actions**, create the organization secret, choose **Selected repositories**, and add `togethercommunity-app` without changing sibling grants. Use Claude Code OAuth credentials only and rotate slots independently.

After recording both a normal green `PASS` and a normal red `FAIL`, configure branch rulesets:

- `staging-gates`: Active, target `refs/heads/staging`, empty bypass list, pull request required with 0 approvals, resolved conversations, merge commits only, no force pushes or deletions, and required checks with branches up to date.
- `main-promotion`: Active, target `refs/heads/main`, empty bypass list, the same history and up-to-date protections, 1 code-owner approval, stale approvals dismissed, resolved conversations, and `require_last_push_approval=false`.

Add the exact GitHub Actions check `ai-review` to both rulesets. Preserve existing checks and require `check`, `smoke`, `visual`, `e2e (auth)`, `e2e (poc)`, `e2e (subs)`, `e2e (marketing)`, `e2e (coupon)`, `e2e (public-authz)`, `e2e (member-activity)`, `e2e (member-shell)`, `e2e (impersonation)`, `e2e (two-factor)`, `e2e (image-assets)`, and `e2e (custom-domain)`. Verify the exact emitted names in the Checks UI before saving. Do not add a bare `e2e` check. Keep `.github/CODEOWNERS` with the owner rule on `main`; a promotion authored by the owner needs an independent contributor identity because authors cannot approve their own pull requests.

Verify that red or missing review checks block both branches, a green review does not bypass the main approval, new pushes dismiss stale approval and start a new review, and direct pushes, force pushes, and branch deletion remain blocked for administrators. Record the live ruleset IDs and probe evidence in the private implementation handoff.

## Re-running

A new push, reopening the pull request, marking it ready, retargeting it, or editing its promotion evidence starts a new review. For a transient provider or capacity failure, use **Actions → ai-review → Re-run jobs** after capacity returns.

Once the workflow exists on the default `main` branch, `workflow_dispatch` accepts a PR number. Keep `dry_run=true` to validate metadata, snapshots, inventories, prompts, and security wiring without calling a model or posting a comment. Set it to false only for an owner-controlled OAuth rehearsal. Dispatch runs are diagnostic and never satisfy the pull request's required `ai-review` check.

Fork and Dependabot pull requests do not receive OAuth secrets and remain blocked. A maintainer must import reviewed commits into a same-repository branch, preserving authorship and CLA history, and open a replacement pull request.

## Reading the verdict

The sticky `<!-- ai-review-gate -->` comment names the reviewed base and head SHAs and links to the workflow run. `PASS` means the model found no blocker in the evidence it reviewed; it does not replace deterministic checks or the owner's production approval. `FAIL` lists blocking issues with a path or symbol, violated rule, consequence, and smallest correction. `NO VERDICT — infrastructure failure` means no model decision was accepted and lists the classified reason for each attempted pair.

Below the verdict line the comment shows a `TL;DR` of at most three sentences, taken from the model's `tldr` field and falling back to the first paragraph of its summary. Blocking issues stay expanded. The rest of the summary is collapsed: one `<details>` block per `### ` heading it contains, or a single `Full report` block when it has none.

The collapsed `Run details` footer identifies the observed model, token slot, and attempt that produced the verdict. If the runtime does not report its model, the configured model is labeled as requested. Requested and observed models are both shown when they differ. Turns, input tokens including cache inputs, output tokens, and API-equivalent cost appear only when present; the cost is not an OAuth billing statement.
